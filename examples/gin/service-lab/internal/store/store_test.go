package store

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	s, err := Open(ctx, "sqlite", filepath.ToSlash(filepath.Join(t.TempDir(), "lab.db"))+"?_pragma=busy_timeout(1000)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func TestCreateIdempotency(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	a, err := s.Create(ctx, "alpha", "key", "one")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Create(ctx, "alpha", "key", "one")
	if err != nil || a.ID != b.ID {
		t.Fatal(b, err)
	}
	if _, err = s.Create(ctx, "alpha", "key", "different"); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
}
func TestTenantVisibility(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	a, _ := s.Create(ctx, "alpha", "key", "one")
	if _, err := s.Get(ctx, "beta", a.ID); !errors.Is(err, ErrMissing) {
		t.Fatal(err)
	}
	other, err := s.Create(ctx, "beta", "key", "two")
	if err != nil || other.ID == a.ID {
		t.Fatal(other, err)
	}
}
func TestRollbackOutboxFailure(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	if _, err := s.DB.Exec("CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'forced failure'); END"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, "alpha", "key", "one"); err == nil {
		t.Fatal("expected failure")
	}
	var n int
	s.DB.QueryRow("SELECT COUNT(*) FROM tasks").Scan(&n)
	if n != 0 {
		t.Fatal(n)
	}
}
func TestCancelVersion(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	a, _ := s.Create(ctx, "alpha", "key", "one")
	b, err := s.Cancel(ctx, "alpha", a.ID, 0)
	if err != nil || b.State != "CANCELLED" || b.Version != 1 {
		t.Fatal(b, err)
	}
	if _, err = s.Cancel(ctx, "alpha", a.ID, 0); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
}
func TestClaimAndFinish(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	s.Create(ctx, "alpha", "key", "one")
	now := time.Now()
	claim, err := s.Claim(ctx, now, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Finish(ctx, claim, "done", now.Add(time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	task, _ := s.Get(ctx, "alpha", claim.Task.ID)
	if task.State != "SUCCEEDED" || task.Version != 2 {
		t.Fatal(task)
	}
}
func TestExpiredWorkerIsFenced(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	s.Create(ctx, "alpha", "key", "one")
	now := time.Now()
	old, _ := s.Claim(ctx, now, time.Second)
	fresh, err := s.Claim(ctx, now.Add(2*time.Second), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Finish(ctx, old, "old", now.Add(2*time.Second)); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if err = s.Finish(ctx, fresh, "fresh", now.Add(2100*time.Millisecond)); err != nil {
		t.Fatal(err)
	}
}
func TestExpiredLeaseCannotFinishWithoutReclaim(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	s.Create(ctx, "alpha", "key", "one")
	now := time.Now()
	claim, _ := s.Claim(ctx, now, time.Second)
	if err := s.Finish(ctx, claim, "late", now.Add(2*time.Second)); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
}
func TestConcurrentIdempotency(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	ids := make(chan string, 8)
	errorsChannel := make(chan error, 8)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			task, err := s.Create(ctx, "alpha", "same", "one")
			if err != nil {
				errorsChannel <- err
				return
			}
			ids <- task.ID
		})
	}
	wg.Wait()
	close(ids)
	close(errorsChannel)
	for err := range errorsChannel {
		t.Fatal(err)
	}
	unique := map[string]bool{}
	for id := range ids {
		unique[id] = true
	}
	if len(unique) != 1 {
		t.Fatal(unique)
	}
	var n int
	s.DB.QueryRow("SELECT COUNT(*) FROM outbox").Scan(&n)
	if n != 1 {
		t.Fatal(n)
	}
}
func TestInboxDuplicateAndCollision(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	event := Event{ID: "event1", TaskID: "task1", Tenant: "alpha", Kind: "TaskCreated"}
	applied, err := s.Apply(ctx, event)
	if err != nil || !applied {
		t.Fatal(applied, err)
	}
	applied, err = s.Apply(ctx, event)
	if err != nil || applied {
		t.Fatal(applied, err)
	}
	event.Tenant = "beta"
	if _, err = s.Apply(ctx, event); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
}
func TestInboxFailureRollsBackDedup(t *testing.T) {
	s := openTest(t)
	s.DB.Exec("CREATE TRIGGER reject_notification BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'forced'); END")
	event := Event{ID: "event1", TaskID: "task1", Tenant: "alpha", Kind: "TaskCreated"}
	if _, err := s.Apply(context.Background(), event); err == nil {
		t.Fatal("expected failure")
	}
	var n int
	s.DB.QueryRow("SELECT COUNT(*) FROM inbox").Scan(&n)
	if n != 0 {
		t.Fatal(n)
	}
}
func TestRelayRetryAndDedup(t *testing.T) {
	s := openTest(t)
	ctx := context.Background()
	s.Create(ctx, "alpha", "key", "one")
	now := time.Now()
	var received []Event
	publisher := PublisherFunc(func(ctx context.Context, e Event) error {
		received = append(received, e)
		if len(received) == 1 {
			return fmt.Errorf("accepted but confirmation lost")
		}
		return nil
	})
	if err := s.RelayOnce(ctx, publisher, now); err == nil {
		t.Fatal("expected unknown result")
	}
	if err := s.RelayOnce(ctx, publisher, now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	if len(received) != 2 || received[0].ID != received[1].ID {
		t.Fatal(received)
	}
	a, _ := s.Apply(ctx, received[0])
	b, _ := s.Apply(ctx, received[1])
	if !a || b {
		t.Fatal(a, b)
	}
}
func TestConcurrentInbox(t *testing.T) {
	s := openTest(t)
	event := Event{ID: "event1", TaskID: "task1", Tenant: "alpha", Kind: "TaskCreated"}
	var wg sync.WaitGroup
	var effects atomic.Int64
	for range 8 {
		wg.Go(func() {
			applied, err := s.Apply(context.Background(), event)
			if err != nil {
				t.Error(err)
			}
			if applied {
				effects.Add(1)
			}
		})
	}
	wg.Wait()
	if effects.Load() != 1 {
		t.Fatal(effects.Load())
	}
}
func TestListBounds(t *testing.T) {
	s := openTest(t)
	if _, err := s.List(context.Background(), "alpha", "", 101); err == nil {
		t.Fatal("expected limit rejection")
	}
}
func TestPersistAcrossReopen(t *testing.T) {
	dsn := filepath.ToSlash(filepath.Join(t.TempDir(), "persist.db"))
	ctx := context.Background()
	a, err := Open(ctx, "sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	task, err := a.Create(ctx, "alpha", "key", "one")
	a.Close()
	if err != nil {
		t.Fatal(err)
	}
	b, err := Open(ctx, "sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	loaded, err := b.Get(ctx, "alpha", task.ID)
	if err != nil || loaded.ID != task.ID {
		t.Fatal(loaded, err)
	}
}
