package session

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWrongOriginRejectedBeforeAuthentication(t *testing.T) {
	s, _ := fixture(t)
	calls := 0
	handler, err := Handler(s, func(context.Context, string, string) (Identity, error) {
		calls++
		return Identity{"user", "alpha"}, nil
	}, "https://app.example.test")
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "https://app.example.test/session/login", strings.NewReader(`{"username":"lab","password":"lab"}`))
	r.Header.Set("Origin", "https://different.example.test")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 403 || calls != 0 {
		t.Fatal(w.Code, calls)
	}
	t.Log("wrong-origin=403 authenticator-calls=0")
}
func TestStorageFailureIsNotAuthenticated(t *testing.T) {
	s, _ := fixture(t)
	a, err := s.Create(context.Background(), Identity{"user", "alpha"}, "")
	if err != nil {
		t.Fatal(err)
	}
	handler, err := Handler(s, func(context.Context, string, string) (Identity, error) { return Identity{}, ErrUnauthenticated }, "https://app.example.test")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.DB.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "https://app.example.test/session/me", nil)
	r.AddCookie(&http.Cookie{Name: cookieName, Value: a.ID})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 503 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w.Code, w.Header())
	}
	t.Log("session-store-unavailable=503 authenticated=false cache-control=no-store")
}
