package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"newswitch.dev/go-core-lab/internal/runtimeprobe"
	"os"
)

func main() {
	mode := flag.String("mode", "scheduler", "scheduler,gc,view,clone")
	dir := flag.String("dir", "out/runtime", "artifact directory")
	gogc := flag.Int("gogc", 100, "GC percent 10..500")
	total := flag.Int("total-mib", 32, "bounded total allocation 8..128 MiB")
	flag.Parse()
	var output any
	var err error
	switch *mode {
	case "scheduler":
		output, err = runtimeprobe.Scheduler(*dir)
	case "gc":
		output, err = runtimeprobe.GC(*gogc, *total)
	case "view", "clone":
		output, err = runtimeprobe.Retention(*mode, *dir)
	default:
		err = fmt.Errorf("unknown mode")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err = json.NewEncoder(os.Stdout).Encode(output); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
