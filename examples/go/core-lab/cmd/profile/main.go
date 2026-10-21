package main

import (
	"bytes"
	"flag"
	"fmt"
	"newswitch.dev/go-core-lab/internal/demos"
	"os"
	"path/filepath"
	"runtime"
	"runtime/pprof"
	"runtime/trace"
	"sync"
	"time"
)

var retained [][]byte

var encode = demos.EncodeDynamic
var payload = bytes.Repeat([]byte("x"), 4096)

func workload() {
	for range 200 {
		body, _ := encode(payload)
		if len(body) == 0 {
			panic("empty payload")
		}
	}
}
func main() {
	mode := flag.String("mode", "cpu", "cpu, heap, mutex, block, goroutine or trace")
	dir := flag.String("dir", "out", "artifact directory")
	duration := flag.Duration("duration", time.Second, "bounded workload duration")
	encoder := flag.String("encoder", "dynamic", "dynamic or typed; same JSON contract")
	flag.Parse()
	if *encoder == "typed" {
		encode = demos.EncodeTyped
	} else if *encoder != "dynamic" {
		panic("unknown encoder")
	}
	if *duration < 100*time.Millisecond || *duration > 30*time.Second {
		panic("duration must be 100ms..30s")
	}
	if err := os.MkdirAll(*dir, 0700); err != nil {
		panic(err)
	}
	name := *mode + ".pprof"
	if *mode == "trace" {
		name = "runtime.trace"
	}
	file, err := os.Create(filepath.Join(*dir, name))
	if err != nil {
		panic(err)
	}
	defer file.Close()
	switch *mode {
	case "cpu":
		if err = pprof.StartCPUProfile(file); err != nil {
			panic(err)
		}
		until := time.Now().Add(*duration)
		for time.Now().Before(until) {
			workload()
		}
		pprof.StopCPUProfile()
	case "heap":
		for range 8 {
			retained = append(retained, make([]byte, 1<<20))
		}
		runtime.GC()
		err = pprof.WriteHeapProfile(file)
	case "goroutine":
		err = pprof.Lookup("goroutine").WriteTo(file, 0)
	case "trace":
		if err = trace.Start(file); err != nil {
			panic(err)
		}
		workload()
		trace.Stop()
	case "mutex", "block":
		old := runtime.SetMutexProfileFraction(1)
		defer runtime.SetMutexProfileFraction(old)
		runtime.SetBlockProfileRate(1)
		defer runtime.SetBlockProfileRate(0)
		var mu sync.Mutex
		var wg sync.WaitGroup
		for range 4 {
			wg.Go(func() {
				for range 10 {
					mu.Lock()
					time.Sleep(time.Millisecond)
					mu.Unlock()
				}
			})
		}
		wg.Wait()
		err = pprof.Lookup(*mode).WriteTo(file, 0)
	default:
		panic("unknown profile")
	}
	if err != nil {
		panic(err)
	}
	fmt.Println("profile=" + name)
}
