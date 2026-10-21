package demos

import (
	"errors"
	"fmt"
	"reflect"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"
)

type experiment func() ([]string, error)

var cases = map[string]experiment{}

func register(name string, run experiment) {
	if _, exists := cases[name]; exists {
		panic("duplicate experiment")
	}
	cases[name] = run
}
func Names() []string {
	result := make([]string, 0, len(cases))
	for name := range cases {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}
func Run(name string) ([]string, error) {
	run, ok := cases[name]
	if !ok {
		return nil, fmt.Errorf("unknown case %q", name)
	}
	return run()
}
func lines(values ...string) ([]string, error) { return values, nil }

type task struct {
	Name     string
	Attempts int
}

func (t task) valueRename() { t.Name = "copy" }
func (t *task) rename()     { t.Name = "pointer" }

type named interface{ Label() string }
type label struct{ Text string }

func (l *label) Label() string {
	if l == nil {
		return "nil receiver"
	}
	return l.Text
}

type classifiedError struct{ Code int }

func (e *classifiedError) Error() string { return "classified failure" }

type integer interface{ ~int | ~int64 }

func sum[T integer](values []T) T {
	var total T
	for _, v := range values {
		total += v
	}
	return total
}

func init() {
	register("execution", func() ([]string, error) { return lines("package=main", "entry=main.main", "result=42") })
	register("types", func() ([]string, error) {
		var number int
		var pointer *int
		var values []int
		var table map[string]int
		x := int8(127)
		x++
		return lines(fmt.Sprintf("zero=%d nil=%t/%t/%t", number, pointer == nil, values == nil, table == nil), fmt.Sprintf("int8=%d", x))
	})
	register("control", func() ([]string, error) {
		total := 0
		for i := range 5 {
			if i%2 == 0 {
				total += i
			}
		}
		n := 7
		if n := 2; n > 0 {
			total += n
		}
		return lines(fmt.Sprintf("sum=%d outer=%d", total, n))
	})
	register("functions", func() ([]string, error) {
		counter := func() func() int { n := 0; return func() int { n++; return n } }
		next := counter()
		a, b := next(), next()
		divide := func(a, b int) (int, error) {
			if b == 0 {
				return 0, errors.New("zero divisor")
			}
			return a / b, nil
		}
		_, err := divide(4, 0)
		return lines(fmt.Sprintf("closure=%d,%d", a, b), fmt.Sprintf("error=%t", err != nil))
	})
	register("pointers", func() ([]string, error) {
		a := task{Name: "original"}
		b := a
		b.Name = "copy"
		p := &a
		p.Name = "shared"
		return lines(fmt.Sprintf("a=%s b=%s", a.Name, b.Name))
	})
	register("methods", func() ([]string, error) {
		a := task{Name: "before"}
		a.valueRename()
		first := a.Name
		a.rename()
		return lines("value="+first, "pointer="+a.Name)
	})
	register("errors", func() ([]string, error) {
		sentinel := errors.New("missing")
		wrapped := fmt.Errorf("load task: %w", sentinel)
		var typed *classifiedError
		other := fmt.Errorf("request: %w", &classifiedError{Code: 409})
		matched := errors.As(other, &typed)
		return lines(fmt.Sprintf("is=%t as=%t code=%d", errors.Is(wrapped, sentinel), matched, typed.Code))
	})
	register("defer", func() ([]string, error) {
		var out []string
		func() {
			defer func() {
				if recover() != nil {
					out = append(out, "recovered")
				}
			}()
			defer func() { out = append(out, "last defer") }()
			panic("isolated demo")
		}()
		return lines(strings.Join(out, " -> "))
	})
	register("slice", func() ([]string, error) {
		a := []int{1, 2, 3}
		b := a[:2]
		b[0] = 9
		c := slices.Clone(a)
		c[0] = 7
		limited := a[:2:2]
		extended := append(limited, 4)
		extended[0] = 8
		return lines(fmt.Sprintf("shared=%v", a), fmt.Sprintf("clone=%v detached=%v", c, extended))
	})
	register("map", func() ([]string, error) {
		var m map[string]int
		_, ok := m["absent"]
		m = make(map[string]int)
		m["a"] = 0
		v, present := m["a"]
		delete(m, "a")
		return lines(fmt.Sprintf("nil-read-present=%t zero=%d present=%t len=%d", ok, v, present, len(m)))
	})
	register("strings", func() ([]string, error) {
		s := "Go中"
		return lines(fmt.Sprintf("bytes=%d runes=%d", len(s), utf8.RuneCountInString(s)), fmt.Sprintf("third-rune=%c", []rune(s)[2]))
	})
	register("interfaces", func() ([]string, error) {
		var p *label
		var value named = p
		return lines(fmt.Sprintf("pointer-nil=%t interface-nil=%t", p == nil, value == nil), value.Label())
	})
	register("generics", func() ([]string, error) {
		type Count int64
		return lines(fmt.Sprintf("int=%d named=%d", sum([]int{1, 2, 3}), sum([]Count{4, 5})))
	})
	register("reflection", func() ([]string, error) {
		type View struct {
			ID string `json:"id"`
		}
		v := View{ID: "old"}
		read := reflect.ValueOf(v).Field(0).CanSet()
		reflect.ValueOf(&v).Elem().Field(0).SetString("new")
		tag := reflect.TypeOf(v).Field(0).Tag.Get("json")
		return lines(fmt.Sprintf("value-settable=%t tag=%s id=%s", read, tag, v.ID))
	})
	register("comparison", func() ([]string, error) {
		type Key struct {
			Tenant string
			ID     int
		}
		m := map[Key]string{{"alpha", 1}: "one"}
		values := []int{3, 1, 2}
		slices.Sort(values)
		return lines(fmt.Sprintf("key=%s sorted=%v", m[Key{"alpha", 1}], values))
	})
}
