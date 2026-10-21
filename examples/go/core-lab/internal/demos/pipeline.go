package demos

import (
	"context"
	"fmt"
	"sync"
)

// SquareAll is a bounded, cancellation-aware pipeline. Results may arrive in any order.
// The caller owns the input; it must not mutate it until this function returns.
func SquareAll(ctx context.Context, input []int, workers int) ([]int, error) {
	if workers < 1 || workers > 64 {
		return nil, fmt.Errorf("workers must be 1..64")
	}
	jobs := make(chan int, workers)
	results := make(chan int)
	var group sync.WaitGroup
	group.Go(func() {
		defer close(jobs)
		for _, value := range input {
			select {
			case jobs <- value:
			case <-ctx.Done():
				return
			}
		}
	})
	for range workers {
		group.Go(func() {
			for {
				select {
				case <-ctx.Done():
					return
				case value, ok := <-jobs:
					if !ok {
						return
					}
					select {
					case results <- value * value:
					case <-ctx.Done():
						return
					}
				}
			}
		})
	}
	done := make(chan struct{})
	go func() { group.Wait(); close(results); close(done) }()
	var output []int
	for value := range results {
		output = append(output, value)
	}
	<-done
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return output, nil
}
