//go:build integration

package integration

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"newswitch.dev/gin-service-lab/internal/store"
	"newswitch.dev/gin-service-lab/internal/transport"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func required(t *testing.T, key string) string {
	t.Helper()
	v := os.Getenv(key)
	if v == "" {
		t.Fatalf("set %s for an isolated lab; missing services are NOT skipped", key)
	}
	return v
}
func localStore(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(context.Background(), "sqlite", filepath.ToSlash(filepath.Join(t.TempDir(), "it.db")))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestPostgresContract(t *testing.T) {
	dsn := required(t, "GO_LAB_PG_DSN")
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid lab DSN")
	}
	if config.Database != "gin_lab" || (config.Host != "127.0.0.1" && config.Host != "localhost") {
		t.Fatal("test accepts only loopback database gin_lab")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s, err := store.Open(ctx, "pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	tenant := "it-" + store.ID()
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		for _, table := range []string{"notifications", "outbox", "tasks"} {
			_, e := s.DB.ExecContext(cleanup, "DELETE FROM "+table+" WHERE tenant=$1", tenant)
			if e != nil {
				t.Error(e)
			}
		}
	})
	a, err := s.Create(ctx, tenant, "key", "one")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Create(ctx, tenant, "key", "one")
	if err != nil || a.ID != b.ID {
		t.Fatal(b, err)
	}
	if _, err = s.Get(ctx, "other", a.ID); !errors.Is(err, store.ErrMissing) {
		t.Fatal(err)
	}
	claim, err := s.Claim(ctx, time.Now(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	// Use a dedicated empty gin_lab database: this test must not race another worker.
	if claim.Task.ID != a.ID {
		t.Fatal("gin_lab contains another eligible task; use a dedicated empty lab")
	}
	if err = s.Finish(ctx, claim, "done", time.Now()); err != nil {
		t.Fatal(err)
	}
}

func TestRedisCacheIsolation(t *testing.T) {
	address := required(t, "GO_LAB_REDIS_ADDR")
	if !strings.HasPrefix(address, "127.0.0.1:") {
		t.Fatal("loopback Redis required")
	}
	cache := transport.NewCache(address)
	defer cache.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	id := store.ID()
	var calls atomic.Int64
	load := func(context.Context) (string, error) { calls.Add(1); return "one", nil }
	for range 2 {
		if value, err := cache.Get(ctx, "alpha", id, load); err != nil || value != "one" {
			t.Fatal(value, err)
		}
	}
	if calls.Load() != 1 {
		t.Fatal("cache hit not observed; Redis may be unavailable")
	}
	if _, err := cache.Get(ctx, "beta", id, load); err != nil || calls.Load() != 2 {
		t.Fatal("tenant isolation", err)
	}
}

func TestKafkaConfirmedDeliveryAndInbox(t *testing.T) {
	address := required(t, "GO_LAB_KAFKA_ADDR")
	if !strings.HasPrefix(address, "127.0.0.1:") {
		t.Fatal("loopback Kafka required")
	}
	topic := required(t, "GO_LAB_KAFKA_TOPIC")
	s := localStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	task, err := s.Create(ctx, "alpha", "key", "one")
	if err != nil {
		t.Fatal(err)
	}
	producer, err := transport.NewKafka(address, topic, "")
	if err != nil {
		t.Fatal(err)
	}
	defer producer.Close()
	if err = s.RelayOnce(ctx, producer, time.Now()); err != nil {
		t.Fatal(err)
	}
	consumer, err := transport.NewKafka(address, topic, "it-"+store.ID())
	if err != nil {
		t.Fatal(err)
	}
	defer consumer.Close()
	consumeCtx, stop := context.WithCancel(ctx)
	defer stop()
	done := make(chan error, 1)
	go func() { done <- consumer.Consume(consumeCtx, s) }()
	defer func() {
		stop()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Error("consumer failed to stop")
		}
	}()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		var n int
		err = s.DB.QueryRowContext(ctx, "SELECT count(*) FROM notifications WHERE tenant=? AND task_id=?", "alpha", task.ID).Scan(&n)
		if err != nil {
			t.Fatal(err)
		}
		if n == 1 {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}
