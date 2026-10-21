package mechanism

type Record struct {
	Value   int64
	Padding [56]byte
}

func InlineRecord(v int64) *Record { return &Record{Value: v} }

//go:noinline
func OpaqueRecord(v int64) *Record { return &Record{Value: v} }

//go:noinline
func ReadRecord(record *Record) int64 { return record.Value }

//go:noinline
func PrefixUnchecked(values []int, n int) int {
	sum := 0
	for i := 0; i < n; i++ {
		sum += values[i]
	}
	return sum
}

//go:noinline
func PrefixBounded(values []int, n int) int {
	if n < 0 || n > len(values) {
		panic("invalid prefix length")
	}
	values = values[:n] // Validate once before the loop, not once per iteration.
	sum := 0
	for _, value := range values {
		sum += value
	}
	return sum
}
