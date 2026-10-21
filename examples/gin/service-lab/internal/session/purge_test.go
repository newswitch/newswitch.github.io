package session

import (
	"context"
	"testing"
	"time"
)

func TestExpiryCleanupHasBoundedBatch(t *testing.T) {
	s, clock := fixture(t)
	ctx := context.Background()
	for range 3 {
		if _, err := s.Create(ctx, Identity{"user", "alpha"}, ""); err != nil {
			t.Fatal(err)
		}
	}
	clock.Add((3 * time.Minute).Milliseconds())
	n, err := s.PurgeExpired(ctx, 2)
	if err != nil || n != 2 {
		t.Fatal(n, err)
	}
	var left int
	if err = s.DB.QueryRow("SELECT count(*) FROM lab_sessions").Scan(&left); err != nil || left != 1 {
		t.Fatal(left, err)
	}
	if _, err = s.PurgeExpired(ctx, 100000); err == nil {
		t.Fatal("unbounded batch accepted")
	}
	t.Log("expired=3 purged=2 remaining=1 invalid-batch=rejected")
}
