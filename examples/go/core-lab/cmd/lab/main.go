package main

import (
	"flag"
	"fmt"
	"newswitch.dev/go-core-lab/internal/demos"
	"os"
	"strings"
)

func main() {
	name := flag.String("case", "", "one bounded experiment; empty lists available cases")
	flag.Parse()
	if *name == "" {
		fmt.Println(strings.Join(demos.Names(), "\n"))
		return
	}
	lines, err := demos.Run(*name)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(strings.Join(lines, "\n"))
}
