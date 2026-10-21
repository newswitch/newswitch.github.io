package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestExhaustedClaimBecomesFailed(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	task, err := s.Create(ctx, "alpha", "exhaust", "one")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for i := 0; i < 3; i++ {
		if _, err := s.Claim(ctx, now.Add(time.Duration(i)*2*time.Second), time.Second); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Claim(ctx, now.Add(7*time.Second), time.Second); !errors.Is(err, ErrMissing) {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, "alpha", task.ID)
	if err != nil || got.State != "FAILED" || got.Version != 4 {
		t.Fatal(got, err)
	}
	var n int
	if err := s.DB.QueryRow("SELECT count(*) FROM outbox WHERE task_id=? AND kind='TaskFailed'", task.ID).Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
}
