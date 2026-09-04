package middlewares

import (
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// loginRateLimiter throttles login attempts per client IP to blunt
// credential brute-forcing. Visitors get a small burst allowance and a
// steady refill; the counter map is pruned periodically.
var loginLimiter = newIPRateLimiter()
var refreshLimiter = newIPRateLimiter()
var webauthnLoginLimiter = newIPRateLimiter()

func newIPRateLimiter() *ipRateLimiter {
	return &ipRateLimiter{
		visitors: map[string]*rate.Limiter{},
		lastSeen: map[string]time.Time{},
	}
}

type ipRateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*rate.Limiter
	lastSeen map[string]time.Time
}

// ipRateLimit allows a bounded burst and then one request per second per IP.
func ipRateLimit(limiter *ipRateLimiter, message string, burst int) gin.HandlerFunc {
	return func(c *gin.Context) {
		limiter.mu.Lock()
		now := time.Now()
		if len(limiter.visitors) > 10000 {
			for ip, ts := range limiter.lastSeen {
				if now.Sub(ts) > 10*time.Minute {
					delete(limiter.visitors, ip)
					delete(limiter.lastSeen, ip)
				}
			}
		}
		ip := c.ClientIP()
		lim, ok := limiter.visitors[ip]
		if !ok {
			lim = rate.NewLimiter(rate.Every(time.Second), burst)
			limiter.visitors[ip] = lim
		}
		limiter.lastSeen[ip] = now
		limiter.mu.Unlock()

		if !lim.Allow() {
			c.Header("Retry-After", "1")
			common.ErrorStrResp(c, message, 429)
			c.Abort()
			return
		}
		c.Next()
	}
}

// LoginRateLimit allows 1 attempt/sec per IP with a burst of 5.
func LoginRateLimit(c *gin.Context) {
	ipRateLimit(loginLimiter, "too many login attempts, please retry later", 5)(c)
}

// RefreshRateLimit protects refresh-token rotation from request floods.
func RefreshRateLimit(c *gin.Context) {
	ipRateLimit(refreshLimiter, "too many refresh attempts, please retry later", 5)(c)
}

// WebAuthnLoginRateLimit protects the unauthenticated WebAuthn ceremony.
func WebAuthnLoginRateLimit(c *gin.Context) {
	ipRateLimit(webauthnLoginLimiter, "too many WebAuthn login attempts, please retry later", 5)(c)
}
