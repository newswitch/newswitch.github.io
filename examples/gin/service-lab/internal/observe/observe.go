package observe

import (
	"context"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type Telemetry struct {
	Provider *sdktrace.TracerProvider
	Tracer   trace.Tracer
	Registry *prometheus.Registry
	requests *prometheus.CounterVec
	latency  *prometheus.HistogramVec
}

func New(ctx context.Context, endpoint string) (*Telemetry, error) {
	options := []sdktrace.TracerProviderOption{sdktrace.WithSampler(sdktrace.AlwaysSample()), sdktrace.WithResource(resource.NewSchemaless(attribute.String("service.name", "gin-task-lab")))}
	if endpoint != "" {
		u, err := url.Parse(endpoint)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return nil, fmt.Errorf("invalid OTLP HTTP endpoint")
		}
		if u.Path == "" || u.Path == "/" {
			u.Path = "/v1/traces"
		}
		endpoint = u.String()
		exporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(endpoint), otlptracehttp.WithTimeout(time.Second), otlptracehttp.WithRetry(otlptracehttp.RetryConfig{Enabled: false}))
		if err != nil {
			return nil, err
		}
		options = append(options, sdktrace.WithBatcher(exporter, sdktrace.WithBatchTimeout(200*time.Millisecond), sdktrace.WithMaxQueueSize(256)))
	}
	provider := sdktrace.NewTracerProvider(options...)
	registry := prometheus.NewRegistry()
	requests := prometheus.NewCounterVec(prometheus.CounterOpts{Name: "lab_http_requests_total", Help: "Completed HTTP requests"}, []string{"route", "status"})
	latency := prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "lab_http_request_duration_seconds", Help: "Handler duration", Buckets: prometheus.DefBuckets}, []string{"route"})
	registry.MustRegister(requests, latency, prometheus.NewGoCollector(), prometheus.NewProcessCollector(prometheus.ProcessCollectorOpts{}))
	return &Telemetry{Provider: provider, Tracer: provider.Tracer("newswitch.dev/gin-lab"), Registry: registry, requests: requests, latency: latency}, nil
}
func (t *Telemetry) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		parent := propagation.TraceContext{}.Extract(c.Request.Context(), propagation.HeaderCarrier(c.Request.Header))
		ctx, span := t.Tracer.Start(parent, c.Request.Method+" "+route, trace.WithSpanKind(trace.SpanKindServer))
		c.Request = c.Request.WithContext(ctx)
		c.Header("X-Trace-ID", span.SpanContext().TraceID().String())
		start := time.Now()
		defer func() {
			status := c.Writer.Status()
			slog.InfoContext(ctx, "http completed", "method", c.Request.Method, "route", route, "status", status, "duration_ms", time.Since(start).Milliseconds(), "trace_id", span.SpanContext().TraceID().String())
			span.SetAttributes(attribute.String("http.route", route), attribute.Int("http.response.status_code", status))
			if status >= 500 {
				span.SetStatus(codes.Error, "server failure")
			}
			span.End()
			t.requests.WithLabelValues(route, strconv.Itoa(status)).Inc()
			t.latency.WithLabelValues(route).Observe(time.Since(start).Seconds())
		}()
		c.Next()
	}
}
func (t *Telemetry) Metrics() http.Handler {
	return promhttp.HandlerFor(t.Registry, promhttp.HandlerOpts{})
}
func (t *Telemetry) Close(ctx context.Context) error { return t.Provider.Shutdown(ctx) }
