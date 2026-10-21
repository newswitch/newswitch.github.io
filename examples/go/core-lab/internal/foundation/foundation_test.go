package foundation

import (
	"bytes"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestLanguage(t *testing.T) {
	r := Language()
	if !reflect.DeepEqual(r.DeclaredLoop, []int{0, 1, 2}) || !reflect.DeepEqual(r.AssignedLoop, []int{2, 2, 2}) || !r.VariadicShared || !r.PointerReassignLocal || !r.JoinedHasBoth || !reflect.DeepEqual(r.DeferOrder, []int{2, 1}) {
		t.Fatalf("%+v", r)
	}
}
func TestTypes(t *testing.T) {
	r, err := Types()
	if err != nil || !reflect.DeepEqual(r.ByteOffsets, []int{0, 3}) || r.InvalidWidth != 1 || r.ReplacementWidth != 3 || r.Prefix != "中A" || !r.NamedSliceKept || r.GenericMethod != 6 || r.CanSetCopy || !r.CanSetPointer || r.PrivateCanSet || !r.TagPresentEmpty || !reflect.DeepEqual(r.SortedIDs, []string{"c", "a", "b"}) {
		t.Fatalf("%+v %v", r, err)
	}
}
func TestResources(t *testing.T) {
	r, err := Resources()
	if err != nil || r.RenamedBody != "complete" || !r.SameInstant || r.SameRepresentation || r.ResetHasOldTick || !r.Redacted || !reflect.DeepEqual(r.Frames, []string{"abc", "de"}) {
		t.Fatalf("%+v %v", r, err)
	}
}
func TestPrefixRunes(t *testing.T) {
	for _, tc := range []struct {
		in   string
		n    int
		want string
		bad  bool
	}{
		{"中AB", 0, "", false}, {"中AB", 1, "中", false}, {"中AB", 5, "中AB", false}, {"e\u0301", 1, "e", false},
		{"\xff", 1, "", true}, {"ok", -1, "", true}, {strings.Repeat("x", 4097), 1, "", true},
	} {
		got, err := PrefixRunes(tc.in, tc.n)
		if got != tc.want || (err != nil) != tc.bad {
			t.Fatalf("%+v got=%q err=%v", tc, got, err)
		}
	}
}
func TestReadFrameBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name    string
		data    []byte
		wantErr error
		bad     bool
	}{
		{"empty", nil, io.EOF, true}, {"partial-header", []byte{0}, io.ErrUnexpectedEOF, true},
		{"partial-body", []byte{0, 3, 'a'}, io.ErrUnexpectedEOF, true}, {"large", []byte{1, 1}, nil, true}, {"zero", []byte{0, 0}, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ReadFrame(bytes.NewReader(tc.data))
			if (err != nil) != tc.bad || tc.wantErr != nil && !errors.Is(err, tc.wantErr) {
				t.Fatal(err)
			}
		})
	}
}
func FuzzPrefixRunes(f *testing.F) {
	f.Add("中AB", uint8(2))
	f.Add("e\u0301", uint8(1))
	f.Fuzz(func(t *testing.T, s string, n uint8) {
		if len(s) > 4096 || !utf8.ValidString(s) {
			return
		}
		got, err := PrefixRunes(s, int(n))
		if err != nil {
			t.Fatal(err)
		}
		want := min(int(n), utf8.RuneCountInString(s))
		if !utf8.ValidString(got) || !strings.HasPrefix(s, got) || utf8.RuneCountInString(got) != want {
			t.Fatalf("prefix invariant n=%d", n)
		}
	})
}
