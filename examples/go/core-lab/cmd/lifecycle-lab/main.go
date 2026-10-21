package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"newswitch.dev/go-core-lab/internal/lifecycle"
)

func main() {
	mode := flag.String("mode", "context", "context | group | pipeline | leak")
	directory := flag.String("dir", "out/lifecycle", "generated profile directory")
	flag.Parse()
	var result any
	var err error
	switch *mode {
	case "context":
		result = lifecycle.Contexts()
	case "group":
		result = lifecycle.Groups()
	case "pipeline":
		result, err = lifecycle.Pipeline()
	case "leak":
		result, err = lifecycle.Leak(*directory)
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
