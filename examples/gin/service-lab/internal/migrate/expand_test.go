package migrate

import (
	"context"
	"database/sql"
	"testing"
)

func TestExpandPreservesOldReadersAndWriters(t *testing.T) {
	db := database(t)
	ctx := context.Background()
	steps := base()
	if err := Up(ctx, db, "sqlite", steps); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO migration_notes(id,body) VALUES('before','old')"); err != nil {
		t.Fatal(err)
	}
	steps = append(steps, Step{2, []string{"ALTER TABLE migration_notes ADD COLUMN optional_label TEXT"}})
	if err := Up(ctx, db, "sqlite", steps); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO migration_notes(id,body) VALUES('after','old-writer')"); err != nil {
		t.Fatal(err)
	}
	var body string
	var label sql.NullString
	if err := db.QueryRow("SELECT body,optional_label FROM migration_notes WHERE id='before'").Scan(&body, &label); err != nil || body != "old" || label.Valid {
		t.Fatal(body, label, err)
	}
	t.Log("expand=nullable-column old-reader=works old-writer=works backfill=still-required")
}
