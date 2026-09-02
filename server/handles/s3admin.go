package handles

import (
	"crypto/rand"
	"math/big"
	"strconv"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/OpenListTeam/OpenList/v4/server/s3"
	"github.com/gin-gonic/gin"
)

const keyChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

func randomKeyString(n int) string {
	out := make([]byte, n)
	for i := range out {
		v, _ := rand.Int(rand.Reader, big.NewInt(int64(len(keyChars))))
		out[i] = keyChars[v.Int64()]
	}
	return string(out)
}

type s3KeyReq struct {
	AccessKey   string `json:"access_key"`
	SecretKey   string `json:"secret_key"`
	Buckets     string `json:"buckets"`
	ReadOnly    bool   `json:"read_only"`
	Enabled     *bool  `json:"enabled"`
	IPAllowlist string `json:"ip_allowlist"`
	Remark      string `json:"remark"`
}

// ListS3Keys returns all S3 access keys.
func ListS3Keys(c *gin.Context) {
	keys, err := op.GetS3AccessKeys()
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	common.SuccessResp(c, keys)
}

// CreateS3Key adds an access key. If access_key/secret_key are omitted,
// random values are generated.
func CreateS3Key(c *gin.Context) {
	var req s3KeyReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if req.AccessKey == "" {
		req.AccessKey = "chaos" + randomKeyString(20)
	}
	if req.SecretKey == "" {
		req.SecretKey = randomKeyString(40)
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	key := &model.S3AccessKey{
		AccessKey:   req.AccessKey,
		SecretKey:   req.SecretKey,
		Buckets:     req.Buckets,
		ReadOnly:    req.ReadOnly,
		Enabled:     enabled,
		IPAllowlist: req.IPAllowlist,
		Remark:      req.Remark,
		CreatedTime: time.Now(),
	}
	if err := op.CreateS3AccessKey(key); err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	s3.RefreshS3Keys()
	// return the generated secret once so the admin can copy it
	common.SuccessResp(c, gin.H{
		"key":        key,
		"secret_key": req.SecretKey,
	})
}

// UpdateS3Key modifies an access key (permissions / enable / remark).
// An empty secret_key keeps the stored one.
func UpdateS3Key(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	var req s3KeyReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	key, err := op.GetS3AccessKeyByID(uint(id))
	if err != nil {
		common.ErrorResp(c, err, 404)
		return
	}
	key.Buckets = req.Buckets
	key.ReadOnly = req.ReadOnly
	key.IPAllowlist = req.IPAllowlist
	key.Remark = req.Remark
	if req.Enabled != nil {
		key.Enabled = *req.Enabled
	}
	if req.SecretKey != "" {
		key.SecretKey = req.SecretKey
	}
	if err := op.UpdateS3AccessKey(key); err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	s3.RefreshS3Keys()
	common.SuccessResp(c)
}

// DeleteS3Key removes an access key.
func DeleteS3Key(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if err := op.DeleteS3AccessKey(uint(id)); err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	s3.RefreshS3Keys()
	common.SuccessResp(c)
}

// ListS3Audit returns a page of S3 audit records.
// GET /api/admin/s3audit/list?page=1&per_page=20&key=&bucket=&action=
func ListS3Audit(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "20"))
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	logs, total, err := op.ListS3AuditLogs(page, perPage,
		c.Query("key"), c.Query("bucket"), c.Query("action"))
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	common.SuccessResp(c, gin.H{"content": logs, "total": total})
}

// S3Stats returns gateway counters for the dashboard.
func S3Stats(c *gin.Context) {
	common.SuccessResp(c, s3.Stats())
}

// S3Metrics serves the Prometheus exposition format (admin only).
func S3Metrics(c *gin.Context) {
	s3.MetricsHandler().ServeHTTP(c.Writer, c.Request)
}
