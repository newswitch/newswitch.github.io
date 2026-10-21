package demos

import (
	"context"
	"fmt"
	"runtime"
	"runtime/debug"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

func init() {
	register("goroutine", func() ([]string, error) {
		done := make(chan struct{})
		go func() { close(done) }()
		select {
		case <-done:
			return lines("joined=true")
		case <-time.After(time.Second):
			return nil, fmt.Errorf("worker did not exit")
		}
	})
	register("memory", func() ([]string, error) {
		var value int
		done := make(chan struct{})
		go func() { value = 42; close(done) }()
		<-done
		return lines(fmt.Sprintf("published=%d", value))
	})
	register("channel", func() ([]string, error) {
		c := make(chan int, 1)
		c <- 7
		close(c)
		a, first := <-c
		b, second := <-c
		return lines(fmt.Sprintf("first=%d/%t drained=%d/%t", a, first, b, second))
	})
	register("mutex", func() ([]string, error) {
		var mu sync.Mutex
		var wg sync.WaitGroup
		count := 0
		var atomicCount atomic.Int64
		for range 4 {
			wg.Go(func() {
				for range 100 {
					mu.Lock()
					count++
					mu.Unlock()
					atomicCount.Add(1)
				}
			})
		}
		wg.Wait()
		return lines(fmt.Sprintf("mutex=%d atomic=%d", count, atomicCount.Load()))
	})
	register("sync", func() ([]string, error) {
		var once sync.Once
		var wg sync.WaitGroup
		var calls atomic.Int64
		for range 5 {
			wg.Go(func() { once.Do(func() { calls.Add(1) }) })
		}
		wg.Wait()
		return lines(fmt.Sprintf("once=%d", calls.Load()))
	})
	register("context", func() ([]string, error) {
		ctx, cancel := context.WithCancelCause(context.Background())
		done := make(chan struct{})
		go func() { <-ctx.Done(); close(done) }()
		cancel(fmt.Errorf("shutdown"))
		select {
		case <-done:
			return lines(fmt.Sprintf("cancelled=%t cause=%s", ctx.Err() != nil, context.Cause(ctx)))
		case <-time.After(time.Second):
			return nil, fmt.Errorf("cancellation timeout")
		}
	})
	register("worker", func() ([]string, error) {
		jobs := make(chan int, 2)
		results := make(chan int, 3)
		var wg sync.WaitGroup
		for range 2 {
			wg.Go(func() {
				for n := range jobs {
					results <- n * n
				}
			})
		}
		for _, n := range []int{1, 2, 3} {
			jobs <- n
		}
		close(jobs)
		wg.Wait()
		close(results)
		var values []int
		for n := range results {
			values = append(values, n)
		}
		slices.Sort(values)
		return lines(fmt.Sprintf("squares=%v workers=2", values))
	})
	register("leak", func() ([]string, error) {
		release := make(chan struct{})
		started := make(chan struct{})
		done := make(chan struct{})
		go func() { close(started); <-release; close(done) }()
		<-started
		close(release)
		select {
		case <-done:
			return lines("blocked-worker-released=true")
		case <-time.After(time.Second):
			return nil, fmt.Errorf("leak")
		}
	})
	register("scheduler", func() ([]string, error) {
		old := runtime.GOMAXPROCS(2)
		defer runtime.GOMAXPROCS(old)
		return lines(fmt.Sprintf("gomaxprocs=%d goroutines-at-least-one=%t", runtime.GOMAXPROCS(0), runtime.NumGoroutine() > 0))
	})
	register("escape", func() ([]string, error) {
		makeValue := func() *task { return &task{Name: "survives-return"} }
		value := makeValue()
		return lines("value=" + value.Name)
	})
	register("gc", func() ([]string, error) {
		var stats runtime.MemStats
		runtime.ReadMemStats(&stats)
		before := stats.NumGC
		runtime.GC()
		runtime.ReadMemStats(&stats)
		return lines(fmt.Sprintf("gc-advanced=%t", stats.NumGC > before))
	})
	register("memory-limit", func() ([]string, error) {
		old := debug.SetMemoryLimit(128 << 20)
		defer debug.SetMemoryLimit(old)
		previous := debug.SetMemoryLimit(-1)
		return lines(fmt.Sprintf("limit-mib=%d", previous>>20))
	})
	register("compiler", func() ([]string, error) {
		add := func(a, b int) int { return a + b }
		return lines(fmt.Sprintf("sum=%d", add(20, 22)))
	})
	register("goroutine-profile", func() ([]string, error) {
		buffer := make([]byte, 1<<16)
		n := runtime.Stack(buffer, true)
		return lines(fmt.Sprintf("contains-running-stack=%t", strings.Contains(string(buffer[:n]), "goroutine")))
	})
}
