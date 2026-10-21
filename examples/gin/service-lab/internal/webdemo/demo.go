package webdemo

import (
	"bytes"
	"context"
	"fmt"
	"github.com/gin-gonic/gin"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
)

func router() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.SetTrustedProxies(nil)
	return r
}
func Run(name string) ([]string, error) {
	r := router()
	rec := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/tasks/t1", nil)
	switch name {
	case "routing":
		r.GET("/tasks/:id", func(c *gin.Context) { c.String(200, "id="+c.Param("id")) })
	case "middleware":
		var order []string
		r.Use(func(c *gin.Context) { order = append(order, "before"); c.Next(); order = append(order, "after") })
		r.GET("/tasks/:id", func(c *gin.Context) { order = append(order, "handler"); c.Status(200) })
		r.ServeHTTP(rec, request)
		return []string{strings.Join(order, " -> ")}, nil
	case "abort":
		r.Use(func(c *gin.Context) { c.AbortWithStatusJSON(401, gin.H{"error": "unauthenticated"}); return })
		r.GET("/tasks/:id", func(c *gin.Context) { panic("must not run") })
	case "binding":
		type Input struct {
			Name string `json:"name" binding:"required,max=80"`
		}
		r.POST("/tasks", func(c *gin.Context) {
			var input Input
			if err := c.ShouldBindJSON(&input); err != nil {
				c.JSON(400, gin.H{"error": "invalid input"})
				return
			}
			c.JSON(201, input)
		})
		request = httptest.NewRequest(http.MethodPost, "/tasks", strings.NewReader(`{}`))
		request.Header.Set("Content-Type", "application/json")
	case "json":
		r.GET("/tasks/:id", func(c *gin.Context) { c.JSON(200, gin.H{"id": c.Param("id"), "count": 0}) })
	case "context":
		r.GET("/tasks/:id", func(c *gin.Context) {
			ctx, cancel := context.WithCancel(c.Request.Context())
			cancel()
			c.String(200, fmt.Sprintf("request-cancelled=%t", ctx.Err() != nil))
		})
	case "copy":
		r.GET("/tasks/:id", func(c *gin.Context) {
			c.Set("tenant", "alpha")
			copy := c.Copy()
			done := make(chan string, 1)
			go func() { done <- copy.GetString("tenant") }()
			c.String(200, "copied="+<-done)
		})
	case "upload":
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, _ := writer.CreateFormFile("file", "note.txt")
		part.Write([]byte("abc"))
		writer.Close()
		r.POST("/upload", func(c *gin.Context) {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
			file, err := c.FormFile("file")
			if err != nil {
				c.Status(400)
				return
			}
			opened, err := file.Open()
			if err != nil {
				c.Status(500)
				return
			}
			defer opened.Close()
			n, err := io.Copy(io.Discard, io.LimitReader(opened, 16))
			if err != nil {
				c.Status(500)
				return
			}
			c.String(200, fmt.Sprintf("bytes=%d", n))
		})
		request = httptest.NewRequest(http.MethodPost, "/upload", &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
	case "sse":
		r.GET("/tasks/:id", func(c *gin.Context) { c.SSEvent("state", gin.H{"state": "NEW"}); c.Writer.Flush() })
	case "cookie":
		r.GET("/tasks/:id", func(c *gin.Context) {
			c.SetCookieData(&http.Cookie{Name: "session", Value: "opaque-demo", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode})
			c.String(200, "cookie-set")
		})
	case "proxy":
		r.GET("/tasks/:id", func(c *gin.Context) { c.String(200, "client="+c.ClientIP()) })
		request.RemoteAddr = "192.0.2.10:1234"
		request.Header.Set("X-Forwarded-For", "198.51.100.99")
	case "recovery":
		r.Use(gin.RecoveryWithWriter(io.Discard))
		r.GET("/tasks/:id", func(c *gin.Context) { panic("controlled panic") })
	default:
		return nil, fmt.Errorf("unknown web experiment %q", name)
	}
	r.ServeHTTP(rec, request)
	if name == "cookie" {
		cookie := rec.Result().Cookies()[0]
		return []string{fmt.Sprintf("status=%d httpOnly=%t sameSite=%d", rec.Code, cookie.HttpOnly, cookie.SameSite)}, nil
	}
	return []string{fmt.Sprintf("status=%d", rec.Code), strings.TrimSpace(rec.Body.String())}, nil
}
