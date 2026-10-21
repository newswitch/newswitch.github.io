package mechanism

import "testing"

func TestHTTPClientPool(t *testing.T) {
	got, err := HTTPClient()
	if err != nil {
		t.Fatal(err)
	}
	if got.FirstReused || !got.SecondReused || !got.PoolDeadline || !got.QueuedGetConn || got.QueuedGotConn || got.RequestsWhileHeld != 2 || got.AfterUnreadCloseReused || !got.AfterDrainReused {
		t.Fatalf("%+v", got)
	}
	t.Logf("%+v", got)
}
func TestHTTPServerDrain(t *testing.T) {
	got, err := HTTPServer()
	if err != nil {
		t.Fatal(err)
	}
	if !got.GracefulCompleted || !got.DeadlineReturned || got.DeadlineCanceledHandler || !got.CloseCanceledHandler {
		t.Fatalf("%+v", got)
	}
	t.Logf("%+v", got)
}
