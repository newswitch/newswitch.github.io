package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"newswitch.dev/go-core-lab/internal/foundation"
	"os"
)

func main() {
	mode := flag.String("mode", "language", "language|types|resources")
	flag.Parse()
	var result any
	var err error
	switch *mode {
	case "language":
		result = foundation.Language()
	case "types":
		result, err = foundation.Types()
	case "resources":
		result, err = foundation.Resources()
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
