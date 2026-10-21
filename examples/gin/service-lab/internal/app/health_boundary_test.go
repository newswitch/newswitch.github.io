package app

import "testing"

func TestDependencyFailureChangesReadinessNotLiveness(t *testing.T) {
	server, handler := setup(t)
	if err := server.Store.Close(); err != nil {
		t.Fatal(err)
	}
	live := call(t, handler, "GET", "/health/live", "", "", "", "")
	ready := call(t, handler, "GET", "/health/ready", "", "", "", "")
	if live.Code != 200 || ready.Code != 503 {
		t.Fatal(live.Code, ready.Code)
	}
	t.Logf("DB closed: live=%d ready=%d", live.Code, ready.Code)
}
