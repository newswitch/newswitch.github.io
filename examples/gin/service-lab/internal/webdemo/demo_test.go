package webdemo

import (
	"reflect"
	"testing"
)

func TestCases(t *testing.T) {
	cases := map[string][]string{
		"routing": {"status=200", "id=t1"}, "middleware": {"before -> handler -> after"},
		"abort": {"status=401", `{"error":"unauthenticated"}`}, "binding": {"status=400", `{"error":"invalid input"}`},
		"json": {"status=200", `{"count":0,"id":"t1"}`}, "context": {"status=200", "request-cancelled=true"},
		"copy": {"status=200", "copied=alpha"}, "upload": {"status=200", "bytes=3"},
		"sse":    {"status=200", "event:state\ndata:{\"state\":\"NEW\"}"},
		"cookie": {"status=200 httpOnly=true sameSite=2"}, "proxy": {"status=200", "client=192.0.2.10"},
		"recovery": {"status=500", ""},
	}
	for name, want := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := Run(name)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("want %q got %q", want, got)
			}
		})
	}
}
