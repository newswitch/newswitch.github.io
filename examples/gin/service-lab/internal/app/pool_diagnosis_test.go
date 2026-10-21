package app

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPoolWaitDiagnosisAndRecovery(t *testing.T) {
	s, handler := setup(t)
	// SQLite lab has exactly one connection. Hold it without executing slow SQL.
	owned, err := s.Store.DB.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer owned.Close()
	before := s.Store.DB.Stats()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	request := httptest.NewRequest("GET", "/api/tasks?limit=10", nil).WithContext(ctx)
	token, err := Token(testKey, "alpha", "task:read", time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	during := s.Store.DB.Stats()
	if response.Code != 504 || during.WaitCount-before.WaitCount != 1 || during.WaitDuration <= before.WaitDuration || during.InUse != 1 {
		t.Fatal(response.Code, during)
	}
	if err = owned.Close(); err != nil {
		t.Fatal(err)
	}
	recovered := call(t, handler, "GET", "/api/tasks?limit=10", "", "alpha", "task:read", "")
	if recovered.Code != 200 {
		t.Fatal(recovered.Code, recovered.Body.String())
	}
	if len(s.permits) != 0 {
		t.Fatal("request permit leaked")
	}
	t.Logf("held-connection: status=%d wait-count-delta=%d in-use=%d", response.Code, during.WaitCount-before.WaitCount, during.InUse)
	t.Logf("after-close: status=%d in-use=%d permits=%d", recovered.Code, s.Store.DB.Stats().InUse, len(s.permits))
}
