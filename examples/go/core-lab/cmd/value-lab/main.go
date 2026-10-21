package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"newswitch.dev/go-core-lab/internal/valueflow"
)

func main() {
	mode := flag.String("mode", "slice", "slice|map|interface|io|json")
	flag.Parse()
	var result any
	var err error
	switch *mode {
	case "slice":
		result = valueflow.Slices()
	case "map":
		result = valueflow.Maps()
	case "interface":
		result = valueflow.Interfaces()
	case "io":
		result, err = valueflow.IO()
	case "json":
		result, err = valueflow.JSON()
	default:
		err = fmt.Errorf("unknown mode %q", *mode)
	}
	if err == nil {
		err = json.NewEncoder(os.Stdout).Encode(result)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
