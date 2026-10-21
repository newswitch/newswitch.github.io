package valueflow

import (
	"encoding/json"
	"io"
	"reflect"
	"strings"
	"testing"
)

func TestDataWithEOFAcrossBufferSizes(t *testing.T) {
	for _, size := range []int{1, 2, 3, 8} {
		r := &dataEOF{}
		p := make([]byte, size)
		var output strings.Builder
		for {
			n, err := r.Read(p)
			output.Write(p[:n])
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatal(err)
			}
		}
		if output.String() != "abc" {
			t.Fatalf("size=%d data=%q", size, output.String())
		}
	}
}

func TestFreshDTOAndOptionalReuse(t *testing.T) {
	type request struct {
		Count Optional[int] `json:"count"`
	}
	var reused request
	if err := json.Unmarshal([]byte(`{"count":7}`), &reused); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{}`), &reused); err != nil {
		t.Fatal(err)
	}
	var fresh request
	if err := json.Unmarshal([]byte(`{}`), &fresh); err != nil {
		t.Fatal(err)
	}
	if !reused.Count.Set || reused.Count.Value != 7 || fresh.Count.Set {
		t.Fatalf("reused=%+v fresh=%+v", reused, fresh)
	}
}

func TestSlices(t *testing.T) {
	r := Slices()
	if !reflect.DeepEqual(r.Shared, []int{1, 8, 3, 9}) || !reflect.DeepEqual(r.Detached, []int{6, 3, 7}) ||
		!r.ClipStillAliases || !r.NestedCloneIsShallow || !r.DeleteClearsTail || r.OldLength != 3 || r.NewLength != 2 ||
		!reflect.DeepEqual(r.OverlappingCopy, []int{1, 1, 2, 3}) {
		t.Fatalf("%+v", r)
	}
}

func TestMaps(t *testing.T) {
	r := Maps()
	if r.NilPresent || !r.ZeroPresent || r.CopiedField != 1 || r.WrittenBackField != 2 ||
		!r.CloneNestedShared || !reflect.DeepEqual(r.SortedKeys, []string{"a", "b"}) {
		t.Fatalf("%+v", r)
	}
}

func TestInterfaces(t *testing.T) {
	r := Interfaces()
	if !r.PointerNil || r.InterfaceNil || !r.AsMatched || !r.AsTargetNil || r.NilReceiverText != "nil receiver" ||
		r.ValueImplements || !r.PointerImplements || r.CapturedValue != 0 || r.CurrentValue != 1 {
		t.Fatalf("%+v", r)
	}
}

func TestIO(t *testing.T) {
	r, err := IO()
	if err != nil || r.DataWithEOF != "abc" || !r.CopyErrorNil || !r.ShortWriteDetected ||
		!r.SourceWriterToFirst || !r.WrappedUsesReaderFrom || r.LimitBody != "abc" || !r.LimitErrorNil ||
		r.MaxBytesBody != "abcd" || !r.MaxBytesDetected {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestJSON(t *testing.T) {
	r, err := JSON()
	if err != nil || r.MissingSet || !r.NullSet || !r.NullFlag || !r.ZeroSet || r.ZeroValue != 0 ||
		!r.SecondRejected || !r.UnknownRejected || r.DuplicateValue != 2 || r.CaseInsensitive != 3 ||
		!r.FloatRounded || r.NumberLiteral != "9007199254740993" || r.NilSlice != "null" || r.EmptySlice != "[]" {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestDecodeOne(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		wantErr    bool
	}{
		{"empty", "", true}, {"valid", `{"count":0}`, false}, {"null", `{"count":null}`, false},
		{"unknown", `{"other":1}`, true}, {"type", `{"count":"bad"}`, true},
		{"tail", `{} {}`, true}, {"whitespace", "{} \n\t", false}, {"invalid-tail", `{} x`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var dst struct {
				Count Optional[int] `json:"count"`
			}
			if err := DecodeOne(strings.NewReader(tc.body), &dst); (err != nil) != tc.wantErr {
				t.Fatalf("%v", err)
			}
		})
	}
}

func TestOptionalCommitsOnlyOnSuccess(t *testing.T) {
	o := Optional[int]{Set: true, Value: 7}
	if err := o.UnmarshalJSON([]byte(`"bad"`)); err == nil || o.Value != 7 || o.Null {
		t.Fatalf("%+v %v", o, err)
	}
	if err := o.UnmarshalJSON([]byte(`null`)); err != nil || !o.Set || !o.Null || o.Value != 0 {
		t.Fatalf("%+v %v", o, err)
	}
}
