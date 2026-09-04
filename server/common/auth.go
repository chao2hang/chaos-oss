package common

import (
	"crypto/rand"
	"encoding/hex"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/go-cache"
	"github.com/golang-jwt/jwt/v4"
	"github.com/pkg/errors"
)

var SecretKey []byte

// Token type claim values. Access tokens authenticate API calls; refresh
// tokens are only accepted by POST /api/auth/refresh.
const (
	TokenTypeAccess  = "access"
	TokenTypeRefresh = "refresh"
	// RefreshTokenTTL is how long a refresh token stays valid.
	RefreshTokenTTL = 30 * 24 * time.Hour
)

type UserClaims struct {
	Username string `json:"username"`
	PwdTS    int64  `json:"pwd_ts"`
	// Typ distinguishes access tokens from refresh tokens. Empty means a
	// legacy access token issued before this field existed.
	Typ string `json:"typ,omitempty"`
	jwt.RegisteredClaims
}

var validTokenCache = cache.NewMemCache[bool]()

// newJTI returns a random unique token ID. JWTs issued within the same
// second would otherwise be byte-identical (same claims → same
// signature), which breaks rotation: invalidating the old token would
// also invalidate the new one. The jti makes every issuance unique.
func newJTI() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// Extremely unlikely; fall back to a timestamp-derived value.
		return time.Now().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(b)
}

func GenerateToken(user *model.User) (tokenString string, err error) {
	claim := UserClaims{
		Username: user.Username,
		PwdTS:    user.PwdTS,
		Typ:      TokenTypeAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        newJTI(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(conf.Conf.TokenExpiresIn) * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		}}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claim)
	tokenString, err = token.SignedString(SecretKey)
	if err != nil {
		return "", err
	}
	validTokenCache.Set(tokenString, true, cache.WithExAt[bool](claim.ExpiresAt.Time))
	return tokenString, err
}

// GenerateRefreshToken issues a long-lived refresh token for the user.
// Refresh tokens cannot call the regular API — the auth middleware
// rejects them; they are only exchangeable at /api/auth/refresh.
func GenerateRefreshToken(user *model.User) (tokenString string, err error) {
	claim := UserClaims{
		Username: user.Username,
		PwdTS:    user.PwdTS,
		Typ:      TokenTypeRefresh,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        newJTI(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(RefreshTokenTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		}}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claim)
	tokenString, err = token.SignedString(SecretKey)
	if err != nil {
		return "", err
	}
	validTokenCache.Set(tokenString, true, cache.WithExAt[bool](claim.ExpiresAt.Time))
	return tokenString, err
}

// AccessTokenTTL returns the configured access-token lifetime in seconds
// so the login/refresh responses can tell clients when to renew.
func AccessTokenTTL() int64 {
	return int64(time.Duration(conf.Conf.TokenExpiresIn) * time.Hour / time.Second)
}

func ParseToken(tokenString string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &UserClaims{}, func(token *jwt.Token) (interface{}, error) {
		return SecretKey, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		if ve, ok := err.(*jwt.ValidationError); ok {
			if ve.Errors&jwt.ValidationErrorMalformed != 0 {
				return nil, errors.New("that's not even a token")
			} else if ve.Errors&jwt.ValidationErrorExpired != 0 {
				return nil, errors.New("token is expired")
			} else if ve.Errors&jwt.ValidationErrorNotValidYet != 0 {
				return nil, errors.New("token not active yet")
			}
		}
		return nil, errors.New("couldn't handle this token")
	}
	if IsTokenInvalidated(tokenString) {
		return nil, errors.New("token is invalidated")
	}
	if claims, ok := token.Claims.(*UserClaims); ok && token.Valid {
		// A refresh token must never authenticate a regular API call.
		if claims.Typ == TokenTypeRefresh {
			return nil, errors.New("refresh token cannot be used for API access")
		}
		return claims, nil
	}
	return nil, errors.New("couldn't handle this token")
}

// ParseRefreshToken validates a token and requires it to be a refresh
// token. Used by the /api/auth/refresh endpoint only.
func ParseRefreshToken(tokenString string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &UserClaims{}, func(token *jwt.Token) (interface{}, error) {
		return SecretKey, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	if err != nil {
		return nil, errors.New("refresh token is invalid or expired")
	}
	if IsTokenInvalidated(tokenString) {
		return nil, errors.New("refresh token is invalidated")
	}
	claims, ok := token.Claims.(*UserClaims)
	if !ok || !token.Valid {
		return nil, errors.New("couldn't handle this token")
	}
	if claims.Typ != TokenTypeRefresh {
		return nil, errors.New("not a refresh token")
	}
	return claims, nil
}

func InvalidateToken(tokenString string) error {
	if tokenString == "" {
		return nil // don't invalidate empty guest token
	}
	validTokenCache.Del(tokenString)
	return nil
}

func IsTokenInvalidated(tokenString string) bool {
	_, ok := validTokenCache.Get(tokenString)
	return !ok
}
