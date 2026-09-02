// Credits: https://pkg.go.dev/github.com/rclone/rclone@v1.65.2/cmd/serve/s3
// Package s3 implements a fake s3 server for openlist
package s3

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
)

type keyIDCtx int

const keyIDKey keyIDCtx = iota

func contextWithKeyID(ctx context.Context, id uint) context.Context {
	return context.WithValue(ctx, keyIDKey, id)
}

// keyIDFromContext returns the authenticated key id (0 = none).
func keyIDFromContext(ctx context.Context) uint {
	if v, ok := ctx.Value(keyIDKey).(uint); ok {
		return v
	}
	return 0
}

// recordAudit queues an audit record for the request. Called after the
// response completes (or on early rejection).
func recordAudit(r *http.Request, accessKey string, status int, bytes int64, start time.Time) {
	bucket, object := "", ""
	if b, ok := bucketFromPath(r.URL.Path); ok {
		bucket = b
		object = strings.TrimPrefix(r.URL.Path, "/"+b)
		object = strings.TrimPrefix(object, "/")
	}
	action := r.Method
	// annotate the interesting sub-actions
	q := r.URL.Query()
	switch {
	case r.Method == http.MethodGet && q.Get("uploads") != "":
		action = "LIST_MULTIPART"
	case r.Method == http.MethodPost && q.Get("uploads") != "":
		action = "MPU_INIT"
	case r.Method == http.MethodPost && q.Get("uploadId") != "":
		action = "MPU_COMPLETE"
	case r.Method == http.MethodDelete && q.Get("uploadId") != "":
		action = "MPU_ABORT"
	case r.Method == http.MethodDelete && object != "" && strings.HasSuffix(r.URL.Path, "/"):
		action = "DELETE_PREFIX"
	}
	size := bytes
	if size == 0 && r.Method == http.MethodPut {
		if cl := r.ContentLength; cl > 0 {
			size = cl
		}
	}
	op.LogS3Audit(&model.S3AuditLog{
		AccessKey: accessKey,
		Action:    action,
		Bucket:    bucket,
		Object:    object,
		Status:    status,
		Size:      size,
		Duration:  time.Since(start).Milliseconds(),
		ClientIP:  clientIPFromRequest(r),
		CreatedAt: start,
	})
}
