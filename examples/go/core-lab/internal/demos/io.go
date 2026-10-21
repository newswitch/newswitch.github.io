package demos

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func init() {
	register("io", func() ([]string, error) {
		var dst bytes.Buffer
		n, err := io.Copy(&dst, io.LimitReader(strings.NewReader("abcdef"), 3))
		if err != nil {
			return nil, err
		}
		return lines(fmt.Sprintf("copied=%d body=%s", n, dst.String()))
	})
	register("files", func() ([]string, error) {
		dir, err := os.MkdirTemp("", "go-files-")
		if err != nil {
			return nil, err
		}
		defer os.RemoveAll(dir)
		file := filepath.Join(dir, "task.json")
		if err = os.WriteFile(file, []byte("one"), 0600); err != nil {
			return nil, err
		}
		body, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		return lines(fmt.Sprintf("basename=%s body=%s", filepath.Base(file), body))
	})
	register("json", func() ([]string, error) {
		type Request struct {
			Count *int `json:"count"`
		}
		var missing, zero Request
		if err := json.Unmarshal([]byte(`{}`), &missing); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(`{"count":0}`), &zero); err != nil {
			return nil, err
		}
		dec := json.NewDecoder(strings.NewReader(`{"unknown":1}`))
		dec.DisallowUnknownFields()
		err := dec.Decode(&Request{})
		return lines(fmt.Sprintf("missing=%t explicit-zero=%d unknown-rejected=%t", missing.Count == nil, *zero.Count, err != nil))
	})
	register("time", func() ([]string, error) {
		t := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		east := t.In(time.FixedZone("UTC+8", 8*3600))
		timer := time.NewTimer(time.Hour)
		stopped := timer.Stop()
		return lines(fmt.Sprintf("same-instant=%t local-hour=%d timer-stopped=%t", t.Equal(east), east.Hour(), stopped))
	})
	register("logs", func() ([]string, error) {
		var out bytes.Buffer
		handler := slog.NewJSONHandler(&out, &slog.HandlerOptions{ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if a.Key == slog.TimeKey {
				return slog.Attr{}
			}
			return a
		}})
		slog.New(handler).Info("task completed", "task_type", "demo", "attempt", 1)
		return lines(strings.TrimSpace(out.String()))
	})
	register("tcp", func() ([]string, error) {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, err
		}
		defer listener.Close()
		done := make(chan error, 1)
		go func() {
			conn, err := listener.Accept()
			if err != nil {
				done <- err
				return
			}
			defer conn.Close()
			conn.SetDeadline(time.Now().Add(time.Second))
			data := make([]byte, 3)
			_, err = io.ReadFull(conn, data)
			if err == nil {
				_, err = conn.Write(bytes.ToUpper(data))
			}
			done <- err
		}()
		conn, err := net.DialTimeout("tcp", listener.Addr().String(), time.Second)
		if err != nil {
			return nil, err
		}
		defer conn.Close()
		conn.SetDeadline(time.Now().Add(time.Second))
		if _, err = conn.Write([]byte("abc")); err != nil {
			return nil, err
		}
		data := make([]byte, 3)
		if _, err = io.ReadFull(conn, data); err != nil {
			return nil, err
		}
		if err = <-done; err != nil {
			return nil, err
		}
		return lines("reply=" + string(data))
	})
	register("http-client", func() ([]string, error) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusCreated)
			io.WriteString(w, "created")
		}))
		defer server.Close()
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		request, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
		response, err := server.Client().Do(request)
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, 1024))
		if err != nil {
			return nil, err
		}
		return lines(fmt.Sprintf("status=%d body=%s", response.StatusCode, body))
	})
	register("http-server", func() ([]string, error) {
		mux := http.NewServeMux()
		mux.HandleFunc("GET /tasks/{id}", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, r.PathValue("id")) })
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/tasks/t1", nil))
		return lines(fmt.Sprintf("status=%d id=%s", recorder.Code, recorder.Body.String()))
	})
}
