package transport

import (
	"context"
	"net"
	"testing"
	"time"
)

func TestCacheOutageFallsBackWithinBudget(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	cache := NewCache(address)
	defer cache.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	got, err := cache.Get(ctx, "alpha", "v1", func(context.Context) (string, error) { return "origin", nil })
	if err != nil || got != "origin" || ctx.Err() != nil {
		t.Fatal(got, err, ctx.Err())
	}
}
func TestCacheRejectsEmptyTenant(t *testing.T) {
	cache := NewCache("127.0.0.1:1")
	defer cache.Close()
	if _, err := cache.Get(context.Background(), "", "id", func(context.Context) (string, error) { t.Fatal("unexpected origin"); return "", nil }); err == nil {
		t.Fatal("missing validation")
	}
}
