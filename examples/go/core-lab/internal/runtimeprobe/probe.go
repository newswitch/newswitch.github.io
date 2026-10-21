// Package runtimeprobe records bounded runtime experiments, without leaving
// background listeners or intentionally leaking goroutines.
package runtimeprobe

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"runtime/pprof"
	"runtime/trace"
	"sync"
	"sync/atomic"
	"time"
)

var kept []byte
var checksum atomic.Uint64

type GCResult struct {
	GOGC           int    `json:"gogc"`
	AllocatedBytes uint64 `json:"allocated_bytes"`
	Cycles         uint32 `json:"gc_cycles"`
	FinalForcedGC  bool   `json:"includes_final_forced_gc"`
	KeptBytes      int    `json:"kept_bytes"`
}

func GC(gogc, totalMiB int) (GCResult, error) {
	if gogc < 10 || gogc > 500 || totalMiB < 8 || totalMiB > 128 {
		return GCResult{}, fmt.Errorf("gogc=10..500 total-mib=8..128")
	}
	old := debug.SetGCPercent(gogc)
	defer debug.SetGCPercent(old)
	kept = nil
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	for range totalMiB * 2 {
		kept = bytes.Repeat([]byte("x"), 512<<10)
	}
	runtime.GC()
	runtime.ReadMemStats(&after)
	runtime.KeepAlive(kept)
	result := GCResult{gogc, after.TotalAlloc - before.TotalAlloc, after.NumGC - before.NumGC, true, len(kept)}
	kept = nil
	runtime.GC()
	return result, nil
}

type RetentionResult struct {
	Mode             string `json:"mode"`
	VisibleBytes     int    `json:"visible_bytes"`
	HeapAdded        int64  `json:"heap_added_bytes"`
	HeapAfterRelease int64  `json:"heap_delta_after_release"`
	Profile          string `json:"profile"`
}

func retain(copyView bool) {
	large := bytes.Repeat([]byte("z"), 8<<20)
	view := large[:64]
	if copyView {
		view = bytes.Clone(view)
	}
	kept = view
}
func Retention(mode, dir string) (RetentionResult, error) {
	if mode != "view" && mode != "clone" {
		return RetentionResult{}, fmt.Errorf("mode must be view or clone")
	}
	kept = nil
	runtime.GC()
	var before, after, released runtime.MemStats
	runtime.ReadMemStats(&before)
	retain(mode == "clone")
	runtime.GC()
	runtime.ReadMemStats(&after)
	runtime.KeepAlive(kept)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return RetentionResult{}, err
	}
	name := filepath.Join(dir, "retained.pprof")
	file, err := os.Create(name)
	if err != nil {
		return RetentionResult{}, err
	}
	err = pprof.WriteHeapProfile(file)
	closeErr := file.Close()
	if err != nil {
		return RetentionResult{}, err
	}
	if closeErr != nil {
		return RetentionResult{}, closeErr
	}
	visible := len(kept)
	kept = nil
	runtime.GC()
	runtime.ReadMemStats(&released)
	return RetentionResult{mode, visible, int64(after.HeapAlloc) - int64(before.HeapAlloc), int64(released.HeapAlloc) - int64(before.HeapAlloc), name}, nil
}

type SchedulerResult struct {
	P             int    `json:"gomaxprocs"`
	Workers       int    `json:"cpu_workers"`
	TimerObserved bool   `json:"timer_observed"`
	TimerDelayMs  int64  `json:"timer_delay_ms"`
	WaitersJoined bool   `json:"channel_and_network_joined"`
	Trace         string `json:"trace"`
}

func cpuWork() {
	var n uint64
	for i := uint64(0); i < 20000000; i++ {
		n = n*33 + i
	}
	checksum.Add(n)
}
func waitOnChannel(ctx context.Context, release <-chan struct{}) {
	trace.WithRegion(ctx, "channel.wait", func() { <-release })
}
func Scheduler(dir string) (SchedulerResult, error) {
	old := runtime.GOMAXPROCS(1)
	defer runtime.GOMAXPROCS(old)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return SchedulerResult{}, err
	}
	name := filepath.Join(dir, "scheduler.trace")
	file, err := os.Create(name)
	if err != nil {
		return SchedulerResult{}, err
	}
	defer file.Close()
	if err = trace.Start(file); err != nil {
		return SchedulerResult{}, err
	}
	defer trace.Stop()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return SchedulerResult{}, err
	}
	defer listener.Close()
	client, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second)
	if err != nil {
		return SchedulerResult{}, err
	}
	defer client.Close()
	server, err := listener.Accept()
	if err != nil {
		return SchedulerResult{}, err
	}
	defer server.Close()
	server.SetDeadline(time.Now().Add(2 * time.Second))
	client.SetDeadline(time.Now().Add(2 * time.Second))
	ctx, task := trace.NewTask(context.Background(), "scheduler.lab")
	defer task.End()
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	var waiters, cpu sync.WaitGroup
	readResult := make(chan error, 1)
	waiters.Go(func() { waitOnChannel(ctx, release) })
	waiters.Go(func() {
		trace.WithRegion(ctx, "net.read", func() { var b [1]byte; _, e := io.ReadFull(server, b[:]); readResult <- e })
	})
	var timerDelay atomic.Int64
	timerCreated := make(chan struct{})
	waiters.Go(func() {
		start := time.Now()
		timer := time.NewTimer(2 * time.Millisecond)
		defer timer.Stop()
		close(timerCreated)
		<-timer.C
		trace.WithRegion(ctx, "timer.wakeup", func() { timerDelay.Store(time.Since(start).Milliseconds()) })
	})
	<-timerCreated
	for range 2 {
		cpu.Go(func() { trace.WithRegion(ctx, "cpu.work", cpuWork) })
	}
	cpu.Wait()
	unblock()
	_, writeErr := client.Write([]byte{1})
	waiters.Wait()
	readErr := <-readResult
	if writeErr != nil {
		return SchedulerResult{}, writeErr
	}
	if readErr != nil {
		return SchedulerResult{}, readErr
	}
	return SchedulerResult{1, 2, true, timerDelay.Load(), true, name}, nil
}
