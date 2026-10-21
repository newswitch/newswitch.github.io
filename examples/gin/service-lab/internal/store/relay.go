package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type Publisher interface {
	Publish(context.Context, Event) error
}
type PublisherFunc func(context.Context, Event) error

func (f PublisherFunc) Publish(ctx context.Context, e Event) error { return f(ctx, e) }
func (s *Store) RelayOnce(ctx context.Context, publisher Publisher, now time.Time) error {
	token := ID()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var id, body string
	err = tx.QueryRowContext(ctx, s.q("SELECT id,body FROM outbox WHERE sent=0 AND retry_at<=? AND (claim_token IS NULL OR lease_until<=?) ORDER BY id LIMIT 1"), now.UnixMilli(), now.UnixMilli()).Scan(&id, &body)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrMissing
	}
	if err != nil {
		return err
	}
	r, err := tx.ExecContext(ctx, s.q("UPDATE outbox SET claim_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND sent=0 AND retry_at<=? AND (claim_token IS NULL OR lease_until<=?)"), token, now.Add(30*time.Second).UnixMilli(), id, now.UnixMilli(), now.UnixMilli())
	if err != nil {
		return err
	}
	n, _ := r.RowsAffected()
	if n != 1 {
		return ErrConflict
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	var event Event
	if err = json.Unmarshal([]byte(body), &event); err != nil {
		return err
	}
	publishCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	err = publisher.Publish(publishCtx, event)
	if err != nil {
		_, retryErr := s.DB.ExecContext(ctx, s.q("UPDATE outbox SET claim_token=NULL,retry_at=? WHERE id=? AND claim_token=? AND sent=0"), now.Add(time.Second).UnixMilli(), id, token)
		if retryErr != nil {
			return errors.Join(err, retryErr)
		}
		return err
	}
	r, err = s.DB.ExecContext(ctx, s.q("UPDATE outbox SET sent=1,claim_token=NULL WHERE id=? AND claim_token=? AND sent=0"), id, token)
	if err != nil {
		return err
	}
	n, _ = r.RowsAffected()
	if n != 1 {
		return fmt.Errorf("%w: stale relay", ErrConflict)
	}
	return nil
}
