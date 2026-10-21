package keyauth

import (
	"crypto/rand"
	"crypto/rsa"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRotationOverlapExpiryAndRetirement(t *testing.T) {
	old, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	next, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1800000000, 0)
	v, _ := New("lab-issuer", "task-api", func() time.Time { return now })
	if err = v.Replace(map[string]*rsa.PublicKey{"old": &old.PublicKey}); err != nil {
		t.Fatal(err)
	}
	a, _ := Sign(old, "old", "lab-issuer", "task-api", "user", now, time.Minute)
	longLived, _ := Sign(old, "old", "lab-issuer", "task-api", "user", now, 5*time.Minute)
	if _, err = v.Verify(a); err != nil {
		t.Fatal(err)
	}
	if err = v.Replace(map[string]*rsa.PublicKey{"old": &old.PublicKey, "next": &next.PublicKey}); err != nil {
		t.Fatal(err)
	}
	b, _ := Sign(next, "next", "lab-issuer", "task-api", "user", now, time.Minute)
	if _, err = v.Verify(a); err != nil {
		t.Fatal(err)
	}
	if _, err = v.Verify(b); err != nil {
		t.Fatal(err)
	}
	now = now.Add(66 * time.Second)
	if _, err = v.Verify(a); err == nil {
		t.Fatal("expired credential accepted")
	}
	if _, err = v.Verify(longLived); err != nil {
		t.Fatal("long-lived old token should still be valid before retirement", err)
	}
	if err = v.Replace(map[string]*rsa.PublicKey{"next": &next.PublicKey}); err != nil {
		t.Fatal(err)
	}
	if _, err = v.Verify(longLived); err == nil {
		t.Fatal("retired kid accepted")
	}
	fresh, _ := Sign(next, "next", "lab-issuer", "task-api", "user", now, time.Minute)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(v.Middleware())
	router.GET("/me", func(c *gin.Context) { c.String(200, c.GetString("subject")) })
	request := httptest.NewRequest("GET", "/me", nil)
	request.Header.Set("Authorization", "Bearer "+fresh)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 200 || response.Body.String() != "user" {
		t.Fatal(response.Code, response.Body.String())
	}
	t.Log("overlap=old+next expired=rejected retired=rejected new-request=200")
}
func TestRejectedReplacementPreservesTrustedSnapshot(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	v, _ := New("issuer", "api", time.Now)
	if err = v.Replace(map[string]*rsa.PublicKey{"one": &key.PublicKey}); err != nil {
		t.Fatal(err)
	}
	if err = v.Replace(map[string]*rsa.PublicKey{"bad": nil}); err == nil {
		t.Fatal("invalid replacement accepted")
	}
	token, _ := Sign(key, "one", "issuer", "api", "user", now, time.Minute)
	if _, err = v.Verify(token); err != nil {
		t.Fatal(err)
	}
	t.Log("invalid-update=rejected previous-trust=preserved")
}
