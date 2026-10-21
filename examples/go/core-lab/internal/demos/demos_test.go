package demos

import (
	"reflect"
	"testing"
)

func TestExperiments(t *testing.T) {
	expected := map[string][]string{
		"execution": {"package=main", "entry=main.main", "result=42"},
		"types":     {"zero=0 nil=true/true/true", "int8=-128"},
		"control":   {"sum=8 outer=7"}, "functions": {"closure=1,2", "error=true"},
		"pointers": {"a=shared b=copy"}, "methods": {"value=before", "pointer=pointer"},
		"errors": {"is=true as=true code=409"}, "defer": {"last defer -> recovered"},
		"slice":      {"shared=[9 2 3]", "clone=[7 2 3] detached=[8 2 4]"},
		"map":        {"nil-read-present=false zero=0 present=true len=0"},
		"strings":    {"bytes=5 runes=3", "third-rune=中"},
		"interfaces": {"pointer-nil=true interface-nil=false", "nil receiver"},
		"generics":   {"int=6 named=9"}, "reflection": {"value-settable=false tag=id id=new"},
		"comparison": {"key=one sorted=[1 2 3]"}, "io": {"copied=3 body=abc"},
		"files": {"basename=task.json body=one"}, "json": {"missing=true explicit-zero=0 unknown-rejected=true"},
		"time": {"same-instant=true local-hour=8 timer-stopped=true"},
		"logs": {"{\"level\":\"INFO\",\"msg\":\"task completed\",\"task_type\":\"demo\",\"attempt\":1}"},
		"tcp":  {"reply=ABC"}, "http-client": {"status=201 body=created"}, "http-server": {"status=200 id=t1"},
		"goroutine": {"joined=true"}, "memory": {"published=42"}, "channel": {"first=7/true drained=0/false"},
		"mutex": {"mutex=400 atomic=400"}, "sync": {"once=1"}, "context": {"cancelled=true cause=shutdown"},
		"worker": {"squares=[1 4 9] workers=2"}, "leak": {"blocked-worker-released=true"},
		"scheduler": {"gomaxprocs=2 goroutines-at-least-one=true"}, "escape": {"value=survives-return"},
		"gc": {"gc-advanced=true"}, "memory-limit": {"limit-mib=128"}, "compiler": {"sum=42"},
		"goroutine-profile": {"contains-running-stack=true"},
	}
	if len(expected) != len(Names()) {
		t.Fatalf("cases: expected %d, got %d", len(expected), len(Names()))
	}
	for name, want := range expected {
		t.Run(name, func(t *testing.T) {
			got, err := Run(name)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(want, got) {
				t.Fatalf("want %q; got %q", want, got)
			}
		})
	}
}
func TestUnknownCase(t *testing.T) {
	if _, err := Run("missing"); err == nil {
		t.Fatal("expected error")
	}
}
func FuzzSum(f *testing.F) {
	f.Add(int64(3), int64(5))
	f.Fuzz(func(t *testing.T, a, b int64) {
		if sum([]int64{a, b}) != a+b {
			t.Fatal("sum differs")
		}
	})
}
func BenchmarkSum(b *testing.B) {
	values := []int{1, 2, 3, 4}
	b.ReportAllocs()
	for b.Loop() {
		if sum(values) != 10 {
			b.Fatal("wrong result")
		}
	}
}
