package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"newswitch.dev/gin-service-lab/internal/observe"
	"newswitch.dev/gin-service-lab/internal/store"
	"newswitch.dev/gin-service-lab/internal/transport"
	"strconv"
	"strings"
	"time"
)

type Server struct {
	Store     *store.Store
	Telemetry *observe.Telemetry
	Cache     *transport.Cache
	permits   chan struct{}
}

func New(s *store.Store, telemetry *observe.Telemetry, key []byte, concurrency int, cache *transport.Cache) (*Server, http.Handler, error) {
	if err := validateKey(key); err != nil {
		return nil, nil, err
	}
	if concurrency < 1 || concurrency > 128 {
		return nil, nil, fmt.Errorf("invalid concurrency")
	}
	server := &Server{Store: s, Telemetry: telemetry, Cache: cache, permits: make(chan struct{}, concurrency)}
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.SetTrustedProxies(nil)
	r.Use(telemetry.Middleware(), gin.Recovery())
	r.GET("/health/live", func(c *gin.Context) { c.JSON(200, gin.H{"status": "UP"}) })
	r.GET("/health/ready", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 500*time.Millisecond)
		defer cancel()
		if s.DB.PingContext(ctx) != nil {
			c.Status(503)
			return
		}
		c.JSON(200, gin.H{"status": "UP"})
	})
	api := r.Group("/api", authenticate(key), server.admit())
	read := api.Group("", require("task:read"))
	write := api.Group("", require("task:write"))
	read.GET("/me", func(c *gin.Context) { c.JSON(200, gin.H{"tenant": tenant(c)}) })
	read.GET("/tasks", server.list)
	read.GET("/tasks/:id", server.get)
	read.GET("/tasks/:id/events", server.events)
	read.GET("/templates/:id", server.template)
	write.POST("/tasks", server.create)
	write.POST("/tasks/:id/cancel", server.cancel)
	// Metrics and pprof are NOT mounted on this public API router. CLI starts a separate loopback admin listener.
	return server, r, nil
}
func (s *Server) admit() gin.HandlerFunc {
	return func(c *gin.Context) {
		select {
		case s.permits <- struct{}{}:
			defer func() { <-s.permits }()
		default:
			c.Header("Retry-After", "1")
			c.AbortWithStatusJSON(503, gin.H{"error": "capacity exhausted"})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}
func decode(c *gin.Context, target any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("one JSON object required")
	}
	return nil
}
func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, store.ErrMissing):
		c.JSON(404, gin.H{"error": "task missing"})
	case errors.Is(err, store.ErrConflict):
		c.JSON(409, gin.H{"error": "task conflict"})
	case errors.Is(err, context.DeadlineExceeded):
		c.JSON(504, gin.H{"error": "deadline exceeded"})
	default:
		c.JSON(503, gin.H{"error": "dependency unavailable"})
	}
}
func (s *Server) create(c *gin.Context) {
	var input struct {
		Name string `json:"name"`
	}
	if decode(c, &input) != nil || strings.TrimSpace(input.Name) == "" || len(input.Name) > 80 || c.GetHeader("Idempotency-Key") == "" || len(c.GetHeader("Idempotency-Key")) > 80 {
		c.JSON(400, gin.H{"error": "name and idempotency key required"})
		return
	}
	ctx, span := s.Telemetry.Tracer.Start(c.Request.Context(), "task.create")
	defer span.End()
	task, err := s.Store.Create(ctx, tenant(c), c.GetHeader("Idempotency-Key"), input.Name)
	if err != nil {
		span.RecordError(err)
		fail(c, err)
		return
	}
	c.JSON(201, task)
}
func (s *Server) get(c *gin.Context) {
	task, err := s.Store.Get(c.Request.Context(), tenant(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(200, task)
}
func (s *Server) list(c *gin.Context) {
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if err != nil || limit < 1 || limit > 100 {
		c.JSON(400, gin.H{"error": "limit must be 1..100"})
		return
	}
	tasks, err := s.Store.List(c.Request.Context(), tenant(c), c.Query("after"), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(200, gin.H{"items": tasks})
}
func (s *Server) cancel(c *gin.Context) {
	var input struct {
		Version *int64 `json:"version"`
	}
	if decode(c, &input) != nil || input.Version == nil || *input.Version < 0 {
		c.JSON(400, gin.H{"error": "expected version required"})
		return
	}
	task, err := s.Store.Cancel(c.Request.Context(), tenant(c), c.Param("id"), *input.Version)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(200, task)
}
func (s *Server) template(c *gin.Context) {
	load := func(ctx context.Context) (string, error) {
		body, _ := json.Marshal(gin.H{"id": c.Param("id"), "kind": "demo"})
		return string(body), nil
	}
	var body string
	var err error
	if s.Cache == nil {
		body, err = load(c.Request.Context())
	} else {
		body, err = s.Cache.Get(c.Request.Context(), tenant(c), c.Param("id"), load)
	}
	if err != nil {
		fail(c, err)
		return
	}
	c.Data(200, "application/json", []byte(body))
}
func (s *Server) events(c *gin.Context) {
	// Snapshot stream: no claim of durable intermediate-event replay. The API's 3s deadline bounds stream lifetime.
	task, err := s.Store.Get(c.Request.Context(), tenant(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Accel-Buffering", "no")
	previous := int64(-1)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		if task.Version != previous {
			c.SSEvent("task", task)
			c.Writer.Flush()
			previous = task.Version
		}
		if task.State == "SUCCEEDED" || task.State == "CANCELLED" || task.State == "FAILED" {
			return
		}
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
			task, err = s.Store.Get(c.Request.Context(), tenant(c), task.ID)
			if err != nil {
				return
			}
		}
	}
}
