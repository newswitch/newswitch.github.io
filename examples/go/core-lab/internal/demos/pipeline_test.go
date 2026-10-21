package demos

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"
)

func TestPipelineBackpressure(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	input := make([]int, 1000)
	for i := range input {
		input[i] = i
	}
	out, err := SquareAll(ctx, input, 2)
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(out)
	if len(out) != 1000 || out[999] != 998001 {
		t.Fatal("lost work")
	}
}
func TestPipelineCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := SquareAll(ctx, make([]int, 1000), 2); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
func TestPipelineRejectsUnboundedWorkers(t *testing.T) {
	if _, err := SquareAll(context.Background(), nil, 100000); err == nil {
		t.Fatal("missing limit")
	}
}
func TestConditionPredicate(t *testing.T) {
	var lock sync.Mutex
	condition := sync.NewCond(&lock)
	ready := false
	done := make(chan struct{})
	go func() {
		lock.Lock()
		for !ready {
			condition.Wait()
		}
		lock.Unlock()
		close(done)
	}()
	lock.Lock()
	ready = true
	condition.Broadcast()
	lock.Unlock()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("predicate notification lost")
	}
}
