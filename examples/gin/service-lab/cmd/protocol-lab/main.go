package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/gin-gonic/gin"
	"newswitch.dev/gin-service-lab/internal/protocol"
)

func main() {
	mode := flag.String("mode", "binding", "binding|response")
	flag.Parse()
	gin.SetMode(gin.TestMode)
	var result any
	var err error
	switch *mode {
	case "binding":
		result = protocol.Bindings()
	case "response":
		result, err = protocol.Responses()
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
