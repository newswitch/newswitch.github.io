package mechanism

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
)

func TestChannels(t *testing.T) {
	got, err := Channels()
	if err != nil {
		t.Fatal(err)
	}
	if got.BufferedValue != 7 || !got.BufferedOK || got.DrainedOK || got.AliasedValue != 2 || got.ClonedValue != 2 || !got.NilDisabled || !got.SenderJoined || got.Published != 42 {
		t.Fatalf("%+v", got)
	}
	t.Logf("%+v", got)
}
func TestLockInvariants(t *testing.T) {
	got := Locks()
	if got.MixedAtomicTotal != 99 || got.FinalAtomicTotal != 100 || !got.MutexInvariant || !got.SnapshotConsistent || !got.InputIsolated {
		t.Fatalf("%+v", got)
	}
	t.Logf("%+v", got)
}
func TestCoordination(t *testing.T) {
	t.Run("join-distinct-elements", func(t *testing.T) {
		values := make([]int, 8)
		var wg sync.WaitGroup
		for i := range values {
			wg.Go(func() { values[i] = i + 1 })
		}
		wg.Wait()
		for i, value := range values {
			if value != i+1 {
				t.Fatal(values)
			}
		}
	})
	t.Run("once-publishes-completed-value", func(t *testing.T) {
		var once sync.Once
		var calls atomic.Int64
		var bad atomic.Bool
		value := 0
		var wg sync.WaitGroup
		for range 8 {
			wg.Go(func() {
				once.Do(func() { calls.Add(1); value = 42 })
				if value != 42 {
					bad.Store(true)
				}
			})
		}
		wg.Wait()
		if calls.Load() != 1 || bad.Load() {
			t.Fatal("initialization not published")
		}
	})
	t.Run("predicate-before-wait", func(t *testing.T) {
		var mu sync.Mutex
		condition := sync.NewCond(&mu)
		mu.Lock()
		ready := true
		condition.Broadcast()
		mu.Unlock()
		var wg sync.WaitGroup
		wg.Go(func() {
			mu.Lock()
			defer mu.Unlock()
			for !ready {
				condition.Wait()
			}
		})
		wg.Wait() // No saved notification: the persistent predicate prevents waiting.
	})
	t.Run("once-values-caches-error", func(t *testing.T) {
		calls := 0
		load := sync.OnceValues(func() (int, error) { calls++; return 0, fmt.Errorf("offline") })
		_, first := load()
		_, second := load()
		if first == nil || first != second || calls != 1 {
			t.Fatal("error was not cached")
		}
	})
}

var recordSink *Record
var numberSink int64

func TestAllocationEvidence(t *testing.T) {
	cases := []struct {
		name string
		run  func()
		want float64
	}{
		{"inline-local", func() { numberSink = InlineRecord(42).Value }, 0},
		{"opaque-return", func() { numberSink = OpaqueRecord(42).Value }, 1},
		{"published-pointer", func() { recordSink = InlineRecord(42) }, 1},
		{"borrowed-pointer", func() { record := Record{Value: 42}; numberSink = ReadRecord(&record) }, 0},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got := testing.AllocsPerRun(1000, test.run)
			t.Logf("allocs/op=%.0f", got)
			if got != test.want {
				t.Fatalf("Go 1.27.3 baseline changed: got %v want %v", got, test.want)
			}
		})
	}
	recordSink = nil
}
func TestPrefixEquivalent(t *testing.T) {
	values := []int{1, 2, 3, 4}
	for n := 0; n <= len(values); n++ {
		if PrefixUnchecked(values, n) != PrefixBounded(values, n) {
			t.Fatal(n)
		}
	}
}
func BenchmarkInlineLocal(b *testing.B) {
	var total int64
	for i := 0; i < b.N; i++ {
		total += InlineRecord(int64(i)).Value
	}
	numberSink = total
}
func BenchmarkOpaqueReturn(b *testing.B) {
	var total int64
	for i := 0; i < b.N; i++ {
		total += OpaqueRecord(int64(i)).Value
	}
	numberSink = total
}
func BenchmarkPublishedPointer(b *testing.B) {
	for i := 0; i < b.N; i++ {
		recordSink = InlineRecord(int64(i))
	}
}
func BenchmarkBorrowedPointer(b *testing.B) {
	var total int64
	for i := 0; i < b.N; i++ {
		record := Record{Value: int64(i)}
		total += ReadRecord(&record)
	}
	numberSink = total
}
