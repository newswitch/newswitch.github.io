package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
	"strings"
	"time"
)

var ErrMissing = errors.New("missing task")
var ErrConflict = errors.New("task conflict")

type Task struct {
	ID      string `json:"id"`
	Tenant  string `json:"-"`
	Name    string `json:"name"`
	State   string `json:"state"`
	Version int64  `json:"version"`
	Result  string `json:"result,omitempty"`
}
type Event struct {
	ID      string `json:"event_id"`
	TaskID  string `json:"task_id"`
	Tenant  string `json:"tenant"`
	Kind    string `json:"kind"`
	Version int64  `json:"version"`
}
type Claim struct {
	Task  Task
	Token string
}
type Store struct {
	DB       *sql.DB
	postgres bool
}

const schema = `
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,request_key TEXT NOT NULL,name TEXT NOT NULL,state TEXT NOT NULL,version BIGINT NOT NULL,result TEXT NOT NULL DEFAULT '',lease_token TEXT,lease_until BIGINT NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,UNIQUE(tenant,request_key));
CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,tenant TEXT NOT NULL,kind TEXT NOT NULL,version BIGINT NOT NULL,body TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0,claim_token TEXT,lease_until BIGINT NOT NULL DEFAULT 0,retry_at BIGINT NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(event_id TEXT PRIMARY KEY,tenant TEXT NOT NULL,task_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS tasks_claim ON tasks(state,lease_until);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(sent,retry_at,lease_until);
`

