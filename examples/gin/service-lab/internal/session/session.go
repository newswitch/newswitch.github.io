// Package session implements an isolated browser-session lab. The SQL database
// is the authority; no process-local map is used to establish authentication.
package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"net/url"
	"newswitch.dev/gin-service-lab/internal/migrate"
	"strings"
	"time"
)

var ErrUnauthenticated = errors.New("session unavailable")

const cookieName = "__Host-go_lab"

type Identity struct {
	Subject string `json:"subject"`
	Tenant  string `json:"tenant"`
}
type Credential struct {
	ID, CSRF      string
	Identity      Identity
	AbsoluteUntil int64
}
type Store struct {
	DB             *sql.DB
	Dialect        string
	Idle, Absolute time.Duration
	Now            func() time.Time
}
type Authenticate func(context.Context, string, string) (Identity, error)

func Migrations() []migrate.Step {
	return []migrate.Step{
		{Version: 1, Statements: []string{"CREATE TABLE lab_sessions(id_hash TEXT PRIMARY KEY,subject TEXT NOT NULL,tenant TEXT NOT NULL,csrf_hash TEXT NOT NULL,idle_until BIGINT NOT NULL,absolute_until BIGINT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)"}},
		{Version: 2, Statements: []string{"CREATE INDEX lab_sessions_expiry ON lab_sessions(absolute_until)"}},
	}
}
func New(db *sql.DB, dialect string, idle, absolute time.Duration, now func() time.Time) (*Store, error) {
	if db == nil || (dialect != "sqlite" && dialect != "pgx") || idle <= 0 || absolute < idle || absolute > 24*time.Hour || now == nil {
		return nil, fmt.Errorf("invalid session configuration")
	}
	return &Store{db, dialect, idle, absolute, now}, nil
}
func (s *Store) q(query string) string {
	if s.Dialect != "pgx" {
		return query
	}
	n := 0
	var out strings.Builder
	for _, c := range query {
		if c == '?' {
			n++
			fmt.Fprintf(&out, "$%d", n)
		} else {
			out.WriteRune(c)
		}
	}
	return out.String()
}
func secret() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}
func digest(v string) string { sum := sha256.Sum256([]byte(v)); return hex.EncodeToString(sum[:]) }
func validID(v string) bool {
	if len(v) != 43 {
		return false
	}
	b, err := base64.RawURLEncoding.DecodeString(v)
	return err == nil && len(b) == 32
}
func (s *Store) fresh(identity Identity, absolute int64) (Credential, error) {
	id, err := secret()
	if err != nil {
		return Credential{}, err
	}
	csrf, err := secret()
	if err != nil {
		return Credential{}, err
	}
	return Credential{id, csrf, identity, absolute}, nil
}
func (s *Store) insert(ctx context.Context, tx *sql.Tx, c Credential, now time.Time) error {
	idle := now.Add(s.Idle).UnixMilli()
	if idle > c.AbsoluteUntil {
		idle = c.AbsoluteUntil
	}
	_, err := tx.ExecContext(ctx, s.q("INSERT INTO lab_sessions(id_hash,subject,tenant,csrf_hash,idle_until,absolute_until) VALUES(?,?,?,?,?,?)"), digest(c.ID), c.Identity.Subject, c.Identity.Tenant, digest(c.CSRF), idle, c.AbsoluteUntil)
	return err
}
func (s *Store) Create(ctx context.Context, identity Identity, previous string) (Credential, error) {
	if identity.Subject == "" || len(identity.Subject) > 80 || identity.Tenant == "" || len(identity.Tenant) > 40 {
		return Credential{}, fmt.Errorf("invalid identity")
	}
	now := s.Now()
	credential, err := s.fresh(identity, now.Add(s.Absolute).UnixMilli())
	if err != nil {
		return Credential{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Credential{}, err
	}
	defer tx.Rollback()
	if validID(previous) {
		if _, err = tx.ExecContext(ctx, s.q("UPDATE lab_sessions SET revoked=1 WHERE id_hash=?"), digest(previous)); err != nil {
			return Credential{}, err
		}
	}
	if err = s.insert(ctx, tx, credential, now); err != nil {
		return Credential{}, err
	}
	if err = tx.Commit(); err != nil {
		return Credential{}, err
	}
	return credential, nil
}
func (s *Store) Read(ctx context.Context, id string) (Identity, string, error) {
	if !validID(id) {
		return Identity{}, "", ErrUnauthenticated
	}
	now := s.Now()
	idle := now.Add(s.Idle).UnixMilli()
	var identity Identity
	var csrfHash string
	err := s.DB.QueryRowContext(ctx, s.q("UPDATE lab_sessions SET idle_until=CASE WHEN ?<absolute_until THEN ? ELSE absolute_until END WHERE id_hash=? AND revoked=0 AND idle_until>? AND absolute_until>? RETURNING subject,tenant,csrf_hash"), idle, idle, digest(id), now.UnixMilli(), now.UnixMilli()).Scan(&identity.Subject, &identity.Tenant, &csrfHash)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrUnauthenticated
	}
	return identity, csrfHash, err
}
func (s *Store) Rotate(ctx context.Context, id string) (Credential, error) {
	if !validID(id) {
		return Credential{}, ErrUnauthenticated
	}
	now := s.Now()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Credential{}, err
	}
	defer tx.Rollback()
	var identity Identity
	var absolute int64
	err = tx.QueryRowContext(ctx, s.q("SELECT subject,tenant,absolute_until FROM lab_sessions WHERE id_hash=? AND revoked=0 AND idle_until>? AND absolute_until>?"), digest(id), now.UnixMilli(), now.UnixMilli()).Scan(&identity.Subject, &identity.Tenant, &absolute)
	if errors.Is(err, sql.ErrNoRows) {
		return Credential{}, ErrUnauthenticated
	}
	if err != nil {
		return Credential{}, err
	}
	r, err := tx.ExecContext(ctx, s.q("UPDATE lab_sessions SET revoked=1 WHERE id_hash=? AND revoked=0 AND idle_until>? AND absolute_until>?"), digest(id), now.UnixMilli(), now.UnixMilli())
	if err != nil {
		return Credential{}, err
	}
	n, err := r.RowsAffected()
	if err != nil {
		return Credential{}, err
	}
	if n != 1 {
		return Credential{}, ErrUnauthenticated
	}
	next, err := s.fresh(identity, absolute)
	if err != nil {
		return Credential{}, err
	}
	if err = s.insert(ctx, tx, next, now); err != nil {
		return Credential{}, err
	}
	if err = tx.Commit(); err != nil {
		return Credential{}, err
	}
	return next, nil
}
func (s *Store) Revoke(ctx context.Context, id string) error {
	_, err := s.DB.ExecContext(ctx, s.q("UPDATE lab_sessions SET revoked=1 WHERE id_hash=?"), digest(id))
	return err
}

