package app

import (
	"context"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"io"
	"net/http"
	"net/http/httptest"
	"newswitch.dev/gin-service-lab/internal/observe"
	"newswitch.dev/gin-service-lab/internal/store"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var testKey = []byte("isolated-lab-signing-key-at-least-thirty-two-bytes")

func setup(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	s, err := store.Open(context.Background(), "sqlite", filepath.ToSlash(filepath.Join(t.TempDir(), "api.db")))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	telemetry, err := observe.New(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { telemetry.Close(context.Background()) })
	server, handler, err := New(s, telemetry, testKey, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	return server, handler
}
func call(t *testing.T, handler http.Handler, method, path, body, tenant, scope, key string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if tenant != "" {
		token, err := Token(testKey, tenant, scope, time.Now().Add(time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if key != "" {
		request.Header.Set("Idempotency-Key", key)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}
func taskFrom(t *testing.T, response *httptest.ResponseRecorder) store.Task {
	t.Helper()
	var task store.Task
	if err := json.Unmarshal(response.Body.Bytes(), &task); err != nil {
		t.Fatal(response.Body.String(), err)
	}
	return task
}
func TestHealth(t *testing.T) {
	_, h := setup(t)
	for _, path := range []string{"/health/live", "/health/ready"} {
		if response := call(t, h, "GET", path, "", "", "", ""); response.Code != 200 {
			t.Fatal(response.Code)
		}
	}
}
func TestMissingBearer(t *testing.T) {
	_, h := setup(t)
	if r := call(t, h, "GET", "/api/me", "", "", "", ""); r.Code != 401 {
		t.Fatal(r.Code)
	}
}
func TestScopeDenied(t *testing.T) {
	_, h := setup(t)
	if r := call(t, h, "POST", "/api/tasks", `{"name":"one"}`, "alpha", "task:read", "key"); r.Code != 403 {
		t.Fatal(r.Code)
	}
}
func TestCreateReadDuplicateConflict(t *testing.T) {
	_, h := setup(t)
	a := call(t, h, "POST", "/api/tasks", `{"name":"one"}`, "alpha", "task:write", "key")
	if a.Code != 201 {
		t.Fatal(a.Code, a.Body.String())
	}
	b := call(t, h, "POST", "/api/tasks", `{"name":"one"}`, "alpha", "task:write", "key")
	if taskFrom(t, a).ID != taskFrom(t, b).ID {
		t.Fatal("duplicate task")
	}
	conflict := call(t, h, "POST", "/api/tasks", `{"name":"two"}`, "alpha", "task:write", "key")
	if conflict.Code != 409 {
		t.Fatal(conflict.Code)
	}
	read := call(t, h, "GET", "/api/tasks/"+taskFrom(t, a).ID, "", "alpha", "task:read", "")
	if read.Code != 200 {
		t.Fatal(read.Code)
	}
}
func TestCrossTenantIs404(t *testing.T) {
	_, h := setup(t)
	a := call(t, h, "POST", "/api/tasks", `{"name":"one"}`, "alpha", "task:write", "key")
	r := call(t, h, "GET", "/api/tasks/"+taskFrom(t, a).ID, "", "beta", "task:read", "")
	if r.Code != 404 {
		t.Fatal(r.Code)
	}
}
func TestInvalidBodies(t *testing.T) {
	_, h := setup(t)
	for _, body := range []string{`{}`, `{"name":""}`, `{"name":"one","tenant":"beta"}`, `{"name":"one"}{"name":"two"}`, `not json`} {
		t.Run(body, func(t *testing.T) {
			if r := call(t, h, "POST", "/api/tasks", body, "alpha", "task:write", "key"); r.Code != 400 {
				t.Fatal(r.Code, r.Body.String())
			}
		})
	}
}
func TestListBound(t *testing.T) {
	_, h := setup(t)
	if r := call(t, h, "GET", "/api/tasks?limit=101", "", "alpha", "task:read", ""); r.Code != 400 {
		t.Fatal(r.Code)
	}
}
func TestOptimisticCancel(t *testing.T) {
	_, h := setup(t)
	a := call(t, h, "POST", "/api/tasks", `{"name":"one"}`, "alpha", "task:write", "key")
	path := "/api/tasks/" + taskFrom(t, a).ID + "/cancel"
	if r := call(t, h, "POST", path, `{"version":0}`, "alpha", "task:write", ""); r.Code != 200 {
		t.Fatal(r.Code)
	}
	if r := call(t, h, "POST", path, `{"version":0}`, "alpha", "task:write", ""); r.Code != 409 {
		t.Fatal(r.Code)
	}
}
func TestWorkerCommitsResult(t *testing.T) {
	s, _ := setup(t)
	task, _ := s.Store.Create(context.Background(), "alpha", "key", "one")
	if err := RunOne(context.Background(), s.Store); err != nil {
		t.Fatal(err)
	}
	loaded, _ := s.Store.Get(context.Background(), "alpha", task.ID)
	if loaded.State != "SUCCEEDED" || loaded.Result != "completed:one" {
		t.Fatal(loaded)
	}
}
func TestWrongSignatureAndAlgorithm(t *testing.T) {
	_, h := setup(t)
	for _, method := range []*jwt.SigningMethodHMAC{jwt.SigningMethodHS256, jwt.SigningMethodHS512} {
		claims := Claims{Tenant: "alpha", Scope: "task:read", RegisteredClaims: jwt.RegisteredClaims{Issuer: "gin-lab", Subject: "user", Audience: jwt.ClaimStrings{"task-api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))}}
		key := testKey
		if method == jwt.SigningMethodHS256 {
			key = []byte("different-signing-key-of-adequate-length")
		}
		token, _ := jwt.NewWithClaims(method, claims).SignedString(key)
		request := httptest.NewRequest("GET", "/api/me", nil)
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		h.ServeHTTP(response, request)
		if response.Code != 401 {
			t.Fatal(method.Alg(), response.Code)
		}
	}
}
func TestExpiredBearer(t *testing.T) {
	_, h := setup(t)
	token, _ := Token(testKey, "alpha", "task:read", time.Now().Add(-time.Minute))
	request := httptest.NewRequest("GET", "/api/me", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != 401 {
		t.Fatal(response.Code)
	}
}
func TestAdmissionRejectsBeforeDatabase(t *testing.T) {
	s, h := setup(t)
	s.permits <- struct{}{}
	s.permits <- struct{}{}
	defer func() { <-s.permits; <-s.permits }()
	if r := call(t, h, "GET", "/api/me", "", "alpha", "task:read", ""); r.Code != 503 {
		t.Fatal(r.Code)
	}
}
func TestMetricsAreNotPublic(t *testing.T) {
	_, h := setup(t)
	if r := call(t, h, "GET", "/metrics", "", "", "", ""); r.Code != 404 {
		t.Fatal(r.Code)
	}
}
func TestActualHTTPAndSSEDisconnect(t *testing.T) {
	s, h := setup(t)
	task, _ := s.Store.Create(context.Background(), "alpha", "key", "one")
	server := httptest.NewServer(h)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/api/tasks/"+task.ID+"/events", nil)
	token, _ := Token(testKey, "alpha", "task:read", time.Now().Add(time.Minute))
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode)
	}
	buffer := make([]byte, 16)
	if _, err = io.ReadFull(response.Body, buffer); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	cancel()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && len(s.permits) != 0 {
		time.Sleep(5 * time.Millisecond)
	}
	if len(s.permits) != 0 {
		t.Fatal("stream did not release admission permit")
	}
}
