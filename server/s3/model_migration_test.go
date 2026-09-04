// Package s3 implements a fake s3 server for openlist
package s3

import (
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
)

// TestS3AuditLogMigration verifies that the S3AuditLog model migrates
// cleanly (valid struct tags) and that records round-trip through the
// database, including the indexed created_at column.
func TestS3AuditLogMigration(t *testing.T) {
	rec := &model.S3AuditLog{
		AccessKey: "AKTEST",
		Action:    "GET",
		Bucket:    "bucket",
		Object:    "object",
		Status:    200,
		Size:      42,
		Duration:  3,
		ClientIP:  "127.0.0.1",
		CreatedAt: time.Now().Truncate(time.Second),
	}
	if err := db.GetDb().Create(rec).Error; err != nil {
		t.Fatalf("failed to insert S3AuditLog: %+v", err)
	}
	if rec.ID == 0 {
		t.Fatal("expected non-zero ID after insert")
	}

	var got model.S3AuditLog
	if err := db.GetDb().Where("access_key = ?", "AKTEST").First(&got).Error; err != nil {
		t.Fatalf("failed to query S3AuditLog: %+v", err)
	}
	if got.Action != "GET" || got.Bucket != "bucket" || got.Object != "object" ||
		got.Status != 200 || got.Size != 42 || got.ClientIP != "127.0.0.1" {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
	if !got.CreatedAt.Equal(rec.CreatedAt) {
		t.Fatalf("created_at mismatch: got %v, want %v", got.CreatedAt, rec.CreatedAt)
	}

	// clean up so reruns stay deterministic
	db.GetDb().Delete(&model.S3AuditLog{}, rec.ID)
}

// TestS3AccessKeyModelMigration verifies the access key model
// round-trips, covering its gorm tags.
func TestS3AccessKeyModelMigration(t *testing.T) {
	k := &model.S3AccessKey{
		AccessKey:   "AKMIG",
		SecretKey:   "sk",
		Buckets:     "a,b",
		ReadOnly:    true,
		Enabled:     true,
		IPAllowlist: "10.0.0.0/8",
		Remark:      "test",
		CreatedTime: time.Now(),
	}
	if err := db.GetDb().Create(k).Error; err != nil {
		t.Fatalf("failed to insert S3AccessKey: %+v", err)
	}
	if k.ID == 0 {
		t.Fatal("expected non-zero ID after insert")
	}
	if list := k.BucketList(); len(list) != 2 || list[0] != "a" || list[1] != "b" {
		t.Fatalf("unexpected bucket list: %v", list)
	}
	db.GetDb().Delete(&model.S3AccessKey{}, k.ID)
}
