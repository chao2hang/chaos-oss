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
var loginLimiter = &ipRateLimiter{
	visitors: map[string]*rate.Limiter{},
	lastSeen: map[string]time.Time{},
}

type ipRateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*rate.Limiter
	lastSeen map[string]time.Time
}

// LoginRateLimit allows 1 attempt/sec per IP with a burst of 5 — plenty
// for humans, hostile to online brute force.
func LoginRateLimit(c *gin.Context) {
	loginLimiter.mu.Lock()
	// prune entries idle for 10+ minutes
	now := time.Now()
	if len(loginLimiter.visitors) > 10000 {
		for ip, ts := range loginLimiter.lastSeen {
			if now.Sub(ts) > 10*time.Minute {
				delete(loginLimiter.visitors, ip)
				delete(loginLimiter.lastSeen, ip)
			}
		}
	}
	ip := c.ClientIP()
	lim, ok := loginLimiter.visitors[ip]
	if !ok {
		lim = rate.NewLimiter(rate.Every(time.Second), 5)
		loginLimiter.visitors[ip] = lim
	}
	loginLimiter.lastSeen[ip] = now
	loginLimiter.mu.Unlock()

	if !lim.Allow() {
		common.ErrorStrResp(c, "too many login attempts, please retry later", 429)
		c.Abort()
		return
	}
	c.Next()
}
