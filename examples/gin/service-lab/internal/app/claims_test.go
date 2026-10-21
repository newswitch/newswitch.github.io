package app

import (
	"github.com/golang-jwt/jwt/v5"
	"net/http/httptest"
	"testing"
	"time"
)

func TestIssuerAudienceAndExpirationRequired(t *testing.T) {
	_, handler := setup(t)
	for _, name := range []string{"issuer", "audience", "expiration"} {
		t.Run(name, func(t *testing.T) {
			claims := Claims{Tenant: "alpha", Scope: "task:read", RegisteredClaims: jwt.RegisteredClaims{Subject: "user", Issuer: "gin-lab", Audience: jwt.ClaimStrings{"task-api"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute))}}
			switch name {
			case "issuer":
				claims.Issuer = "untrusted"
			case "audience":
				claims.Audience = jwt.ClaimStrings{"another-service"}
			case "expiration":
				claims.ExpiresAt = nil
			}
			token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(testKey)
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("GET", "/api/me", nil)
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != 401 {
				t.Fatal(response.Code)
			}
		})
	}
}
