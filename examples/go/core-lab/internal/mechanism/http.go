package mechanism

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type ClientResult struct {
	FirstReused            bool  `json:"first_reused"`
	SecondReused           bool  `json:"second_reused"`
	PoolDeadline           bool  `json:"pool_deadline"`
	QueuedGetConn          bool  `json:"queued_get_conn"`
	QueuedGotConn          bool  `json:"queued_got_conn"`
	RequestsWhileHeld      int64 `json:"requests_while_held"`
	AfterUnreadCloseReused bool  `json:"after_unread_close_reused"`
	AfterDrainReused       bool  `json:"after_drain_reused"`
}

func HTTPClient() (ClientResult, error) {
	var result ClientResult
	var requests atomic.Int64
	const size = 512 << 10 // Larger than Go 1.27.3's best-effort post-close drain cap.
	payload := strings.Repeat("x", size)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Length", strconv.Itoa(size))
		io.WriteString(w, payload)
	}))
	defer server.Close()
	// Plain HTTP/1.1, no proxy, no HTTP/2 multiplexing: deliberately isolate one pool.
	transport := &http.Transport{MaxConnsPerHost: 1, MaxIdleConns: 1, MaxIdleConnsPerHost: 1, IdleConnTimeout: time.Second}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 2 * time.Second}
	request := func(ctx context.Context, trace *httptrace.ClientTrace) (*http.Response, error) {
		req, err := http.NewRequestWithContext(httptrace.WithClientTrace(ctx, trace), http.MethodGet, server.URL, nil)
		if err != nil {
			return nil, err
		}
		return client.Do(req)
	}
	drained := func(destination *bool) error {
		response, err := request(context.Background(), &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) { *destination = info.Reused }})
		if err != nil {
			return err
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, size+1))
		if err != nil {
			return err
		}
		if len(body) != size {
			return fmt.Errorf("unexpected body size %d", len(body))
		}
		return nil
	}
	if err := drained(&result.FirstReused); err != nil {
		return result, err
	}
	held, err := request(context.Background(), &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) { result.SecondReused = info.Reused }})
	if err != nil {
		return result, err
	}
	defer held.Body.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	var getConn, gotConn atomic.Bool
	queued, err := request(ctx, &httptrace.ClientTrace{GetConn: func(string) { getConn.Store(true) }, GotConn: func(httptrace.GotConnInfo) { gotConn.Store(true) }})
	if queued != nil {
		queued.Body.Close()
	}
	result.PoolDeadline = errors.Is(err, context.DeadlineExceeded)
	result.QueuedGetConn = getConn.Load()
	result.QueuedGotConn = gotConn.Load()
	result.RequestsWhileHeld = requests.Load()
	if err := held.Body.Close(); err != nil {
		return result, err
	}
	if err := drained(&result.AfterUnreadCloseReused); err != nil {
		return result, err
	}
	if err := drained(&result.AfterDrainReused); err != nil {
		return result, err
	}
	return result, nil
}

type closeListener struct {
	net.Listener
	once   sync.Once
	closed chan struct{}
}

func (l *closeListener) Close() error {
	err := l.Listener.Close()
	l.once.Do(func() { close(l.closed) })
	return err
}

type ServerResult struct {
	GracefulCompleted       bool `json:"graceful_completed"`
	DeadlineReturned        bool `json:"deadline_returned"`
	DeadlineCanceledHandler bool `json:"deadline_canceled_handler"`
	CloseCanceledHandler    bool `json:"close_canceled_handler"`
}

// serverScenario always releases and joins its handler, Serve and client goroutines.
func serverScenario(expire bool) (drained, deadline, canceledBefore, canceledAfter bool, err error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return false, false, false, false, err
	}
	tracked := &closeListener{Listener: listener, closed: make(chan struct{})}
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseHandler := func() { releaseOnce.Do(func() { close(release) }) }
	entered := make(chan context.Context, 1)
	handlerDone := make(chan struct{})
	server := &http.Server{ReadHeaderTimeout: time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(handlerDone)
		entered <- r.Context()
		select {
		case <-release:
			io.WriteString(w, "finished")
		case <-r.Context().Done():
		}
	})}
	var owned sync.WaitGroup
	serveDone := make(chan error, 1)
	owned.Go(func() { serveDone <- server.Serve(tracked) })
	transport := &http.Transport{}
	client := &http.Client{Transport: transport, Timeout: 2 * time.Second}
	clientDone := make(chan error, 1)
	owned.Go(func() {
		response, requestErr := client.Get("http://" + listener.Addr().String())
		if requestErr == nil {
			var data []byte
			data, requestErr = io.ReadAll(io.LimitReader(response.Body, 64))
			response.Body.Close()
			if requestErr == nil && string(data) != "finished" {
				requestErr = fmt.Errorf("incomplete response")
			}
		}
		clientDone <- requestErr
	})
	defer transport.CloseIdleConnections()
	defer func() { releaseHandler(); server.Close(); owned.Wait() }()
	var requestContext context.Context
	select {
	case requestContext = <-entered:
	case <-time.After(3 * time.Second):
		return false, false, false, false, fmt.Errorf("handler not entered")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	if expire {
		cancel()
		ctx, cancel = context.WithTimeout(context.Background(), 40*time.Millisecond)
	}
	defer cancel()
	shutdownDone := make(chan error, 1)
	owned.Go(func() { shutdownDone <- server.Shutdown(ctx) })
	<-tracked.closed // Shutdown has closed the listener, not the active connection.
	if expire {
		shutdownErr := <-shutdownDone
		deadline = errors.Is(shutdownErr, context.DeadlineExceeded)
		canceledBefore = requestContext.Err() != nil
		if err = server.Close(); err != nil {
			return
		}
		<-handlerDone
		canceledAfter = errors.Is(requestContext.Err(), context.Canceled)
		<-clientDone // Abrupt close may return EOF, not a successful application response.
	} else {
		canceledBefore = requestContext.Err() != nil
		select {
		case shutdownErr := <-shutdownDone:
			return false, false, canceledBefore, false, fmt.Errorf("Shutdown returned with active handler: %v", shutdownErr)
		default:
		}
		releaseHandler()
		if err = <-clientDone; err != nil {
			return
		}
		if err = <-shutdownDone; err != nil {
			return
		}
		<-handlerDone
		drained = !canceledBefore
	}
	if serveErr := <-serveDone; !errors.Is(serveErr, http.ErrServerClosed) {
		err = fmt.Errorf("Serve: %w", serveErr)
	}
	return
}

func HTTPServer() (ServerResult, error) {
	var result ServerResult
	drained, _, _, _, err := serverScenario(false)
	if err != nil {
		return result, err
	}
	result.GracefulCompleted = drained
	_, result.DeadlineReturned, result.DeadlineCanceledHandler, result.CloseCanceledHandler, err = serverScenario(true)
	return result, err
}
