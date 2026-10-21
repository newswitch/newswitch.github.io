package requestflow

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMiddlewareRegistrationSnapshots(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/early", func(c *gin.Context) { c.Status(200) })
	r.Use(func(c *gin.Context) { c.Header("X-Registered", "yes"); c.Next() })
	r.GET("/late", func(c *gin.Context) { c.Status(200) })
	for _, tc := range []struct{ path, header string }{{"/early", ""}, {"/late", "yes"}} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest("GET", tc.path, nil))
		if rec.Code != 200 || rec.Header().Get("X-Registered") != tc.header {
			t.Fatalf("%s: %d %s", tc.path, rec.Code, rec.Header())
		}
	}
}

func TestMethodTreesAndRedirects(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.HandleMethodNotAllowed = true
	r.GET("/tasks/:id", func(c *gin.Context) { c.Header("X-Route", c.FullPath()); c.String(200, c.Param("id")) })
	r.POST("/tasks", func(c *gin.Context) { c.Status(201) })
	for _, tc := range []struct {
		name, method, path string
		status             int
		allow, location    string
	}{
		{"parameter", "GET", "/tasks/t1", 200, "", ""},
		{"missing", "GET", "/missing", 404, "", ""},
		{"method", "POST", "/tasks/t1", 405, "GET", ""},
		{"head-not-auto", "HEAD", "/tasks/t1", 405, "GET", ""},
		{"get-slash", "GET", "/tasks/t1/", 301, "", "/tasks/t1"},
		{"post-slash", "POST", "/tasks/", 307, "", "/tasks"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
			if rec.Code != tc.status || rec.Header().Get("Allow") != tc.allow || rec.Header().Get("Location") != tc.location {
				t.Fatalf("%d %v", rec.Code, rec.Header())
			}
			if tc.name == "parameter" && (rec.Body.String() != "t1" || rec.Header().Get("X-Route") != "/tasks/:id") {
				t.Fatal(rec.Body.String())
			}
		})
	}
}

func TestRecoveryOrderAndCommittedResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, committed := range []bool{false, true} {
		r := gin.New()
		var order []string
		r.Use(gin.RecoveryWithWriter(io.Discard))
		r.Use(func(c *gin.Context) {
			order = append(order, "before")
			defer func() { order = append(order, "defer") }()
			c.Next()
			order = append(order, "after")
		})
		r.GET("/", func(c *gin.Context) {
			if committed {
				c.String(202, "partial")
			}
			panic("controlled request failure")
		})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
		want := 500
		if committed {
			want = 202
		}
		if rec.Code != want || !reflect.DeepEqual(order, []string{"before", "defer"}) {
			t.Fatalf("%d %v", rec.Code, order)
		}
		if committed && rec.Body.String() != "partial" {
			t.Fatal(rec.Body.String())
		}
	}
}

func TestMultipartMemoryIsNotTotalLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", "note.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.WriteString(part, strings.Repeat("x", 128)); err != nil {
		t.Fatal(err)
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.MaxMultipartMemory = 1
	var diskBacked bool
	r.POST("/", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		defer func() {
			if c.Request.MultipartForm != nil {
				_ = c.Request.MultipartForm.RemoveAll()
			}
		}()
		header, err := c.FormFile("file")
		if err != nil {
			c.Status(400)
			return
		}
		f, err := header.Open()
		if err != nil {
			c.Status(500)
			return
		}
		defer f.Close()
		_, diskBacked = f.(*os.File)
		n, err := io.Copy(io.Discard, f)
		if err != nil || n != 128 {
			c.Status(500)
			return
		}
		c.Status(200)
	})
	req := httptest.NewRequest("POST", "/", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != 200 || !diskBacked {
		t.Fatalf("status=%d disk=%t", rec.Code, diskBacked)
	}
}