func Open(ctx context.Context, driver, dsn string) (*Store, error) {
	if driver != "sqlite" && driver != "pgx" {
		return nil, fmt.Errorf("unsupported driver")
	}
	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(5 * time.Minute)
	if driver == "sqlite" {
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)
	}
	s := &Store{DB: db, postgres: driver == "pgx"}
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	// Only for this isolated lab. Production uses versioned migrations and a separately authorized DDL step.
	for _, statement := range strings.Split(schema, ";") {
		if strings.TrimSpace(statement) != "" {
			if _, err = db.ExecContext(ctx, statement); err != nil {
				db.Close()
				return nil, err
			}
		}
	}
	return s, nil
}
func (s *Store) Close() error { return s.DB.Close() }
func ID() string {
	var data [16]byte
	if _, err := rand.Read(data[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(data[:])
}

// Rebind only these fixed lab statements; this is not a general SQL lexer.
func (s *Store) q(query string) string {
	if !s.postgres {
		return query
	}
	var b strings.Builder
	n := 0
	for _, c := range query {
		if c == '?' {
			n++
			fmt.Fprintf(&b, "$%d", n)
		} else {
			b.WriteRune(c)
		}
	}
	return b.String()
}
func scan(row interface{ Scan(...any) error }) (Task, error) {
	var t Task
	err := row.Scan(&t.ID, &t.Tenant, &t.Name, &t.State, &t.Version, &t.Result)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrMissing
	}
	return t, err
}
func valid(tenant, key, name string) bool {
	return tenant != "" && len(tenant) <= 40 && key != "" && len(key) <= 80 && strings.TrimSpace(name) != "" && len(name) <= 80
}
func (s *Store) Create(ctx context.Context, tenant, key, name string) (Task, error) {
	if !valid(tenant, key, name) {
		return Task{}, fmt.Errorf("invalid task input")
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback()
	task := Task{ID: ID(), Tenant: tenant, Name: name, State: "NEW"}
	result, err := tx.ExecContext(ctx, s.q("INSERT INTO tasks(id,tenant,request_key,name,state,version) VALUES(?,?,?,?,'NEW',0) ON CONFLICT(tenant,request_key) DO NOTHING"), task.ID, tenant, key, name)
	if err != nil {
		return Task{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return Task{}, err
	}
	if count == 0 {
		task, err = scan(tx.QueryRowContext(ctx, s.q("SELECT id,tenant,name,state,version,result FROM tasks WHERE tenant=? AND request_key=?"), tenant, key))
		if err != nil {
			return Task{}, err
		}
		if task.Name != name {
			return Task{}, ErrConflict
		}
	} else {
		if err = s.event(ctx, tx, task, "TaskCreated"); err != nil {
			return Task{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return Task{}, err
	}
	return task, nil
}
func (s *Store) event(ctx context.Context, tx *sql.Tx, t Task, kind string) error {
	event := Event{ID: ID(), TaskID: t.ID, Tenant: t.Tenant, Kind: kind, Version: t.Version}
	body, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, s.q("INSERT INTO outbox(id,task_id,tenant,kind,version,body) VALUES(?,?,?,?,?,?)"), event.ID, t.ID, t.Tenant, kind, t.Version, string(body))
	return err
}
func (s *Store) Get(ctx context.Context, tenant, id string) (Task, error) {
	return scan(s.DB.QueryRowContext(ctx, s.q("SELECT id,tenant,name,state,version,result FROM tasks WHERE tenant=? AND id=?"), tenant, id))
}
func (s *Store) List(ctx context.Context, tenant, after string, limit int) ([]Task, error) {
	if limit < 1 || limit > 100 {
		return nil, fmt.Errorf("invalid limit")
	}
	rows, err := s.DB.QueryContext(ctx, s.q("SELECT id,tenant,name,state,version,result FROM tasks WHERE tenant=? AND id>? ORDER BY id LIMIT ?"), tenant, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Task{}
	for rows.Next() {
		t, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Store) Cancel(ctx context.Context, tenant, id string, version int64) (Task, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, s.q("UPDATE tasks SET state='CANCELLED',version=version+1 WHERE tenant=? AND id=? AND version=? AND state='NEW'"), tenant, id, version)
	if err != nil {
		return Task{}, err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		if _, err = scan(tx.QueryRowContext(ctx, s.q("SELECT id,tenant,name,state,version,result FROM tasks WHERE tenant=? AND id=?"), tenant, id)); err != nil {
			return Task{}, err
		}
		return Task{}, ErrConflict
	}
	t, err := scan(tx.QueryRowContext(ctx, s.q("SELECT id,tenant,name,state,version,result FROM tasks WHERE tenant=? AND id=?"), tenant, id))
	if err != nil {
		return Task{}, err
	}
	if err = s.event(ctx, tx, t, "TaskCancelled"); err != nil {
		return Task{}, err
	}
	if err = tx.Commit(); err != nil {
		return Task{}, err
	}
	return t, nil
}
func (s *Store) Claim(ctx context.Context, now time.Time, ttl time.Duration) (Claim, error) {
	if ttl <= 0 {
		return Claim{}, fmt.Errorf("invalid ttl")
	}
	if err := s.RecoverExhausted(ctx, now); err != nil {
		return Claim{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Claim{}, err
	}
	defer tx.Rollback()
	row := tx.QueryRowContext(ctx, s.q("SELECT id,tenant,name,state,version,result FROM tasks WHERE (state='NEW' OR (state='RUNNING' AND lease_until<=?)) AND attempts<3 ORDER BY id LIMIT 1"), now.UnixMilli())
	t, err := scan(row)
	if err != nil {
		return Claim{}, err
	}
	token := ID()
	result, err := tx.ExecContext(ctx, s.q("UPDATE tasks SET state='RUNNING',version=version+1,lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND version=? AND (state='NEW' OR (state='RUNNING' AND lease_until<=?)) AND attempts<3"), token, now.Add(ttl).UnixMilli(), t.ID, t.Version, now.UnixMilli())
	if err != nil {
		return Claim{}, err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return Claim{}, ErrConflict
	}
	t.State = "RUNNING"
	t.Version++
	if err = tx.Commit(); err != nil {
		return Claim{}, err
	}
	return Claim{Task: t, Token: token}, nil
}
func (s *Store) Finish(ctx context.Context, claim Claim, result string, now time.Time) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	r, err := tx.ExecContext(ctx, s.q("UPDATE tasks SET state='SUCCEEDED',version=version+1,result=?,lease_token=NULL WHERE id=? AND tenant=? AND state='RUNNING' AND lease_token=? AND lease_until>?"), result, claim.Task.ID, claim.Task.Tenant, claim.Token, now.UnixMilli())
	if err != nil {
		return err
	}
	n, _ := r.RowsAffected()
	if n != 1 {
		return ErrConflict
	}
	t := claim.Task
	t.State = "SUCCEEDED"
	t.Version++
	if err = s.event(ctx, tx, t, "TaskSucceeded"); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Apply(ctx context.Context, event Event) (bool, error) {
	if event.ID == "" || event.Tenant == "" || event.TaskID == "" || event.Version < 0 {
		return false, fmt.Errorf("invalid event")
	}
	if event.Kind != "TaskCreated" && event.Kind != "TaskCancelled" && event.Kind != "TaskSucceeded" && event.Kind != "TaskFailed" {
		return false, fmt.Errorf("unknown event kind")
	}
	body, _ := json.Marshal(event)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	r, err := tx.ExecContext(ctx, s.q("INSERT INTO inbox(id,body) VALUES(?,?) ON CONFLICT(id) DO NOTHING"), event.ID, string(body))
	if err != nil {
		return false, err
	}
	n, _ := r.RowsAffected()
	if n == 0 {
		var prior string
		if err = tx.QueryRowContext(ctx, s.q("SELECT body FROM inbox WHERE id=?"), event.ID).Scan(&prior); err != nil {
			return false, err
		}
		if prior != string(body) {
			return false, ErrConflict
		}
		return false, tx.Commit()
	}
	if _, err = tx.ExecContext(ctx, s.q("INSERT INTO notifications(event_id,tenant,task_id) VALUES(?,?,?)"), event.ID, event.Tenant, event.TaskID); err != nil {
		return false, err
	}
	return true, tx.Commit()
}
