package server

import (
	"context"
	"path"
	"strings"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/OpenListTeam/OpenList/v4/server/s3"
	"github.com/gin-gonic/gin"
)

func S3(g *gin.RouterGroup) {
	// Bucket configuration is the activation switch for the shared endpoint.
	// The standalone-port server below is gated separately by the explicit
	// s3.enable / s3.port config and serves the same buckets at the root.
	h, _ := s3.NewServer(context.Background())
	wrapped := gin.WrapH(h)

	g.Any("/*path", func(c *gin.Context) {
		if !s3.HasConfiguredBuckets() {
			common.ErrorStrResp(c, "S3 server is not enabled; configure an S3 bucket first", 403)
			return
		}
		// The shared-port gateway is mounted under /s3: requests carry the
		// prefix on the wire, but SigV4 is verified against the stripped
		// bucket path. Standard clients that sign the full request path
		// should use the standalone port (S3Server below) instead.
		adjustedPath := strings.TrimPrefix(c.Request.URL.Path, path.Join(conf.URL.Path, "/s3"))
		c.Request.URL.Path = adjustedPath
		wrapped(c)
	})
}

func S3Server(g *gin.RouterGroup) {
	h, _ := s3.NewServer(context.Background())
	g.Any("/*path", gin.WrapH(h))
}
