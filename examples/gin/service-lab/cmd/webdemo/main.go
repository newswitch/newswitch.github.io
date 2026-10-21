package main

import (
	"flag"
	"fmt"
	"newswitch.dev/gin-service-lab/internal/webdemo"
	"os"
	"strings"
)

func main() {
	name := flag.String("case", "routing", "routing,middleware,abort,binding,json,context,copy,upload,sse,cookie,proxy,recovery")
	flag.Parse()
	out, err := webdemo.Run(*name)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(strings.Join(out, "\n"))
}
