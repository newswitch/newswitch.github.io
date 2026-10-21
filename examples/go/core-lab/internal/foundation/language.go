package foundation

import (
	"errors"
	"fmt"
	"reflect"
	"slices"
	"unicode/utf8"
)

type LanguageReport struct {
	DeclaredLoop         []int `json:"declared_loop"`
	AssignedLoop         []int `json:"assigned_loop"`
	VariadicShared       bool  `json:"variadic_shared"`
	PointerReassignLocal bool  `json:"pointer_reassign_local"`
	JoinedHasBoth        bool  `json:"joined_has_both"`
	DeferOrder           []int `json:"defer_order"`
}

func Language() LanguageReport {
	var declared, assigned []func() int
	for i := range 3 {
		declared = append(declared, func() int { return i })
	}
	var j int
	for j = range 3 {
		assigned = append(assigned, func() int { return j })
	}
	var report LanguageReport
	for _, f := range declared {
		report.DeclaredLoop = append(report.DeclaredLoop, f())
	}
	for _, f := range assigned {
		report.AssignedLoop = append(report.AssignedLoop, f())
	}
	values := []int{1, 2}
	func(v ...int) { v[0] = 9 }(values...)
	report.VariadicShared = values[0] == 9
	n := 1
	p := &n
	func(local *int) { v := 2; local = &v; _ = local }(p)
	report.PointerReassignLocal = *p == 1
	a, b := errors.New("operation"), errors.New("cleanup")
	joined := errors.Join(fmt.Errorf("load: %w", a), b)
	report.JoinedHasBoth = errors.Is(joined, a) && errors.Is(joined, b)
	func() {
		n := 1
		defer func(v int) { report.DeferOrder = append(report.DeferOrder, v) }(n)
		defer func() { report.DeferOrder = append(report.DeferOrder, n) }()
		n = 2
	}()
	return report
}

// PrefixRunes counts code points, not graphemes or terminal columns.
func PrefixRunes(s string, n int) (string, error) {
	if len(s) > 4096 || n < 0 || n > 4096 || !utf8.ValidString(s) {
		return "", errors.New("invalid text or limit")
	}
	count := 0
	for offset := range s {
		if count == n {
			return s[:offset], nil
		}
		count++
	}
	return s, nil
}

type Doubler struct{}

// Method-owned type parameters require the module's Go 1.27 language version.
func (Doubler) Twice[T ~int | ~int64](v T) T { return v + v }

func SameTypeMap[S ~[]E, E any](in S, f func(E) E) S {
	if in == nil {
		return nil
	}
	out := make(S, len(in))
	for i, v := range in {
		out[i] = f(v)
	}
	return out
}

type TypesReport struct {
	ByteOffsets      []int    `json:"byte_offsets"`
	InvalidWidth     int      `json:"invalid_width"`
	ReplacementWidth int      `json:"replacement_width"`
	Prefix           string   `json:"prefix"`
	NamedSliceKept   bool     `json:"named_slice_kept"`
	GenericMethod    int64    `json:"generic_method"`
	CanSetCopy       bool     `json:"can_set_copy"`
	CanSetPointer    bool     `json:"can_set_pointer"`
	PrivateCanSet    bool     `json:"private_can_set"`
	TagPresentEmpty  bool     `json:"tag_present_empty"`
	SortedIDs        []string `json:"sorted_ids"`
}

func Types() (TypesReport, error) {
	var r TypesReport
	for offset := range "中A" {
		r.ByteOffsets = append(r.ByteOffsets, offset)
	}
	_, r.InvalidWidth = utf8.DecodeRuneInString("\xff")
	_, r.ReplacementWidth = utf8.DecodeRuneInString("\ufffd")
	var err error
	if r.Prefix, err = PrefixRunes("中AB", 2); err != nil {
		return r, err
	}
	type counts []int64
	out := SameTypeMap(counts{1, 2}, func(v int64) int64 { return v * 2 })
	r.NamedSliceKept = reflect.TypeOf(out) == reflect.TypeFor[counts]() && out[1] == 4
	r.GenericMethod = Doubler{}.Twice(int64(3))
	type record struct {
		Name    string `json:""`
		private int
	}
	v := record{Name: "old"}
	r.CanSetCopy = reflect.ValueOf(v).Field(0).CanSet()
	p := reflect.ValueOf(&v).Elem()
	r.CanSetPointer = p.Field(0).CanSet()
	r.PrivateCanSet = p.Field(1).CanSet()
	tag, ok := p.Type().Field(0).Tag.Lookup("json")
	r.TagPresentEmpty = ok && tag == ""
	type item struct {
		Score int
		ID    string
	}
	items := []item{{1, "b"}, {1, "a"}, {0, "c"}}
	slices.SortFunc(items, func(a, b item) int {
		if a.Score < b.Score {
			return -1
		}
		if a.Score > b.Score {
			return 1
		}
		if a.ID < b.ID {
			return -1
		}
		if a.ID > b.ID {
			return 1
		}
		return 0
	})
	for _, v := range items {
		r.SortedIDs = append(r.SortedIDs, v.ID)
	}
	return r, nil
}