// PurgeExpired is an explicit bounded maintenance operation, not a goroutine
// started implicitly by the HTTP constructor. The caller controls its schedule.
func (s *Store) PurgeExpired(ctx context.Context, limit int) (int64, error) {
	if limit < 1 || limit > 1000 {
		return 0, fmt.Errorf("purge limit must be 1..1000")
	}
	r, err := s.DB.ExecContext(ctx, s.q("DELETE FROM lab_sessions WHERE id_hash IN (SELECT id_hash FROM lab_sessions WHERE absolute_until<=? ORDER BY absolute_until LIMIT ?)"), s.Now().UnixMilli(), limit)
	if err != nil {
		return 0, err
	}
	return r.RowsAffected()
}

// Handler is a same-origin HTTPS browser API. The authenticator is deliberately
// injected: a cookie store is not a password database or an identity provider.
func Handler(s *Store, authenticate Authenticate, origin string) (http.Handler, error) {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || authenticate == nil || s == nil {
		return nil, fmt.Errorf("exact HTTPS origin and authenticator required")
	}
	r := gin.New()
	r.SetTrustedProxies(nil)
	r.Use(gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, recovered any) { c.AbortWithStatus(500) }))
	r.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		if c.Request.Method == http.MethodPost && c.GetHeader("Origin") != origin {
			c.AbortWithStatus(403)
			return
		}
		c.Next()
	})
	writeCookie := func(c *gin.Context, id string) {
		cookie := &http.Cookie{Name: cookieName, Value: id, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteLaxMode}
		if id == "" {
			cookie.MaxAge = -1
			cookie.Expires = time.Unix(1, 0)
		}
		http.SetCookie(c.Writer, cookie)
	}
	loginSlots := make(chan struct{}, 4)
	r.POST("/session/login", func(c *gin.Context) {
		select {
		case loginSlots <- struct{}{}:
			defer func() { <-loginSlots }()
		default:
			c.AbortWithStatus(429)
			return
		}
		var input struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || len(input.Username) == 0 || len(input.Username) > 80 || len(input.Password) == 0 || len(input.Password) > 512 {
			c.AbortWithStatus(400)
			return
		}
		if decoder.Decode(&struct{}{}) != io.EOF {
			c.AbortWithStatus(400)
			return
		}
		identity, err := authenticate(c.Request.Context(), input.Username, input.Password)
		if err != nil {
			c.AbortWithStatus(401)
			return
		}
		previous, _ := c.Cookie(cookieName)
		credential, err := s.Create(c.Request.Context(), identity, previous)
		if err != nil {
			c.AbortWithStatus(503)
			return
		}
		writeCookie(c, credential.ID)
		c.JSON(200, gin.H{"csrf_token": credential.CSRF, "identity": credential.Identity})
	})
	protected := r.Group("/session", func(c *gin.Context) {
		id, _ := c.Cookie(cookieName)
		identity, csrfHash, err := s.Read(c.Request.Context(), id)
		if errors.Is(err, ErrUnauthenticated) {
			writeCookie(c, "")
			c.AbortWithStatus(401)
			return
		}
		if err != nil {
			c.AbortWithStatus(503)
			return
		}
		if c.Request.Method == http.MethodPost {
			csrf := c.GetHeader("X-CSRF-Token")
			if len(csrf) != 43 || subtle.ConstantTimeCompare([]byte(digest(csrf)), []byte(csrfHash)) != 1 {
				c.AbortWithStatus(403)
				return
			}
		}
		c.Set("session_id", id)
		c.Set("session_identity", identity)
		c.Next()
	})
	protected.GET("/me", func(c *gin.Context) { c.JSON(200, c.MustGet("session_identity")) })
	protected.POST("/renew", func(c *gin.Context) {
		next, err := s.Rotate(c.Request.Context(), c.GetString("session_id"))
		if errors.Is(err, ErrUnauthenticated) {
			c.AbortWithStatus(401)
			return
		}
		if err != nil {
			c.AbortWithStatus(503)
			return
		}
		writeCookie(c, next.ID)
		c.JSON(200, gin.H{"csrf_token": next.CSRF})
	})
	protected.POST("/logout", func(c *gin.Context) {
		if err := s.Revoke(c.Request.Context(), c.GetString("session_id")); err != nil {
			c.AbortWithStatus(503)
			return
		}
		writeCookie(c, "")
		c.Status(204)
	})
	return r, nil
}
