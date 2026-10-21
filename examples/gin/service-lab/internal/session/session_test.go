package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	_ "modernc.org/sqlite"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"newswitch.dev/gin-service-lab/internal/migrate"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func fixture(t *testing.T) (*Store, *atomic.Int64) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.ToSlash(filepath.Join(t.TempDir(), "sessions.db"))+"?_pragma=busy_timeout(1000)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	if err = migrate.Up(context.Background(), db, "sqlite", Migrations()); err != nil {
		t.Fatal(err)
	}
	clock := &atomic.Int64{}
	clock.Store(time.Unix(1800000000, 0).UnixMilli())
	s, err := New(db, "sqlite", 30*time.Second, 2*time.Minute, func() time.Time { return time.UnixMilli(clock.Load()) })
	if err != nil {
		t.Fatal(err)
	}
	return s, clock
}
func TestHTTPSLoginRenewLogout(t *testing.T) {
	s, _ := fixture(t)
	server := httptest.NewUnstartedServer(nil)
	origin := "https://" + server.Listener.Addr().String()
	handler, err := Handler(s, func(ctx context.Context, username, password string) (Identity, error) {
		if username != "lab" || password != "lab-test-input" {
			return Identity{}, ErrUnauthenticated
		}
		return Identity{"user-1", "alpha"}, nil
	}, origin)
	if err != nil {
		t.Fatal(err)
	}
	server.Config.Handler = handler
	server.StartTLS()
	defer server.Close()
	client := server.Client()
	client.Timeout = 3 * time.Second
	jar, _ := cookiejar.New(nil)
	client.Jar = jar
	request := func(method, path, body, csrf string) *http.Response {
		t.Helper()
		r, _ := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-CSRF-Token", csrf)
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	login := request("POST", "/session/login", `{"username":"lab","password":"lab-test-input"}`, "")
	if login.StatusCode != 200 {
		t.Fatal(login.StatusCode)
	}
	var output struct {
		CSRF string `json:"csrf_token"`
	}
	if err = json.NewDecoder(login.Body).Decode(&output); err != nil {
		t.Fatal(err)
	}
	login.Body.Close()
	var old *http.Cookie
	for _, cookie := range login.Cookies() {
		if cookie.Name == cookieName {
			old = cookie
		}
	}
	if old == nil || !old.Secure || !old.HttpOnly || old.Domain != "" || old.Path != "/" {
		t.Fatal("cookie boundary")
	}
	me := request("GET", "/session/me", "", "")
	if me.StatusCode != 200 {
		t.Fatal(me.StatusCode)
	}
	io.Copy(io.Discard, me.Body)
	me.Body.Close()
	denied := request("POST", "/session/renew", "", "")
	if denied.StatusCode != 403 {
		t.Fatal(denied.StatusCode)
	}
	denied.Body.Close()
	renew := request("POST", "/session/renew", "", output.CSRF)
	if renew.StatusCode != 200 {
		t.Fatal(renew.StatusCode)
	}
	if err = json.NewDecoder(renew.Body).Decode(&output); err != nil {
		t.Fatal(err)
	}
	renew.Body.Close()
	if _, _, err = s.Read(context.Background(), old.Value); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("old credential still active", err)
	}
	logout := request("POST", "/session/logout", "", output.CSRF)
	if logout.StatusCode != 204 {
		t.Fatal(logout.StatusCode)
	}
	logout.Body.Close()
	after := request("GET", "/session/me", "", "")
	if after.StatusCode != 401 {
		t.Fatal(after.StatusCode)
	}
	after.Body.Close()
	t.Log("https-login=200 me=200 no-csrf=403 renew=200 old-session=invalid logout=204 after=401")
}
func TestIdleAndAbsoluteExpiry(t *testing.T) {
	s, clock := fixture(t)
	ctx := context.Background()
	created, err := s.Create(ctx, Identity{"user", "alpha"}, "")
	if err != nil {
		t.Fatal(err)
	}
	clock.Add((31 * time.Second).Milliseconds())
	if _, _, err = s.Read(ctx, created.ID); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal(err)
	}
	created, err = s.Create(ctx, Identity{"user", "alpha"}, "")
	if err != nil {
		t.Fatal(err)
	}
	for range 5 {
		clock.Add((20 * time.Second).Milliseconds())
		if _, _, err = s.Read(ctx, created.ID); err != nil {
			t.Fatal(err)
		}
	}
	clock.Add((21 * time.Second).Milliseconds())
	if _, _, err = s.Read(ctx, created.ID); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("absolute cap bypassed", err)
	}
	t.Log("idle-expiry=enforced active-requests-cannot-extend-absolute=true")
}
func TestSharedStoreAndLoginRotation(t *testing.T) {
	s, _ := fixture(t)
	ctx := context.Background()
	a, err := s.Create(ctx, Identity{"user", "alpha"}, "")
	if err != nil {
		t.Fatal(err)
	}
	var sequence int
	var databaseName, filename string
	if err = s.DB.QueryRow("PRAGMA database_list").Scan(&sequence, &databaseName, &filename); err != nil {
		t.Fatal(err)
	}
	secondDB, err := sql.Open("sqlite", filepath.ToSlash(filename)+"?_pragma=busy_timeout(1000)")
	if err != nil {
		t.Fatal(err)
	}
	secondDB.SetMaxOpenConns(1)
	t.Cleanup(func() { secondDB.Close() })
	other, err := New(secondDB, "sqlite", s.Idle, s.Absolute, s.Now)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = other.Read(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	b, err := other.Create(ctx, Identity{"user", "alpha"}, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if a.ID == b.ID {
		t.Fatal("credential not rotated")
	}
	if _, _, err = s.Read(ctx, a.ID); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal(err)
	}
	if err = s.Revoke(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err = other.Read(ctx, b.ID); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal(err)
	}
	t.Log("two-service-instances=shared-authority login=rotates logout=shared")
}
func TestRotationFailureKeepsOldSession(t *testing.T) {
	s, _ := fixture(t)
	ctx := context.Background()
	a, err := s.Create(ctx, Identity{"user", "alpha"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec("CREATE TRIGGER refuse_session BEFORE INSERT ON lab_sessions BEGIN SELECT RAISE(ABORT,'lab failure'); END"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Rotate(ctx, a.ID); err == nil {
		t.Fatal("missing failure")
	}
	if _, _, err = s.Read(ctx, a.ID); err != nil {
		t.Fatal("old session revoked despite rollback", err)
	}
	t.Log("renew-insert-failure=rolled-back old-session=still-valid")
}
