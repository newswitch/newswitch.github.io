package keyauth

import (
	"crypto/rsa"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"math/big"
	"strings"
	"sync/atomic"
	"time"
)

type snapshot struct{ keys map[string]*rsa.PublicKey }
type Verifier struct {
	current          atomic.Pointer[snapshot]
	issuer, audience string
	now              func() time.Time
}

func New(issuer, audience string, now func() time.Time) (*Verifier, error) {
	if issuer == "" || audience == "" || now == nil {
		return nil, fmt.Errorf("identity configuration required")
	}
	return &Verifier{issuer: issuer, audience: audience, now: now}, nil
}

// Replace publishes a completely validated immutable key set. The caller cannot
// mutate the stored big.Int through the original public key pointer.
func (v *Verifier) Replace(keys map[string]*rsa.PublicKey) error {
	if len(keys) < 1 || len(keys) > 16 {
		return fmt.Errorf("key set must contain 1..16 keys")
	}
	next := &snapshot{keys: make(map[string]*rsa.PublicKey, len(keys))}
	for id, key := range keys {
		if id == "" || len(id) > 64 || key == nil || key.N == nil || key.N.BitLen() < 2048 || key.E < 3 || key.E%2 == 0 {
			return fmt.Errorf("invalid trusted RSA key")
		}
		next.keys[id] = &rsa.PublicKey{N: new(big.Int).Set(key.N), E: key.E}
	}
	v.current.Store(next)
	return nil
}
func (v *Verifier) Verify(encoded string) (*jwt.RegisteredClaims, error) {
	if len(encoded) > 8192 {
		return nil, fmt.Errorf("credential too large")
	}
	keys := v.current.Load()
	if keys == nil {
		return nil, fmt.Errorf("no trusted keys")
	}
	claims := &jwt.RegisteredClaims{}
	token, err := jwt.ParseWithClaims(encoded, claims, func(token *jwt.Token) (any, error) {
		id, ok := token.Header["kid"].(string)
		if !ok || len(id) > 64 {
			return nil, fmt.Errorf("kid required")
		}
		key, ok := keys.keys[id]
		if !ok {
			return nil, fmt.Errorf("untrusted kid")
		}
		return key, nil
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(v.issuer), jwt.WithAudience(v.audience), jwt.WithExpirationRequired(), jwt.WithIssuedAt(), jwt.WithTimeFunc(v.now), jwt.WithLeeway(5*time.Second))
	if err != nil {
		return nil, err
	}
	if !token.Valid || claims.Subject == "" {
		return nil, fmt.Errorf("invalid subject")
	}
	return claims, nil
}
func (v *Verifier) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			c.AbortWithStatus(401)
			return
		}
		claims, err := v.Verify(strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			c.AbortWithStatus(401)
			return
		}
		c.Set("subject", claims.Subject)
		c.Next()
	}
}

// Sign belongs to the issuer, not the API verifier. No private key is stored in Verifier.
func Sign(key *rsa.PrivateKey, kid, issuer, audience, subject string, now time.Time, ttl time.Duration) (string, error) {
	if key == nil || key.N == nil || key.N.BitLen() < 2048 || kid == "" || len(kid) > 64 || issuer == "" || audience == "" || subject == "" || ttl <= 0 || ttl > time.Hour {
		return "", fmt.Errorf("invalid signing configuration")
	}
	if err := key.Validate(); err != nil {
		return "", fmt.Errorf("invalid issuer private key")
	}
	claims := jwt.RegisteredClaims{Issuer: issuer, Audience: jwt.ClaimStrings{audience}, Subject: subject, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(ttl))}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = kid
	return token.SignedString(key)
}
