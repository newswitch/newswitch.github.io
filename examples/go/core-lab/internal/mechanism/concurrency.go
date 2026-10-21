// Package mechanism contains bounded experiments, not production primitives.
package mechanism

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"sync"
	"sync/atomic"
	"time"
)

type ChannelResult struct {
	BufferedValue int  `json:"buffered_value"`
	BufferedOK    bool `json:"buffered_ok"`
	DrainedOK     bool `json:"drained_ok"`
	AliasedValue  int  `json:"aliased_value"`
	ClonedValue   int  `json:"cloned_value"`
	NilDisabled   bool `json:"nil_disabled"`
	SenderJoined  bool `json:"sender_joined"`
	Published     int  `json:"published"`
}

func Channels() (ChannelResult, error) {
	var result ChannelResult
	buffered := make(chan int, 1)
	buffered <- 7
	close(buffered)
	result.BufferedValue, result.BufferedOK = <-buffered
	_, result.DrainedOK = <-buffered
	values := []int{1}
	queue := make(chan []int, 1)
	queue <- values
	values[0] = 2 // Same goroutine: demonstrate aliasing without introducing a race.
	result.AliasedValue = (<-queue)[0]
	queue <- slices.Clone(values)
	values[0] = 3
	result.ClonedValue = (<-queue)[0]
	var disabled <-chan int
	select {
	case <-disabled:
	default:
		result.NilDisabled = true
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	neverReceived := make(chan int)
	done := make(chan bool, 1)
	go func() {
		select {
		case neverReceived <- 1:
			done <- false
		case <-ctx.Done():
			done <- true
		}
	}()
	cancel()
	select {
	case result.SenderJoined = <-done:
	case <-time.After(2 * time.Second):
		return result, fmt.Errorf("sender did not join")
	}
	// A close publishes earlier writes, not all future mutations of this value.
	published := make(chan struct{})
	value := 0
	go func() { value = 42; close(published) }()
	<-published
	result.Published = value
	return result, nil
}

type balances struct {
	mu          sync.Mutex
	left, right int
}

func (b *balances) move(reverse bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if reverse {
		b.right--
		b.left++
	} else {
		b.left--
		b.right++
	}
}
func (b *balances) total() int { b.mu.Lock(); defer b.mu.Unlock(); return b.left + b.right }

type config struct {
	version int
	limits  map[string]int
}
type configStore struct{ current atomic.Pointer[config] }

func (s *configStore) publish(version int, limits map[string]int) {
	// The caller owns limits until this method returns; no concurrent input mutation.
	s.current.Store(&config{version: version, limits: maps.Clone(limits)})
}
func (s *configStore) read() (int, int) {
	c := s.current.Load() // Load once: version and map belong to the same snapshot.
	return c.version, c.limits["requests"]
}

type LockResult struct {
	MixedAtomicTotal   int64 `json:"mixed_atomic_total"`
	FinalAtomicTotal   int64 `json:"final_atomic_total"`
	MutexInvariant     bool  `json:"mutex_invariant"`
	SnapshotConsistent bool  `json:"snapshot_consistent"`
	InputIsolated      bool  `json:"input_isolated"`
}

func Locks() LockResult {
	var result LockResult
	var left, right atomic.Int64
	left.Store(50)
	right.Store(50)
	debited, resume, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		left.Add(-1)
		close(debited)
		<-resume
		right.Add(1)
		close(done)
	}()
	<-debited
	result.MixedAtomicTotal = left.Load() + right.Load()
	close(resume)
	<-done
	result.FinalAtomicTotal = left.Load() + right.Load()
	b := balances{left: 1000, right: 1000}
	var bad atomic.Bool
	var wg sync.WaitGroup
	for worker := range 4 {
		wg.Go(func() {
			for range 1000 {
				b.move(worker%2 == 0)
				if b.total() != 2000 {
					bad.Store(true)
				}
			}
		})
	}
	wg.Wait()
	result.MutexInvariant = !bad.Load() && b.total() == 2000
	var store configStore
	input := map[string]int{"requests": 1}
	store.publish(1, input)
	input["requests"] = 999
	_, original := store.read()
	result.InputIsolated = original == 1
	bad.Store(false)
	wg.Go(func() {
		for version := 2; version <= 1000; version++ {
			store.publish(version, map[string]int{"requests": version})
		}
	})
	for range 3 {
		wg.Go(func() {
			for range 1000 {
				version, limit := store.read()
				if version != limit {
					bad.Store(true)
				}
			}
		})
	}
	wg.Wait()
	result.SnapshotConsistent = !bad.Load()
	return result
}
