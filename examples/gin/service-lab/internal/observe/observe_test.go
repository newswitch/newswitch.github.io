package observe

import (
	"context"
	"github.com/gin-gonic/gin"
	collector "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestActualOTLPAndMetrics(t *testing.T) {
	var mu sync.Mutex
	var spans []*tracepb.Span
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/traces" {
			t.Error(r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var request collector.ExportTraceServiceRequest
		if err := proto.Unmarshal(body, &request); err != nil {
			t.Error(err)
		}
		mu.Lock()
		for _, resource := range request.ResourceSpans {
			for _, scope := range resource.ScopeSpans {
				spans = append(spans, scope.Spans...)
			}
		}
		mu.Unlock()
		w.Header().Set("Content-Type", "application/x-protobuf")
		w.WriteHeader(200)
	}))
	defer receiver.Close()
	telemetry, err := New(context.Background(), receiver.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer telemetry.Close(context.Background())
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(telemetry.Middleware())
	r.GET("/work", func(c *gin.Context) {
		_, span := telemetry.Tracer.Start(c.Request.Context(), "business.work")
		span.End()
		c.String(200, "ok")
	})
	response := httptest.NewRecorder()
	r.ServeHTTP(response, httptest.NewRequest("GET", "/work", nil))
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err = telemetry.Provider.ForceFlush(ctx); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	var parent, child *tracepb.Span
	for _, span := range spans {
		if span.Name == "GET /work" {
			parent = span
		}
		if span.Name == "business.work" {
			child = span
		}
	}
	if parent == nil || child == nil || string(child.ParentSpanId) != string(parent.SpanId) || string(child.TraceId) != string(parent.TraceId) {
		t.Fatal("parent/child not exported")
	}
	metrics := httptest.NewRecorder()
	telemetry.Metrics().ServeHTTP(metrics, httptest.NewRequest("GET", "/metrics", nil))
	if !strings.Contains(metrics.Body.String(), "lab_http_requests_total") {
		t.Fatal("missing metric")
	}
}
func TestExporterFailureDoesNotFailHandler(t *testing.T) {
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
	defer receiver.Close()
	telemetry, err := New(context.Background(), receiver.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer telemetry.Close(context.Background())
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(telemetry.Middleware())
	r.GET("/work", func(c *gin.Context) { c.String(200, "ok") })
	response := httptest.NewRecorder()
	r.ServeHTTP(response, httptest.NewRequest("GET", "/work", nil))
	if response.Code != 200 {
		t.Fatal(response.Code)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = telemetry.Provider.ForceFlush(ctx)
}
