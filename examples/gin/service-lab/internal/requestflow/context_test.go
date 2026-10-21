package requestflow

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/sync/errgroup"
)

type traceKey struct{}

func TestGinContextFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, fallback := range []bool{false, true} {
		t.Run(fmt.Sprintf("fallback=%t", fallback), func(t *testing.T) {
			router := gin.New()
			router.ContextWithFallback = fallback
			parent, cancel := context.WithTimeout(context.WithValue(context.Background(), traceKey{}, "trace-42"), time.Hour)
			cancel()
			router.GET("/", func(c *gin.Context) {
				c.Set("tenant", "alpha")
				_, deadline := c.Deadline()
				if deadline != fallback || (c.Done() != nil) != fallback || (c.Err() != nil) != fallback || (c.Value(traceKey{}) != nil) != fallback || c.Value("tenant") != "alpha" || !errors.Is(c.Request.Context().Err(), context.Canceled) {
					t.Error("unexpected fallback boundary")
				}
				c.Status(204)
			})
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest("GET", "/", nil).WithContext(parent))
			if recorder.Code != 204 {
				t.Fatal(recorder.Code)
			}
		})
	}
}
func TestGinCopyBoundaries(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/tasks/:id", func(c *gin.Context) {
		nested := map[string]int{"value": 1}
		c.Set("scalar", "alpha")
		c.Set("nested", nested)
		copy := c.Copy()
		c.Set("scalar", "beta")
		nested["value"] = 2
		c.Params[0].Value = "changed"
		if copy.GetString("scalar") != "alpha" || copy.Param("id") != "t1" || copy.MustGet("nested").(map[string]int)["value"] != 2 || copy.Request != c.Request || copy.Writer == c.Writer || copy.FullPath() != "/tasks/:id" {
			t.Error("copy isolation boundary changed")
		}
		c.Status(204)
	})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest("GET", "/tasks/t1", nil))
	if recorder.Code != 204 {
		t.Fatal(recorder.Code)
	}
}
func TestGinCopyKeepsRequestCancellation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	copied := make(chan *gin.Context, 1)
	router.GET("/", func(c *gin.Context) { c.Set("tenant", "alpha"); copied <- c.Copy(); c.String(200, "done") })
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()
	client.Timeout = 2 * time.Second
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	_, err = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	copy := <-copied
	select {
	case <-copy.Request.Context().Done():
	case <-time.After(2 * time.Second):
		t.Fatal("Copy unexpectedly detached the HTTP request Context")
	}
	if copy.GetString("tenant") != "alpha" || !errors.Is(copy.Request.Context().Err(), context.Canceled) {
		t.Fatal("snapshot or cancellation changed")
	}
}
func TestGinHandlerChain(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Run("nested-next", func(t *testing.T) {
		var trace []string
		router := gin.New()
		router.Use(func(c *gin.Context) {
			trace = append(trace, "outer-before")
			c.Next()
			trace = append(trace, "outer-after")
		})
		router.Use(func(c *gin.Context) {
			trace = append(trace, "inner-before")
			c.Next()
			trace = append(trace, "inner-after")
		})
		router.GET("/", func(c *gin.Context) { trace = append(trace, "handler"); c.Status(204) })
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
		if !reflect.DeepEqual(trace, []string{"outer-before", "inner-before", "handler", "inner-after", "outer-after"}) {
			t.Fatal(trace)
		}
	})
	t.Run("abort-is-not-return", func(t *testing.T) {
		var trace []string
		router := gin.New()
		router.Use(func(c *gin.Context) {
			trace = append(trace, "outer-before")
			c.Next()
			trace = append(trace, "outer-after")
		})
		router.Use(func(c *gin.Context) {
			trace = append(trace, "denied")
			c.AbortWithStatus(403)
			trace = append(trace, "after-abort")
		})
		router.GET("/", func(c *gin.Context) { trace = append(trace, "handler") })
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest("GET", "/", nil))
		if recorder.Code != 403 || !reflect.DeepEqual(trace, []string{"outer-before", "denied", "after-abort", "outer-after"}) {
			t.Fatal(recorder.Code, trace)
		}
	})
	t.Run("return-alone-does-not-abort", func(t *testing.T) {
		called := false
		router := gin.New()
		router.Use(func(c *gin.Context) { return })
		router.GET("/", func(c *gin.Context) { called = true; c.Status(204) })
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
		if !called {
			t.Fatal("return incorrectly stopped the outer dispatch loop")
		}
	})
}

func TestGinDeadlineJoinsRequestWork(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	var active, joined atomic.Int64
	router.GET("/", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 40*time.Millisecond)
		defer cancel()
		group, child := errgroup.WithContext(ctx)
		for range 2 {
			group.Go(func() error {
				active.Add(1)
				defer active.Add(-1)
				defer joined.Add(1)
				<-child.Done()
				return child.Err()
			})
		}
		if err := group.Wait(); errors.Is(err, context.DeadlineExceeded) {
			c.String(504, "deadline")
			return
		}
		c.Status(500)
	})
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()
	client.Timeout = 2 * time.Second
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	_, err = io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 504 || active.Load() != 0 || joined.Load() != 2 {
		t.Fatal(response.StatusCode, active.Load(), joined.Load())
	}
	t.Logf("status=%d active-at-response=%d joined=%d", response.StatusCode, active.Load(), joined.Load())
}
func TestGinDeadlineDoesNotKillIgnoredWork(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	release, done, started := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	var active atomic.Int64
	t.Cleanup(func() {
		unblock()
		select {
		case <-started:
			<-done
		default:
		}
	})
	router.GET("/", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 40*time.Millisecond)
		defer cancel()
		result := make(chan string, 1)
		go func() {
			defer close(done)
			active.Add(1)
			defer active.Add(-1)
			close(started)
			<-release
			result <- "finished"
		}()
		<-started
		select {
		case <-ctx.Done():
			c.String(504, "deadline")
		case value := <-result:
			c.String(200, value)
		}
	})
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()
	client.Timeout = 2 * time.Second
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 504 || strings.TrimSpace(string(data)) != "deadline" || active.Load() != 1 {
		t.Fatal(response.StatusCode, active.Load())
	}
	t.Logf("status=%d active-at-response=%d", response.StatusCode, active.Load())
	unblock()
	<-done
	if active.Load() != 0 {
		t.Fatal("owned worker did not join during cleanup")
	}
}
