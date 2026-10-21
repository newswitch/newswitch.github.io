package foundation

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ResourceReport struct {
	RenamedBody        string   `json:"renamed_body"`
	SameInstant        bool     `json:"same_instant"`
	SameRepresentation bool     `json:"same_representation"`
	ResetHasOldTick    bool     `json:"reset_has_old_tick"`
	Redacted           bool     `json:"redacted"`
	Frames             []string `json:"frames"`
}

type secret string

func (secret) LogValue() slog.Value { return slog.StringValue("[REDACTED]") }

// ReadFrame validates a small length before allocation and consumes exactly one frame.
func ReadFrame(r io.Reader) ([]byte, error) {
	var header [2]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return nil, err
	}
	n := int(binary.BigEndian.Uint16(header[:]))
	if n > 256 {
		return nil, errors.New("frame exceeds 256 bytes")
	}
	body := make([]byte, n)
	_, err := io.ReadFull(r, body)
	return body, err
}

func Resources() (ResourceReport, error) {
	var r ResourceReport
	dir, err := os.MkdirTemp("", "go-foundation-")
	if err != nil {
		return r, err
	}
	// Validate the exact owned directory before scheduling recursive cleanup.
	tempParent, err := filepath.Abs(os.TempDir())
	if err != nil || !filepath.IsAbs(dir) || filepath.Dir(dir) != filepath.Clean(tempParent) || !strings.HasPrefix(filepath.Base(dir), "go-foundation-") {
		return r, errors.New("unexpected temporary directory")
	}
	defer os.RemoveAll(dir)
	// The target does not exist: no claim of portable overwrite or power-loss recovery.
	f, err := os.CreateTemp(dir, ".stage-")
	if err != nil {
		return r, err
	}
	target := filepath.Join(dir, "result.json")
	if _, err = f.WriteString("complete"); err != nil {
		f.Close()
		return r, err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return r, err
	}
	if err = f.Close(); err != nil {
		return r, err
	}
	if err = os.Rename(f.Name(), target); err != nil {
		return r, err
	}
	body, err := os.ReadFile(target)
	if err != nil {
		return r, err
	}
	r.RenamedBody = string(body)
	a := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	b := a.In(time.FixedZone("east", 8*3600))
	r.SameInstant = a.Equal(b)
	r.SameRepresentation = a == b
	timer := time.NewTimer(time.Nanosecond)
	defer timer.Stop()
	<-timer.C // consume first notification before Reset; no sleep-based ordering.
	timer.Reset(time.Hour)
	select {
	case <-timer.C:
		r.ResetHasOldTick = true
	default:
	}
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
		if a.Key == slog.TimeKey {
			return slog.Attr{}
		}
		return a
	}}))
	logger.Info("configured", "credential", secret("example-not-a-real-secret"))
	r.Redacted = strings.Contains(logs.String(), "[REDACTED]") && !strings.Contains(logs.String(), "example-not-a-real-secret")
	data := bytes.NewReader([]byte{0, 3, 'a', 'b', 'c', 0, 2, 'd', 'e'})
	for range 2 {
		frame, err := ReadFrame(data)
		if err != nil {
			return r, err
		}
		r.Frames = append(r.Frames, string(frame))
	}
	return r, nil
}
