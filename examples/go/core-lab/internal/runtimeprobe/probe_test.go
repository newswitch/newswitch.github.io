package runtimeprobe

import (
	"os"
	"testing"
)

func TestGCAndBounds(t *testing.T) {
	r, err := GC(100, 8)
	if err != nil || r.AllocatedBytes < 8<<20 || r.KeptBytes != 512<<10 || r.Cycles < 1 {
		t.Fatal(r, err)
	}
	if _, err = GC(1, 10000); err == nil {
		t.Fatal("unbounded work accepted")
	}
}
func TestRetentionAndRelease(t *testing.T) {
	a, err := Retention("view", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	b, err := Retention("clone", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if a.VisibleBytes != 64 || b.VisibleBytes != 64 || a.HeapAdded-b.HeapAdded < 6<<20 {
		t.Fatal(a, b)
	}
	if a.HeapAfterRelease > a.HeapAdded/2 {
		t.Fatal("large backing array still retained", a)
	}
}
func TestSchedulerJoinsWaiters(t *testing.T) {
	r, err := Scheduler(t.TempDir())
	if err != nil || !r.WaitersJoined || !r.TimerObserved || r.P != 1 {
		t.Fatal(r, err)
	}
	info, err := os.Stat(r.Trace)
	if err != nil || info.Size() == 0 {
		t.Fatal(info, err)
	}
}
