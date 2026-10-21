package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	httpprof "net/http/pprof"
	"newswitch.dev/gin-service-lab/internal/app"
	"newswitch.dev/gin-service-lab/internal/observe"
	"newswitch.dev/gin-service-lab/internal/store"
	"newswitch.dev/gin-service-lab/internal/transport"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

const demoKey = "lab-only-public-key-never-use-in-production"

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func loopback(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
func main() {
	if err := run(); err != nil {
		slog.Error("taskd stopped", "error", err.Error())
		os.Exit(1)
	}
}
func run() error {
	mode := flag.String("mode", "serve", "serve,worker,relay,consume,token")
	address := flag.String("listen", "127.0.0.1:8084", "API address")
	admin := flag.String("admin", "127.0.0.1:9091", "loopback admin address")
	driver := flag.String("driver", envOr("LAB_DB_DRIVER", "sqlite"), "sqlite or pgx")
	dsn := flag.String("dsn", envOr("LAB_DB_DSN", "file:tasks.db?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"), "isolated database DSN; prefer LAB_DB_DSN for secrets")
	demo := flag.Bool("demo", false, "use public lab signing key; loopback API only")
	tenant := flag.String("tenant", "alpha", "token tenant")
	scopes := flag.String("scopes", "task:read task:write", "token scopes")
	watch := flag.Bool("watch", false, "keep worker polling until signal")
	redisAddress := flag.String("redis", "", "optional isolated Redis address")
	kafkaAddress := flag.String("kafka", "127.0.0.1:19092", "isolated broker")
	topic := flag.String("topic", "go-lab-events", "topic")
	flag.Parse()
	key := []byte(os.Getenv("LAB_JWT_KEY"))
	if *demo {
		key = []byte(demoKey)
	}
	if *mode == "token" {
		if len(key) < 32 {
			return fmt.Errorf("set LAB_JWT_KEY to at least 32 bytes, or use isolated -demo")
		}
		token, err := app.Token(key, *tenant, *scopes, time.Now().Add(time.Hour))
		if err != nil {
			return err
		}
		fmt.Println(token)
		return nil
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	openCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	s, err := store.Open(openCtx, *driver, *dsn)
	cancel()
	if err != nil {
		return err
	}
	defer s.Close()
	if *mode == "worker" {
		for {
			err := app.RunOne(ctx, s)
			if !*watch {
				if errors.Is(err, store.ErrMissing) {
					fmt.Println("no eligible task")
					return nil
				}
				return err
			}
			if err != nil && !errors.Is(err, store.ErrMissing) && !errors.Is(err, store.ErrConflict) {
				return err
			}
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(200 * time.Millisecond):
			}
		}
	}
	if *mode == "relay" || *mode == "consume" {
		group := ""
		if *mode == "consume" {
			group = "go-lab-notifications"
		}
		kafka, err := transport.NewKafka(*kafkaAddress, *topic, group)
		if err != nil {
			return err
		}
		defer kafka.Close()
		if *mode == "consume" {
			return kafka.Consume(ctx, s)
		}
		return s.RelayOnce(ctx, kafka, time.Now())
	}
	if *mode != "serve" {
		return fmt.Errorf("unknown mode")
	}
	if *demo && !loopback(*address) {
		return fmt.Errorf("public demo key cannot serve a remote address")
	}
	if !loopback(*admin) {
		return fmt.Errorf("admin listener must use a numeric loopback address")
	}
	telemetry, err := observe.New(ctx, os.Getenv("LAB_OTLP_ENDPOINT"))
	if err != nil {
		return err
	}
	defer func() {
		shutdown, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		telemetry.Close(shutdown)
	}()
	var cache *transport.Cache
	if *redisAddress != "" {
		cache = transport.NewCache(*redisAddress)
		defer cache.Close()
	}
	_, handler, err := app.New(s, telemetry, key, 16, cache)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", *address)
	if err != nil {
		return err
	}
	defer listener.Close()
	adminListener, err := net.Listen("tcp", *admin)
	if err != nil {
		return err
	}
	defer adminListener.Close()
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 2 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second}
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", telemetry.Metrics())
	mux.HandleFunc("GET /debug/pprof/", httpprof.Index)
	mux.HandleFunc("GET /debug/pprof/profile", httpprof.Profile)
	mux.HandleFunc("GET /debug/pprof/trace", httpprof.Trace)
	adminServer := &http.Server{Handler: mux, ReadHeaderTimeout: 2 * time.Second, IdleTimeout: 30 * time.Second}
	var wg sync.WaitGroup
	failures := make(chan error, 2)
	wg.Go(func() { failures <- server.Serve(listener) })
	wg.Go(func() { failures <- adminServer.Serve(adminListener) })
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	slog.Info("server started", "api", listener.Addr().String(), "admin", adminListener.Addr().String())
	select {
	case err = <-failures:
	case <-ctx.Done():
		err = nil
	}
	stop()
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if shutdownErr := server.Shutdown(shutdown); shutdownErr != nil {
		server.Close()
	}
	if shutdownErr := adminServer.Shutdown(shutdown); shutdownErr != nil {
		adminServer.Close()
	}
	wg.Wait()
	if err != nil && !errors.Is(err, http.ErrServerClosed) && !strings.Contains(err.Error(), "closed network connection") {
		return err
	}
	return nil
}
