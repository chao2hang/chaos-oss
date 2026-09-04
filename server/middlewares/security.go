package middlewares

import "github.com/gin-gonic/gin"

// SecurityHeaders adds conservative response headers to every main-router
// response. HSTS is deliberately sent only when the request itself used TLS;
// forwarded protocol headers are not sufficient to establish that guarantee.
func SecurityHeaders(c *gin.Context) {
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("X-Frame-Options", "SAMEORIGIN")
	c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
	c.Header("Permissions-Policy", "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()")
	if c.Request.TLS != nil {
		c.Header("Strict-Transport-Security", "max-age=31536000")
	}
	c.Next()
}
