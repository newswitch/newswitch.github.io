package lifecycle

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sync/errgroup"
)

func TestContextOwnership(t *testing.T) {
	got := Contexts()
	if !got.ChildLeavesParentActive || !got.SiblingReceivesCause || !got.FirstChildCausePreserved || !got.DeadlineNotExtended || !got.DetachedDoneNil || got.DetachedValue != "request-42" {
		t.Fatalf("%+v", got)
	}
	t.Logf("%+v", got)
}
func TestErrgroupErrorsAndJoin(t *testing.T) {
	got := Groups()
	if !got.FirstError || !got.CausePreserved || got.Joined != 2 || !got.SuccessWaitErrorNil || !got.SuccessContextCanceled || !got.CanceledParentWaitErrorNil {
		t.Fatalf("%+v", got)
	}
	t.Logf("%+v", got)
}
func TestErrgroupLimitDoesNotCancelAdmission(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	defer cancel()
	group, ctx := errgroup.WithContext(parent)
	group.SetLimit(1)
	release, started, submitting, submitted := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	group.Go(func() error { close(started); <-release; return nil })
	<-started
	if group.TryGo(func() error { return nil }) {
		t.Fatal("TryGo exceeded the active limit")
	}
	var secondRan atomic.Bool
	var submitter sync.WaitGroup
	submitter.Go(func() {
		close(submitting)
		group.Go(func() error { secondRan.Store(true); return ctx.Err() })
		close(submitted)
	})
	<-submitting
	cancel()
	select {
	case <-submitted:
		t.Fatal("cancel incorrectly freed an occupied admission slot")
	default:
	}
	unblock()
	<-submitted
	submitter.Wait()
	if !errors.Is(group.Wait(), context.Canceled) || !secondRan.Load() {
		t.Fatal("Go did not start the callback after a slot became free")
	}
	t.Log("TryGo=false; cancellation leaves Go blocked while slot is held; callback starts after release and observes canceled Context")
}
func TestAfterFuncStopIsNotJoin(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	stop := context.AfterFunc(ctx, func() { close(started); <-release; close(done) })
	defer func() { unblock(); <-done }()
	cancel()
	<-started
	if stop() {
		t.Fatal("already started callback was stopped")
	}
	select {
	case <-done:
		t.Fatal("callback unexpectedly completed")
	default:
	}
	unblock()
	<-done
}
func TestStreamingPipeline(t *testing.T) {
	got, err := Pipeline()
	if err != nil {
		t.Fatal(err)
	}
	if got.Produced != 1000 || got.Processed != 1000 || got.Consumed != 1000 || got.PeakActive != 2 || got.ActiveAtReturn != 0 || !got.Joined || got.Sum != 332833500 {
		t.Fatalf("%+v", got)
	}
	t.Logf("%+v", got)
}
func TestPipelineFailurePaths(t *testing.T) {
	identity := func(_ context.Context, value int) (int, error) { return value, nil }
	consume := func(context.Context, int) error { return nil }
	t.Run("processor-error", func(t *testing.T) {
		failure := errors.New("processor failed")
		stats, err := Run(context.Background(), 1000, 2, 1, func(_ context.Context, value int) (int, error) {
			if value == 7 {
				return 0, failure
			}
			return value, nil
		}, consume)
		if !errors.Is(err, failure) || !stats.Joined || stats.ActiveAtReturn != 0 || stats.PeakActive > 2 {
			t.Fatal(stats, err)
		}
	})
	t.Run("consumer-error", func(t *testing.T) {
		failure := errors.New("consumer failed")
		stats, err := Run(context.Background(), 1000, 2, 1, identity, func(context.Context, int) error { return failure })
		if !errors.Is(err, failure) || !stats.Joined || stats.ActiveAtReturn != 0 || stats.Consumed != 0 {
			t.Fatal(stats, err)
		}
	})
	t.Run("cancel-during-processing", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		started := make(chan struct{})
		var once sync.Once
		type outcome struct {
			stats Stats
			err   error
		}
		done := make(chan outcome, 1)
		go func() {
			stats, err := Run(ctx, 1000, 2, 1, func(ctx context.Context, value int) (int, error) {
				once.Do(func() { close(started) })
				<-ctx.Done()
				return 0, ctx.Err()
			}, consume)
			done <- outcome{stats, err}
		}()
		<-started
		cancel()
		select {
		case got := <-done:
			if !errors.Is(got.err, context.Canceled) || !got.stats.Joined || got.stats.ActiveAtReturn != 0 {
				t.Fatal(got)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("pipeline did not join")
		}
	})
	t.Run("unbuffered-results", func(t *testing.T) {
		stats, err := Run(context.Background(), 1000, 2, 0, identity, consume)
		if err != nil || stats.Consumed != 1000 || !stats.Joined {
			t.Fatal(stats, err)
		}
	})
	t.Run("zero-input", func(t *testing.T) {
		stats, err := Run(context.Background(), 0, 2, 1, identity, consume)
		if err != nil || stats.Consumed != 0 || !stats.Joined {
			t.Fatal(stats, err)
		}
	})
	t.Run("invalid-bound", func(t *testing.T) {
		if _, err := Run(context.Background(), 1000000, 0, 100000, identity, consume); err == nil {
			t.Fatal("unbounded configuration accepted")
		}
	})
}
func TestRepeatedCancellationJoinsOwnedTasks(t *testing.T) {
	for range 20 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		started := make(chan struct{})
		var once sync.Once
		type outcome struct {
			stats Stats
			err   error
		}
		done := make(chan outcome, 1)
		go func() {
			stats, err := Run(ctx, 1000, 2, 1, func(ctx context.Context, value int) (int, error) {
				once.Do(func() { close(started) })
				<-ctx.Done()
				return 0, ctx.Err()
			}, func(context.Context, int) error { return nil })
			done <- outcome{stats, err}
		}()
		select {
		case <-started:
		case <-ctx.Done():
			cancel()
			t.Fatal("processor did not start")
		}
		cancel()
		got := <-done
		if !errors.Is(got.err, context.Canceled) || !got.stats.Joined || got.stats.ActiveAtReturn != 0 {
			t.Fatal(got.stats, got.err)
		}
	}
}

func TestProfileWriteFailureStillJoins(t *testing.T) {
	file := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(file, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Leak(file); err == nil {
		t.Fatal("expected profile directory error")
	}
	if countAbandoned(stackSnapshot()) != 0 {
		t.Fatal("profile failure left senders blocked")
	}
}
func TestAbandonedSendIsRecovered(t *testing.T) {
	got, err := Leak(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if got.BlockedAfterCancel != 8 || got.BlockedAfterDrain != 0 || got.CancellationAwareJoined != 8 {
		t.Fatalf("%+v", got)
	}
	data, err := os.ReadFile(got.Profile)
	if err != nil || !strings.Contains(string(data), "lifecycle.abandonedSender(") {
		t.Fatal("missing owned worker stacks", err)
	}
	t.Logf("%+v", got)
}
