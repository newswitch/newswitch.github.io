package store

import (
	"context"
	"time"
)

// RecoverExhausted moves expired tasks with no retry budget to a terminal state.
// The conditional update fences concurrent recovery and the event shares its transaction.
func (s *Store) RecoverExhausted(ctx context.Context, now time.Time) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, s.q("SELECT id,tenant,name,state,version,result FROM tasks WHERE state='RUNNING' AND lease_until<=? AND attempts>=3 ORDER BY id LIMIT 32"), now.UnixMilli())
	if err != nil {
		return err
	}
	var tasks []Task
	for rows.Next() {
		t, e := scan(rows)
		if e != nil {
			rows.Close()
			return e
		}
		tasks = append(tasks, t)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, t := range tasks {
		r, e := tx.ExecContext(ctx, s.q("UPDATE tasks SET state='FAILED',version=version+1,lease_token=NULL WHERE id=? AND version=? AND state='RUNNING' AND lease_until<=? AND attempts>=3"), t.ID, t.Version, now.UnixMilli())
		if e != nil {
			return e
		}
		n, e := r.RowsAffected()
		if e != nil {
			return e
		}
		if n != 1 {
			continue
		}
		t.State = "FAILED"
		t.Version++
		if e = s.event(ctx, tx, t, "TaskFailed"); e != nil {
			return e
		}
	}
	return tx.Commit()
}
