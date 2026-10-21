package app

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"net/http"
	"strings"
	"time"
)

type Claims struct {
	Tenant string `json:"tenant"`
	Scope  string `json:"scope"`
	jwt.RegisteredClaims
}

func Token(key []byte, tenant, scope string, expires time.Time) (string, error) {
	claims := Claims{Tenant: tenant, Scope: scope, RegisteredClaims: jwt.RegisteredClaims{Issuer: "gin-lab", Subject: "lab-user", Audience: jwt.ClaimStrings{"task-api"}, ExpiresAt: jwt.NewNumericDate(expires), IssuedAt: jwt.NewNumericDate(time.Now().Add(-time.Second))}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(key)
}
func authenticate(key []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		authorization := c.GetHeader("Authorization")
		if !strings.HasPrefix(authorization, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "bearer required"})
			return
		}
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(strings.TrimPrefix(authorization, "Bearer "), claims, func(t *jwt.Token) (any, error) { return key, nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer("gin-lab"), jwt.WithAudience("task-api"), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithLeeway(5*time.Second))
		if err != nil || !token.Valid || claims.Subject == "" || claims.Tenant == "" || len(claims.Tenant) > 40 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid bearer"})
			return
		}
		c.Set("identity", claims)
		c.Next()
	}
}
func require(scope string) gin.HandlerFunc {
	return func(c *gin.Context) {
		value, ok := c.Get("identity")
		if !ok {
			c.AbortWithStatus(401)
			return
		}
		claims := value.(*Claims)
		for _, candidate := range strings.Fields(claims.Scope) {
			if candidate == scope {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(403, gin.H{"error": "scope required"})
	}
}
func tenant(c *gin.Context) string { return c.MustGet("identity").(*Claims).Tenant }
func validateKey(key []byte) error {
	if len(key) < 32 {
		return fmt.Errorf("JWT key must contain at least 32 bytes")
	}
	return nil
}
