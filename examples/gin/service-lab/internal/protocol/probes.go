package protocol

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

type BindingReport struct {
	ShouldWritten      bool `json:"should_written"`
	ShouldStatus       int  `json:"should_status"`
	MustWritten        bool `json:"must_written"`
	MustStatus         int  `json:"must_status"`
	DefaultUnknownOK   bool `json:"default_unknown_ok"`
	DefaultTailOK      bool `json:"default_tail_ok"`
	SecondBindEOF      bool `json:"second_bind_eof"`
	CachedRebindOK     bool `json:"cached_rebind_ok"`
	CachedBytes        int  `json:"cached_bytes"`
	ZeroAccepted       bool `json:"zero_accepted"`
	StrictOversizeCode int  `json:"strict_oversize_code"`
}

func invoke(r http.Handler, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(rec, req)
	return rec
}

func Bindings() BindingReport {
	var report BindingReport
	for _, must := range []bool{false, true} {
		r := gin.New()
		r.POST("/", func(c *gin.Context) {
			var input Input
			var err error
			if must {
				err = c.BindJSON(&input)
			} else {
				err = c.ShouldBindJSON(&input)
			}
			if err == nil {
				panic("expected validation failure")
			}
			if must {
				report.MustWritten = c.Writer.Written()
			} else {
				report.ShouldWritten = c.Writer.Written()
			}
			c.Status(http.StatusUnprocessableEntity)
		})
		rec := invoke(r, `{}`)
		if must {
			report.MustStatus = rec.Code
		} else {
			report.ShouldStatus = rec.Code
		}
	}
	for i, body := range []string{`{"name":"ok","count":0,"extra":1}`, `{"name":"ok","count":0} {}`} {
		r := gin.New()
		r.POST("/", func(c *gin.Context) {
			var input Input
			ok := c.ShouldBindJSON(&input) == nil
			if i == 0 {
				report.DefaultUnknownOK = ok
			} else {
				report.DefaultTailOK = ok
			}
		})
		invoke(r, body)
	}
	body := `{"name":"ok","count":0}`
	r := gin.New()
	r.POST("/", func(c *gin.Context) {
		var first, second Input
		if c.ShouldBindJSON(&first) != nil {
			panic("first bind failed")
		}
		report.SecondBindEOF = c.ShouldBindJSON(&second) == io.EOF
	})
	invoke(r, body)
	r = gin.New()
	r.POST("/", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, BodyLimit)
		var first, second Input
		report.CachedRebindOK = c.ShouldBindBodyWith(&first, binding.JSON) == nil && c.ShouldBindBodyWith(&second, binding.JSON) == nil
		cached, _ := c.Get(gin.BodyBytesKey)
		if data, ok := cached.([]byte); ok {
			report.CachedBytes = len(data)
		}
	})
	invoke(r, body)
	r = gin.New()
	r.POST("/", Handler)
	report.ZeroAccepted = invoke(r, body).Code == http.StatusCreated
	report.StrictOversizeCode = invoke(r, body+strings.Repeat(" ", BodyLimit)).Code
	return report
}

type ResponseReport struct {
	StatusOnlyWritten bool   `json:"status_only_written"`
	StatusOnlySize    int    `json:"status_only_size"`
	RevisedStatus     int    `json:"revised_status"`
	FlushedWritten    bool   `json:"flushed_written"`
	FlushedSize       int    `json:"flushed_size"`
	LateStatus        int    `json:"late_status"`
	LateHeader        string `json:"late_header"`
	EncodingErrors    int    `json:"encoding_errors"`
	EncodingAborted   bool   `json:"encoding_aborted"`
	EncodingWritten   bool   `json:"encoding_written"`
	NoPolicyStatus    int    `json:"no_policy_status"`
	NoPolicyBody      string `json:"no_policy_body"`
	PolicyStatus      int    `json:"policy_status"`
	NoContentBody     string `json:"no_content_body"`
}

// Responses uses a real loopback HTTP/1.1 server, not just a Recorder.
// All routes and input sizes are finite; Close joins the owned server.
func Responses() (ResponseReport, error) {
	var report ResponseReport
	var mu sync.Mutex
	r := gin.New()
	r.Use(func(c *gin.Context) {
		mu.Lock()
		defer mu.Unlock()
		c.Next()
		if c.FullPath() == "/policy" && len(c.Errors) > 0 && !c.Writer.Written() {
			c.JSON(500, gin.H{"error": "encoding_failed"})
		}
	})
	r.GET("/pending", func(c *gin.Context) {
		c.Status(202)
		report.StatusOnlyWritten, report.StatusOnlySize = c.Writer.Written(), c.Writer.Size()
		c.JSON(201, gin.H{"ok": true})
	})
	r.GET("/flushed", func(c *gin.Context) {
		c.Status(202)
		c.Header("X-Stage", "before")
		c.Writer.Flush()
		report.FlushedWritten, report.FlushedSize = c.Writer.Written(), c.Writer.Size()
		c.Header("X-Stage", "after")
		c.Status(500)
		_, _ = c.Writer.WriteString("partial")
	})
	badJSON := func(c *gin.Context) {
		c.JSON(201, gin.H{"unsupported": make(chan int)})
		if c.FullPath() == "/no-policy" {
			report.EncodingErrors, report.EncodingAborted, report.EncodingWritten = len(c.Errors), c.IsAborted(), c.Writer.Written()
		}
	}
	r.GET("/no-policy", badJSON)
	r.GET("/policy", badJSON)
	r.GET("/empty", func(c *gin.Context) { c.JSON(204, gin.H{"ignored": true}) })
	server := httptest.NewServer(r)
	defer server.Close()
	client := server.Client()
	client.Timeout = 2 * time.Second
	get := func(path string) (int, string, string, error) {
		response, err := client.Get(server.URL + path)
		if err != nil {
			return 0, "", "", err
		}
		defer response.Body.Close()
		body, err := io.ReadAll(io.LimitReader(response.Body, 1024))
		if err != nil {
			return 0, "", "", err
		}
		// Join the handler's report updates explicitly; network receipt alone
		// is not used as a Go memory-model synchronization primitive.
		mu.Lock()
		mu.Unlock()
		return response.StatusCode, string(body), response.Header.Get("X-Stage"), nil
	}
	var err error
	if report.RevisedStatus, _, _, err = get("/pending"); err != nil {
		return report, err
	}
	if report.LateStatus, _, report.LateHeader, err = get("/flushed"); err != nil {
		return report, err
	}
	if report.NoPolicyStatus, report.NoPolicyBody, _, err = get("/no-policy"); err != nil {
		return report, err
	}
	if report.PolicyStatus, _, _, err = get("/policy"); err != nil {
		return report, err
	}
	if _, report.NoContentBody, _, err = get("/empty"); err != nil {
		return report, err
	}
	if report.EncodingErrors == 0 {
		return report, fmt.Errorf("expected encoding error")
	}
	return report, nil
}
