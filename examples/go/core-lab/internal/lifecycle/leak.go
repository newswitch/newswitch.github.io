package lifecycle

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime/pprof"
	"strings"
	"sync"
	"time"
)

// abandonedSender deliberately has a missing cancellation branch, but its owner
// always drains result and joins it before the experiment returns.
func abandonedSender(ctx context.Context, result chan<- int, value int, ready, done *sync.WaitGroup) {
	defer done.Done()
	_ = ctx
	ready.Done()
	result <- value
}

func stackSnapshot() string {
	var buffer bytes.Buffer
	pprof.Lookup("goroutine").WriteTo(&buffer, 2)
	return buffer.String()
}
func countAbandoned(stacks string) int {
	count := 0
	for _, stack := range strings.Split(stacks, "\n\n") {
		if strings.Contains(stack, "[chan send]") && strings.Contains(stack, "lifecycle.abandonedSender(") {
			count++
		}
	}
	return count
}

type LeakResult struct {
	BlockedAfterCancel      int    `json:"blocked_after_cancel"`
	BlockedAfterDrain       int    `json:"blocked_after_drain"`
	CancellationAwareJoined int    `json:"cancellation_aware_joined"`
	Profile                 string `json:"profile"`
}

func Leak(directory string) (LeakResult, error) {
	var result LeakResult
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	const count = 8
	queue := make(chan int)
	var ready, done sync.WaitGroup
	ready.Add(count)
	done.Add(count)
	for value := range count {
		go abandonedSender(ctx, queue, value, &ready, &done)
	}
	// Runs even if profile writing fails; no permanent blocked senders are left behind.
	var drainOnce sync.Once
	drain := func() {
		drainOnce.Do(func() {
			for range count {
				<-queue
			}
			done.Wait()
		})
	}
	defer drain()
	ready.Wait()
	cancel()
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	var snapshot string
	for {
		snapshot = stackSnapshot()
		result.BlockedAfterCancel = countAbandoned(snapshot)
		if result.BlockedAfterCancel == count {
			break
		}
		select {
		case <-deadline.C:
			return result, fmt.Errorf("senders did not enter expected bounded wait")
		case <-ticker.C:
		}
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return result, err
	}
	result.Profile = filepath.Join(directory, "abandoned-send.txt")
	if err := os.WriteFile(result.Profile, []byte(snapshot), 0600); err != nil {
		return result, err
	}
	drain()
	result.BlockedAfterDrain = countAbandoned(stackSnapshot())
	cancelQueue := make(chan int)
	for range count {
		stopped := make(chan struct{})
		go func() {
			defer close(stopped)
			select {
			case cancelQueue <- 1:
			case <-ctx.Done():
			}
		}()
		<-stopped
		result.CancellationAwareJoined++
	}
	return result, nil
}
