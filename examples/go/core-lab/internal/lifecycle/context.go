// Package lifecycle provides finite, owned concurrency experiments.
package lifecycle

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"golang.org/x/sync/errgroup"
)

type requestIDKey struct{}

type ContextResult struct {
	ChildLeavesParentActive  bool   `json:"child_leaves_parent_active"`
	SiblingReceivesCause     bool   `json:"sibling_receives_cause"`
	FirstChildCausePreserved bool   `json:"first_child_cause_preserved"`
	DeadlineNotExtended      bool   `json:"deadline_not_extended"`
	DetachedDoneNil          bool   `json:"detached_done_nil"`
	DetachedValue            string `json:"detached_value"`
}

func Contexts() ContextResult {
	var result ContextResult
	base := context.WithValue(context.Background(), requestIDKey{}, "request-42")
	parent, cancelParent := context.WithCancelCause(base)
	defer cancelParent(nil)
	child, cancelChild := context.WithCancelCause(parent)
	defer cancelChild(nil)
	sibling, cancelSibling := context.WithCancel(parent)
	defer cancelSibling()
	childCause, rootCause := errors.New("branch finished"), errors.New("service draining")
	cancelChild(childCause)
	result.ChildLeavesParentActive = parent.Err() == nil && sibling.Err() == nil
	cancelParent(rootCause)
	result.SiblingReceivesCause = errors.Is(sibling.Err(), context.Canceled) && context.Cause(sibling) == rootCause
	result.FirstChildCausePreserved = context.Cause(child) == childCause
	deadlineParent, finishParent := context.WithTimeout(base, time.Hour)
	defer finishParent()
	deadlineChild, finishChild := context.WithTimeout(deadlineParent, 2*time.Hour)
	defer finishChild()
	a, _ := deadlineParent.Deadline()
	b, _ := deadlineChild.Deadline()
	result.DeadlineNotExtended = a.Equal(b)
	detached := context.WithoutCancel(parent)
	result.DetachedDoneNil = detached.Done() == nil && detached.Err() == nil && context.Cause(detached) == nil
	result.DetachedValue = detached.Value(requestIDKey{}).(string)
	return result
}

type GroupResult struct {
	FirstError                 bool  `json:"first_error"`
	CausePreserved             bool  `json:"cause_preserved"`
	Joined                     int64 `json:"joined"`
	SuccessWaitErrorNil        bool  `json:"success_wait_error_nil"`
	SuccessContextCanceled     bool  `json:"success_context_canceled"`
	CanceledParentWaitErrorNil bool  `json:"canceled_parent_wait_error_nil"`
}

func Groups() GroupResult {
	var result GroupResult
	group, ctx := errgroup.WithContext(context.Background())
	ready := make(chan struct{})
	failure := errors.New("dependency failed")
	var joined atomic.Int64
	group.Go(func() error { defer joined.Add(1); <-ready; return failure })
	group.Go(func() error { defer joined.Add(1); close(ready); <-ctx.Done(); return ctx.Err() })
	result.FirstError = errors.Is(group.Wait(), failure)
	result.CausePreserved = context.Cause(ctx) == failure
	result.Joined = joined.Load()
	success, successContext := errgroup.WithContext(context.Background())
	success.Go(func() error { return nil })
	result.SuccessWaitErrorNil = success.Wait() == nil
	result.SuccessContextCanceled = errors.Is(successContext.Err(), context.Canceled)
	parent, cancel := context.WithCancel(context.Background())
	cancel()
	ignoring, _ := errgroup.WithContext(parent)
	ignoring.Go(func() error { return nil }) // Wait reports task errors, not parent.Err automatically.
	result.CanceledParentWaitErrorNil = ignoring.Wait() == nil
	return result
}
