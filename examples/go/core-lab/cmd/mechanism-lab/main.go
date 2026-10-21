package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"newswitch.dev/go-core-lab/internal/mechanism"
)

func main() {
	mode := flag.String("mode", "channel", "channel | locks | http-client | http-server")
	flag.Parse()
	var result any
	var err error
	switch *mode {
	case "channel":
		result, err = mechanism.Channels()
	case "locks":
		result = mechanism.Locks()
	case "http-client":
		result, err = mechanism.HTTPClient()
	case "http-server":
		result, err = mechanism.HTTPServer()
	default:
		err = fmt.Errorf("unknown mode %q", *mode)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err = json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
