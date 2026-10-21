// Package migrate is a small transactional DDL lab, not a general migration product.
package migrate

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type Step struct {
	Version    int
	Statements []string
}

func checksum(step Step) string {
	encoded, _ := json.Marshal(step.Statements)
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

// Up serializes this lab's migrations on a pinned connection. All steps and the
// ledger commit together. Only transactional DDL is supported; no network calls.
func Up(ctx context.Context, db *sql.DB, dialect string, steps []Step) (resultErr error) {
	if db == nil || (dialect != "sqlite" && dialect != "pgx") {
		return fmt.Errorf("unsupported migration dialect")
	}
	for i, step := range steps {
		if step.Version != i+1 || len(step.Statements) == 0 {
			return fmt.Errorf("versions must be contiguous from 1")
		}
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	begin := "BEGIN"
	if dialect == "sqlite" {
		begin = "BEGIN IMMEDIATE"
	}
	if _, err = conn.ExecContext(ctx, begin); err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			cleanup, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if _, rollbackErr := conn.ExecContext(cleanup, "ROLLBACK"); rollbackErr != nil {
				resultErr = errors.Join(resultErr, fmt.Errorf("migration rollback: %w", rollbackErr))
				_ = conn.Raw(func(any) error { return driver.ErrBadConn })
			}
		}
	}()
	if dialect == "pgx" {
		if _, err = conn.ExecContext(ctx, "SELECT pg_advisory_xact_lock(7241001)"); err != nil {
			return err
		}
	}
	if _, err = conn.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS lab_schema_versions(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at BIGINT NOT NULL)"); err != nil {
		return err
	}
	rows, err := conn.QueryContext(ctx, "SELECT version,checksum FROM lab_schema_versions ORDER BY version")
	if err != nil {
		return err
	}
	applied := 0
	for rows.Next() {
		var version int
		var sum string
		if err = rows.Scan(&version, &sum); err != nil {
			rows.Close()
			return err
		}
		if version != applied+1 || version > len(steps) || sum != checksum(steps[version-1]) {
			rows.Close()
			return fmt.Errorf("migration history mismatch at version %d", version)
		}
		applied++
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, step := range steps[applied:] {
		for _, statement := range step.Statements {
			if _, err = conn.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("migration %d: %w", step.Version, err)
			}
		}
		query := "INSERT INTO lab_schema_versions(version,checksum,applied_at) VALUES(?,?,?)"
		if dialect == "pgx" {
			query = "INSERT INTO lab_schema_versions(version,checksum,applied_at) VALUES($1,$2,$3)"
		}
		if _, err = conn.ExecContext(ctx, query, step.Version, checksum(step), time.Now().UnixMilli()); err != nil {
			return err
		}
	}
	if _, err = conn.ExecContext(ctx, "COMMIT"); err != nil {
		return err
	}
	committed = true
	return nil
}
