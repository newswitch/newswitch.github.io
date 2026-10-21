//go:build integration

package integration

import (
	"context"
	"database/sql"
	"errors"
	"github.com/jackc/pgx/v5"
	"newswitch.dev/gin-service-lab/internal/migrate"
	"newswitch.dev/gin-service-lab/internal/session"
	"newswitch.dev/gin-service-lab/internal/store"
	"testing"
	"time"
)

func TestPostgresSessionMigrationAndRevocation(t *testing.T) {
	dsn := required(t, "GO_LAB_PG_DSN")
	config, err := pgx.ParseConfig(dsn)
	if err != nil || config.Database != "gin_lab" || (config.Host != "127.0.0.1" && config.Host != "localhost") {
		t.Fatal("isolated loopback gin_lab required")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(4)
	t.Cleanup(func() { db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	steps := session.Migrations()
	if err = migrate.Up(ctx, db, "pgx", steps); err != nil {
		t.Fatal(err)
	}
	tenant := "it-" + store.ID()
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		if _, e := db.ExecContext(cleanup, "DELETE FROM lab_sessions WHERE tenant=$1", tenant); e != nil {
			t.Error(e)
		}
	})
	s, err := session.New(db, "pgx", 30*time.Second, 2*time.Minute, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.Create(ctx, session.Identity{Subject: "user", Tenant: tenant}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.Read(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	b, err := s.Rotate(ctx, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.Read(ctx, a.ID); !errors.Is(err, session.ErrUnauthenticated) {
		t.Fatal(err)
	}
	if err = s.Revoke(ctx, b.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.Read(ctx, b.ID); !errors.Is(err, session.ErrUnauthenticated) {
		t.Fatal(err)
	}
	column := "rollback_probe_" + store.ID()
	failed := append(steps, migrate.Step{Version: 3, Statements: []string{"ALTER TABLE lab_sessions ADD COLUMN " + column + " TEXT", "INSERT INTO nonexistent_deepening_table(id) VALUES(1)"}})
	if err = migrate.Up(ctx, db, "pgx", failed); err == nil {
		t.Fatal("expected migration failure")
	}
	var count int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='lab_sessions' AND column_name=$1", column).Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM lab_schema_versions").Scan(&count); err != nil || count != 2 {
		t.Fatal(count, err)
	}
}
