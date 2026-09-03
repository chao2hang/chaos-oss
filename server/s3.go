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
	// The explicit flag remains supported for legacy deployments.
	h, _ := s3.NewServer(context.Background())
	wrapped := gin.WrapH(h)

	g.Any("/*path", func(c *gin.Context) {
		if !s3.HasConfiguredBuckets() {
			common.ErrorStrResp(c, "S3 server is not enabled; configure an S3 bucket first", 403)
			return
		}
		// A valid bucket always uses the main service port. A standalone port is
		// only selected by the legacy standalone server below.
		adjustedPath := strings.TrimPrefix(c.Request.URL.Path, path.Join(conf.URL.Path, "/s3"))
		c.Request.URL.Path = adjustedPath
		wrapped(c)
	})
}

func S3Server(g *gin.RouterGroup) {
	h, _ := s3.NewServer(context.Background())
	g.Any("/*path", gin.WrapH(h))
}
