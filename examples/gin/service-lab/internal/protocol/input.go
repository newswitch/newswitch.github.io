package protocol

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

const BodyLimit = 64

type Input struct {
	Name  string `json:"name" binding:"required,max=20"`
	Count *int   `json:"count" binding:"required,min=0,max=10"`
}

// ReadInput is a small JSON-only contract, independent of taskd's 400 policy.
// The caller owns the response. The HTTP server owns closing Request.Body.
func ReadInput(c *gin.Context) (*Input, int) {
	media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || media != "application/json" {
		return nil, http.StatusUnsupportedMediaType
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, BodyLimit)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	var input *Input
	if err = d.Decode(&input); err != nil {
		return nil, inputStatus(err)
	}
	var extra any
	if err = d.Decode(&extra); err != io.EOF {
		if err == nil {
			return nil, http.StatusBadRequest
		}
		return nil, inputStatus(err)
	}
	if input == nil || binding.Validator.ValidateStruct(input) != nil || strings.TrimSpace(input.Name) == "" {
		return nil, http.StatusBadRequest
	}
	return input, 0
}

func inputStatus(err error) int {
	var large *http.MaxBytesError
	if errors.As(err, &large) {
		return http.StatusRequestEntityTooLarge
	}
	return http.StatusBadRequest
}

func Handler(c *gin.Context) {
	input, status := ReadInput(c)
	if status != 0 {
		c.JSON(status, gin.H{"error": "invalid_input"})
		return
	}
	c.JSON(http.StatusCreated, input)
}
