package protocol

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

func init() { gin.SetMode(gin.TestMode) }

func TestBindings(t *testing.T) {
	r := Bindings()
	if r.ShouldWritten || r.ShouldStatus != 422 || !r.MustWritten || r.MustStatus != 400 ||
		!r.DefaultUnknownOK || !r.DefaultTailOK || !r.SecondBindEOF || !r.CachedRebindOK ||
		r.CachedBytes != 23 || !r.ZeroAccepted || r.StrictOversizeCode != 413 {
		t.Fatalf("%+v", r)
	}
}

func TestStrictInput(t *testing.T) {
	r := gin.New()
	r.POST("/", Handler)
	for _, tc := range []struct {
		name, media, body string
		status            int
	}{
		{"zero", "application/json", `{"name":"ok","count":0}`, 201},
		{"charset", "application/json; charset=utf-8", `{"name":"ok","count":1}`, 201},
		{"media", "text/plain", `{}`, 415},
		{"empty", "application/json", ``, 400},
		{"null-body", "application/json", `null`, 400},
		{"missing", "application/json", `{"name":"ok"}`, 400},
		{"null-field", "application/json", `{"name":"ok","count":null}`, 400},
		{"range", "application/json", `{"name":"ok","count":11}`, 400},
		{"blank-name", "application/json", `{"name":"  ","count":0}`, 400},
		{"unknown", "application/json", `{"name":"ok","count":0,"extra":1}`, 400},
		{"type", "application/json", `{"name":"ok","count":"x"}`, 400},
		{"tail", "application/json", `{"name":"ok","count":0} {}`, 400},
		{"invalid-tail", "application/json", `{"name":"ok","count":0} x`, 400},
		{"whitespace", "application/json", "{\"name\":\"ok\",\"count\":0} \n\t", 201},
		{"oversize-tail", "application/json", `{"name":"ok","count":0}` + strings.Repeat(" ", 64), 413},
		{"exact-limit", "application/json", `{"name":"ok","count":0}` + strings.Repeat(" ", 41), 201},
		{"array", "application/json", `[]`, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", tc.media)
			r.ServeHTTP(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestMustBindClassifiesMaxBytes(t *testing.T) {
	r := gin.New()
	var detected, committed, bindType bool
	r.POST("/", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8)
		var input Input
		err := c.BindJSON(&input)
		var tooLarge *http.MaxBytesError
		detected = errors.As(err, &tooLarge)
		committed = c.Writer.Written()
		bindType = len(c.Errors) == 1 && c.Errors[0].IsType(gin.ErrorTypeBind)
	})
	response := invoke(r, `{"name":"ok","count":0}`)
	if response.Code != 413 || !detected || !committed || !bindType {
		t.Fatalf("%d %t %t %t", response.Code, detected, committed, bindType)
	}
}

func TestCachedBodyRespectsLimit(t *testing.T) {
	r := gin.New()
	var detected, cached bool
	r.POST("/", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8)
		var input Input
		err := c.ShouldBindBodyWith(&input, binding.JSON)
		var tooLarge *http.MaxBytesError
		detected = errors.As(err, &tooLarge)
		_, cached = c.Get(gin.BodyBytesKey)
	})
	invoke(r, `{"name":"ok","count":0}`)
	if !detected || cached {
		t.Fatalf("detected=%t cached=%t", detected, cached)
	}
}

func TestResponsesOverHTTP(t *testing.T) {
	r, err := Responses()
	if err != nil || r.StatusOnlyWritten || r.StatusOnlySize != -1 || r.RevisedStatus != 201 ||
		!r.FlushedWritten || r.FlushedSize != 0 || r.LateStatus != 202 || r.LateHeader != "before" ||
		r.EncodingErrors != 1 || !r.EncodingAborted || r.EncodingWritten || r.NoPolicyStatus != 201 || r.NoPolicyBody != "" ||
		r.PolicyStatus != 500 || r.NoContentBody != "" {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestAutomaticAndExplicitBinding(t *testing.T) {
	for _, explicit := range []bool{false, true} {
		r := gin.New()
		status := 0
		r.POST("/", func(c *gin.Context) {
			var input Input
			var err error
			if explicit {
				err = c.ShouldBindJSON(&input)
			} else {
				err = c.ShouldBind(&input)
			}
			status = 201
			if err != nil {
				status = 400
			}
			c.Status(status)
		})
		req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"ok","count":0}`))
		req.Header.Set("Content-Type", "text/plain")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		want := 400
		if explicit {
			want = 201
		}
		if status != want {
			t.Fatalf("explicit=%t status=%d", explicit, status)
		}
	}
}
