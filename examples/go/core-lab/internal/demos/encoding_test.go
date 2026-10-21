package demos

import (
	"bytes"
	"testing"
)

func TestEncodingOptimizationPreservesBytes(t *testing.T) {
	for _, n := range []int{0, 1, 4096} {
		payload := bytes.Repeat([]byte("x"), n)
		a, err := EncodeDynamic(payload)
		if err != nil {
			t.Fatal(err)
		}
		b, err := EncodeTyped(payload)
		if err != nil || !bytes.Equal(a, b) {
			t.Fatal(n, err)
		}
	}
}
func BenchmarkEncodeDynamic(b *testing.B) {
	payload := bytes.Repeat([]byte("x"), 4096)
	b.ReportAllocs()
	for b.Loop() {
		data, err := EncodeDynamic(payload)
		if err != nil || len(data) == 0 {
			b.Fatal(err)
		}
	}
}
func BenchmarkEncodeTyped(b *testing.B) {
	payload := bytes.Repeat([]byte("x"), 4096)
	b.ReportAllocs()
	for b.Loop() {
		data, err := EncodeTyped(payload)
		if err != nil || len(data) == 0 {
			b.Fatal(err)
		}
	}
}
