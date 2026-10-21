package lifecycle

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"golang.org/x/sync/errgroup"
)

type Stats struct {
	Produced       int64 `json:"produced"`
	Processed      int64 `json:"processed"`
	Consumed       int64 `json:"consumed"`
	PeakActive     int64 `json:"peak_active"`
	ActiveAtReturn int64 `json:"active_at_return"`
	Joined         bool  `json:"joined"`
}

// Run streams generated integers, not an accumulated input or output slice.
// Callbacks must return; Context cannot kill one that ignores cancellation.
// On error it discards pending results, cancels producers and joins all owned tasks.
func Run(ctx context.Context, total, workers, capacity int, process func(context.Context, int) (int, error), consume func(context.Context, int) error) (Stats, error) {
	var stats Stats
	if total < 0 || total > 10000 || workers < 1 || workers > 64 || capacity < 0 || capacity > 64 || process == nil || consume == nil {
		return stats, fmt.Errorf("invalid bounded pipeline configuration")
	}
	runContext, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	group, groupContext := errgroup.WithContext(runContext)
	jobs := make(chan int, capacity)
	results := make(chan int, capacity)
	var produced, processed, active, peak atomic.Int64
	group.Go(func() error {
		defer close(jobs)
		for value := 0; value < total; value++ {
			if err := groupContext.Err(); err != nil {
				return err
			}
			select {
			case jobs <- value:
				produced.Add(1)
			case <-groupContext.Done():
				return groupContext.Err()
			}
		}
		return nil
	})
	var workerGroup sync.WaitGroup
	workerGroup.Add(workers)
	for range workers {
		group.Go(func() error {
			defer workerGroup.Done()
			for {
				select {
				case <-groupContext.Done():
					return groupContext.Err()
				case value, ok := <-jobs:
					if !ok {
						return nil
					}
					if err := groupContext.Err(); err != nil {
						return err
					}
					current := active.Add(1)
					for old := peak.Load(); current > old; old = peak.Load() {
						if peak.CompareAndSwap(old, current) {
							break
						}
					}
					result, err := process(groupContext, value)
					active.Add(-1)
					if err != nil {
						return fmt.Errorf("process %d: %w", value, err)
					}
					processed.Add(1)
					select {
					case results <- result:
					case <-groupContext.Done():
						return groupContext.Err()
					}
				}
			}
		})
	}
	closerDone := make(chan struct{})
	go func() { workerGroup.Wait(); close(results); close(closerDone) }()
	var consumeError error
	for value := range results {
		if consumeError != nil || groupContext.Err() != nil {
			continue
		}
		if consumeError = consume(groupContext, value); consumeError != nil {
			cancel(consumeError)
			continue
		}
		stats.Consumed++
	}
	groupError := group.Wait()
	<-closerDone
	stats.Produced = produced.Load()
	stats.Processed = processed.Load()
	stats.PeakActive = peak.Load()
	stats.ActiveAtReturn = active.Load()
	stats.Joined = true
	if consumeError != nil {
		return stats, consumeError
	}
	if groupError != nil {
		return stats, groupError
	}
	return stats, ctx.Err()
}

type PipelineResult struct {
	Stats
	Sum           int64 `json:"sum"`
	Workers       int   `json:"workers"`
	QueueCapacity int   `json:"queue_capacity"`
}

func Pipeline() (PipelineResult, error) {
	var result PipelineResult
	result.Workers = 2
	result.QueueCapacity = 2
	gate := make(chan struct{})
	var started atomic.Int64
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stats, err := Run(ctx, 1000, 2, 2, func(ctx context.Context, value int) (int, error) {
		if started.Add(1) == 2 {
			close(gate)
		}
		select {
		case <-gate:
		case <-ctx.Done():
			return 0, ctx.Err()
		}
		return value * value, nil
	}, func(_ context.Context, value int) error { result.Sum += int64(value); return nil })
	result.Stats = stats
	return result, err
}
