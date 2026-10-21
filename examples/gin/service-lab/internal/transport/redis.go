package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/redis/go-redis/v9"
	"time"
)

type Cache struct {
	client *redis.Client
	origin chan struct{}
}

func NewCache(address string) *Cache {
	options := &redis.Options{Addr: address, DialTimeout: 500 * time.Millisecond, ReadTimeout: 300 * time.Millisecond, WriteTimeout: 300 * time.Millisecond, MaxRetries: -1, PoolSize: 4, PoolTimeout: 300 * time.Millisecond}
	return &Cache{client: redis.NewClient(options), origin: make(chan struct{}, 4)}
}
func (c *Cache) Close() error { return c.client.Close() }
func (c *Cache) Get(ctx context.Context, tenant, id string, load func(context.Context) (string, error)) (string, error) {
	if tenant == "" || id == "" || len(tenant) > 40 || len(id) > 80 {
		return "", fmt.Errorf("invalid cache key")
	}
	encoded, _ := json.Marshal([]string{tenant, id})
	key := "lab:template:v1:" + string(encoded)
	bounded, cancel := context.WithTimeout(ctx, 400*time.Millisecond)
	cached, err := c.client.Get(bounded, key).Result()
	cancel()
	if err == nil {
		return cached, nil
	}
	select {
	case c.origin <- struct{}{}:
		defer func() { <-c.origin }()
	default:
		return "", fmt.Errorf("origin capacity exhausted")
	}
	value, err := load(ctx)
	if err != nil {
		return "", err
	}
	bounded, cancel = context.WithTimeout(ctx, 400*time.Millisecond)
	defer cancel()
	_ = c.client.Set(bounded, key, value, 30*time.Second).Err()
	return value, nil
}
