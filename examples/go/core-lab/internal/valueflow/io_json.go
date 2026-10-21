package valueflow

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
)

type readOnly struct{ io.Reader }
type writeOnly struct{ io.Writer }
type dataEOF struct{ offset int }

func (r *dataEOF) Read(p []byte) (int, error) {
	if r.offset == 3 {
		return 0, io.EOF
	}
	n := copy(p, "abc"[r.offset:])
	r.offset += n
	if r.offset == 3 {
		return n, io.EOF
	}
	return n, nil
}

type shortWriter struct{}

func (shortWriter) Write(p []byte) (int, error) { return len(p) - 1, nil }

type fastSource struct {
	*strings.Reader
	used bool
}

func (s *fastSource) WriteTo(w io.Writer) (int64, error) {
	s.used = true
	return s.Reader.WriteTo(w)
}

type fastDestination struct {
	bytes.Buffer
	used bool
}

func (d *fastDestination) ReadFrom(r io.Reader) (int64, error) {
	d.used = true
	return d.Buffer.ReadFrom(r)
}

type IOReport struct {
	DataWithEOF           string `json:"data_with_eof"`
	CopyErrorNil          bool   `json:"copy_error_nil"`
	ShortWriteDetected    bool   `json:"short_write_detected"`
	SourceWriterToFirst   bool   `json:"source_writer_to_first"`
	WrappedUsesReaderFrom bool   `json:"wrapped_uses_reader_from"`
	LimitBody             string `json:"limit_body"`
	LimitErrorNil         bool   `json:"limit_error_nil"`
	MaxBytesBody          string `json:"max_bytes_body"`
	MaxBytesDetected      bool   `json:"max_bytes_detected"`
}

func IO() (IOReport, error) {
	var out bytes.Buffer
	_, err := io.Copy(writeOnly{&out}, &dataEOF{})
	_, shortErr := io.Copy(shortWriter{}, readOnly{strings.NewReader("abc")})
	src := &fastSource{Reader: strings.NewReader("abc")}
	dst := &fastDestination{}
	if _, e := io.Copy(dst, src); e != nil {
		return IOReport{}, e
	}
	first := src.used && !dst.used && dst.String() == "abc"
	wrappedDst := &fastDestination{}
	if _, e := io.Copy(wrappedDst, readOnly{strings.NewReader("abc")}); e != nil {
		return IOReport{}, e
	}
	limited, limitErr := io.ReadAll(io.LimitReader(strings.NewReader("abcdef"), 3))
	body := http.MaxBytesReader(httptest.NewRecorder(), io.NopCloser(strings.NewReader("abcdef")), 4)
	defer body.Close()
	maxBody, maxErr := io.ReadAll(body)
	var tooLarge *http.MaxBytesError
	return IOReport{out.String(), err == nil, errors.Is(shortErr, io.ErrShortWrite),
		first, wrappedDst.used, string(limited), limitErr == nil,
		string(maxBody), errors.As(maxErr, &tooLarge)}, nil
}

// Optional records absence/null/value for a freshly allocated request DTO.
// Reusing a DTO without resetting it would retain Set for an absent field.
type Optional[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (o *Optional[T]) UnmarshalJSON(data []byte) error {
	var next Optional[T]
	next.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		next.Null = true
	} else if err := json.Unmarshal(data, &next.Value); err != nil {
		return err
	}
	*o = next
	return nil
}

func DecodeOne(r io.Reader, dst any) error {
	d := json.NewDecoder(r)
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}

type JSONReport struct {
	MissingSet      bool   `json:"missing_set"`
	NullSet         bool   `json:"null_set"`
	NullFlag        bool   `json:"null_flag"`
	ZeroSet         bool   `json:"zero_set"`
	ZeroValue       int    `json:"zero_value"`
	SecondRejected  bool   `json:"second_rejected"`
	UnknownRejected bool   `json:"unknown_rejected"`
	DuplicateValue  int    `json:"duplicate_value"`
	CaseInsensitive int    `json:"case_insensitive"`
	FloatRounded    bool   `json:"float_rounded"`
	NumberLiteral   string `json:"number_literal"`
	NilSlice        string `json:"nil_slice"`
	EmptySlice      string `json:"empty_slice"`
}

func JSON() (JSONReport, error) {
	type request struct {
		Count Optional[int] `json:"count"`
	}
	var missing, null, zero request
	for _, input := range []struct {
		body string
		dst  *request
	}{
		{`{}`, &missing}, {`{"count":null}`, &null}, {`{"count":0}`, &zero},
	} {
		if err := DecodeOne(strings.NewReader(input.body), input.dst); err != nil {
			return JSONReport{}, err
		}
	}
	var duplicate, folded struct {
		Count int `json:"count"`
	}
	if err := DecodeOne(strings.NewReader(`{"count":1,"count":2}`), &duplicate); err != nil {
		return JSONReport{}, err
	}
	if err := DecodeOne(strings.NewReader(`{"COUNT":3}`), &folded); err != nil {
		return JSONReport{}, err
	}
	var number any
	if err := json.Unmarshal([]byte(`9007199254740993`), &number); err != nil {
		return JSONReport{}, err
	}
	d := json.NewDecoder(strings.NewReader(`9007199254740993`))
	d.UseNumber()
	var exact any
	if err := d.Decode(&exact); err != nil {
		return JSONReport{}, err
	}
	nilJSON, err := json.Marshal([]int(nil))
	if err != nil {
		return JSONReport{}, err
	}
	emptyJSON, err := json.Marshal([]int{})
	if err != nil {
		return JSONReport{}, err
	}
	return JSONReport{missing.Count.Set, null.Count.Set, null.Count.Null,
		zero.Count.Set, zero.Count.Value,
		DecodeOne(strings.NewReader(`{} {}`), &request{}) != nil,
		DecodeOne(strings.NewReader(`{"other":1}`), &request{}) != nil,
		duplicate.Count, folded.Count, fmt.Sprintf("%.0f", number) == "9007199254740992",
		exact.(json.Number).String(), string(nilJSON), string(emptyJSON)}, nil
}
