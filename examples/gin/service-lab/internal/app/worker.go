package app

import (
	"context"
	"fmt"
	"newswitch.dev/gin-service-lab/internal/store"
	"time"
)

func RunOne(ctx context.Context, s *store.Store) error {
	claim, err := s.Claim(ctx, time.Now(), 30*time.Second)
	if err != nil {
		return err
	}
	timer := time.NewTimer(5 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
	}
	return s.Finish(ctx, claim, fmt.Sprintf("completed:%s", claim.Task.Name), time.Now())
}
