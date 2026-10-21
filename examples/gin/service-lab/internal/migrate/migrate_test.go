package migrate

import (
	"context"
	"database/sql"
	_ "modernc.org/sqlite"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func database(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.ToSlash(filepath.Join(t.TempDir(), "migration.db"))+"?_pragma=busy_timeout(2000)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(2)
	t.Cleanup(func() { db.Close() })
	return db
}
func base() []Step {
	return []Step{{1, []string{"CREATE TABLE migration_notes(id TEXT PRIMARY KEY,body TEXT NOT NULL)"}}}
}
func TestUpIdempotentAndChecksum(t *testing.T) {
	db := database(t)
	ctx := context.Background()
	steps := base()
	for range 2 {
		if err := Up(ctx, db, "sqlite", steps); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := db.QueryRow("SELECT count(*) FROM lab_schema_versions").Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	steps[0].Statements[0] += " "
	if err := Up(ctx, db, "sqlite", steps); err == nil {
		t.Fatal("changed applied SQL accepted")
	}
	t.Log("applied=1 rerun=no-op changed-checksum=rejected")
}
func TestFailedStepRollsBackDDLAndLedger(t *testing.T) {
	db := database(t)
	ctx := context.Background()
	steps := base()
	if err := Up(ctx, db, "sqlite", steps); err != nil {
		t.Fatal(err)
	}
	steps = append(steps, Step{2, []string{"ALTER TABLE migration_notes ADD COLUMN optional_label TEXT", "INSERT INTO missing_lab_table(id) VALUES(1)"}})
	if err := Up(ctx, db, "sqlite", steps); err == nil {
		t.Fatal("expected failure")
	}
	var n int
	if err := db.QueryRow("SELECT count(*) FROM lab_schema_versions").Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	if _, err := db.Exec("SELECT optional_label FROM migration_notes"); err == nil {
		t.Fatal("DDL not rolled back")
	}
	t.Log("failed-version=2 ledger-version=1 partial-column=absent")
}
func TestConcurrentMigrationSerializes(t *testing.T) {
	db := database(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var group sync.WaitGroup
	failures := make(chan error, 2)
	for range 2 {
		group.Go(func() { failures <- Up(ctx, db, "sqlite", base()) })
	}
	group.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := db.QueryRow("SELECT count(*) FROM lab_schema_versions").Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	t.Log("concurrent-runners=2 applied-once=true")
}
