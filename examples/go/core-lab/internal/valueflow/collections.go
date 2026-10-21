package valueflow

import (
	"errors"
	"maps"
	"slices"
)

type SliceReport struct {
	Shared               []int `json:"shared"`
	Detached             []int `json:"detached"`
	ClipStillAliases     bool  `json:"clip_still_aliases"`
	NestedCloneIsShallow bool  `json:"nested_clone_is_shallow"`
	DeleteClearsTail     bool  `json:"delete_clears_tail"`
	OldLength            int   `json:"old_length"`
	NewLength            int   `json:"new_length"`
	OverlappingCopy      []int `json:"overlapping_copy"`
}

func Slices() SliceReport {
	base := []int{1, 2, 3, 4}
	view := base[1:3]
	view = append(view, 9) // capacity permits reuse; replaces base[3].
	clipped := slices.Clip(view[:2])
	clipped[0] = 8 // Clip changes capacity, not ownership.
	aliases := base[1] == 8
	detached := append(clipped, 7)
	detached[0] = 6
	nested := [][]int{{1}}
	clone := slices.Clone(nested)
	clone[0][0] = 9
	a, b, c := 1, 2, 3
	items := []*int{&a, &b, &c}
	old := items
	items = slices.Delete(items, 1, 2)
	overlap := []int{1, 2, 3, 4}
	copy(overlap[1:], overlap[:3])
	return SliceReport{base, detached, aliases, nested[0][0] == 9,
		old[1] == &c && old[2] == nil, len(old), len(items), overlap}
}

type MapReport struct {
	NilPresent        bool     `json:"nil_present"`
	ZeroPresent       bool     `json:"zero_present"`
	CopiedField       int      `json:"copied_field"`
	WrittenBackField  int      `json:"written_back_field"`
	CloneNestedShared bool     `json:"clone_nested_shared"`
	SortedKeys        []string `json:"sorted_keys"`
}

func Maps() MapReport {
	var empty map[string]int
	_, nilPresent := empty["missing"]
	counts := map[string]int{"zero": 0}
	_, zeroPresent := counts["zero"]
	type entry struct{ Count int }
	m := map[string]entry{"one": {1}}
	v := m["one"]
	v.Count = 2
	copied := m["one"].Count
	m["one"] = v
	nested := map[string][]int{"b": {1}, "a": {2}}
	cloned := maps.Clone(nested)
	cloned["b"][0] = 9
	return MapReport{nilPresent, zeroPresent, copied, m["one"].Count,
		nested["b"][0] == 9, slices.Sorted(maps.Keys(nested))}
}

type counter struct{ n int }

func (c counter) Snapshot() int { return c.n }
func (c *counter) Inc()         { c.n++ }

type incrementer interface{ Inc() }
type snapshotter interface{ Snapshot() int }

var _ incrementer = (*counter)(nil)
var _ snapshotter = counter{}

type lookupError struct{}

func (e *lookupError) Error() string {
	if e == nil {
		return "nil receiver"
	}
	return "lookup failed"
}

type InterfaceReport struct {
	PointerNil        bool   `json:"pointer_nil"`
	InterfaceNil      bool   `json:"interface_nil"`
	AsMatched         bool   `json:"as_matched"`
	AsTargetNil       bool   `json:"as_target_nil"`
	NilReceiverText   string `json:"nil_receiver_text"`
	ValueImplements   bool   `json:"value_implements"`
	PointerImplements bool   `json:"pointer_implements"`
	CapturedValue     int    `json:"captured_value"`
	CurrentValue      int    `json:"current_value"`
}

func Interfaces() InterfaceReport {
	var p *lookupError
	var err error = p
	var target *lookupError
	matched := errors.As(err, &target)
	c := counter{}
	saved := c.Snapshot // value receiver captured now.
	_, valueOK := any(c).(incrementer)
	_, pointerOK := any(&c).(incrementer)
	inc := c.Inc // pointer receiver captured now.
	inc()
	return InterfaceReport{p == nil, err == nil, matched, target == nil,
		err.Error(), valueOK, pointerOK, saved(), c.Snapshot()}
}
