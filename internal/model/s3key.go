package model

import "time"

// S3 access key for the S3 gateway. Each key can be scoped to specific
// buckets (empty = all buckets) and to read-only access.
type S3AccessKey struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	AccessKey string    `json:"access_key" gorm:"uniqueIndex;size:64"`
	SecretKey string    `json:"-" gorm:"size:128"`
	// Buckets is a comma-separated bucket-name list; empty means all.
	Buckets string `json:"buckets" gorm:"size:1024"`
	// ReadOnly: when true the key may not PUT/DELETE/COPY.
	ReadOnly bool      `json:"read_only"`
	Enabled  bool      `json:"enabled"`
	// IPAllowlist is a comma-separated CIDR / plain-IP list; empty = any.
	IPAllowlist string    `json:"ip_allowlist" gorm:"size:1024"`
	Remark      string    `json:"remark" gorm:"size:256"`
	CreatedTime time.Time `json:"created_time"`
	LastUsed    time.Time `json:"last_used_time" gorm:"index"`
}

func (k *S3AccessKey) BucketList() []string {
	if k.Buckets == "" {
		return nil
	}
	var out []string
	start := 0
	for i := 0; i <= len(k.Buckets); i++ {
		if i == len(k.Buckets) || k.Buckets[i] == ',' {
			s := k.Buckets[start:i]
			if s != "" {
				out = append(out, s)
			}
			start = i + 1
		}
	}
	return out
}

// AllowsBucket reports whether the key may access the given bucket.
func (k *S3AccessKey) AllowsBucket(bucket string) bool {
	list := k.BucketList()
	if len(list) == 0 {
		return true
	}
	for _, b := range list {
		if b == bucket {
			return true
		}
	}
	return false
}

// S3AuditLog is one record of an S3 gateway request.
type S3AuditLog struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	AccessKey string    `json:"access_key" gorm:"size:64;index"`
	Action    string    `json:"action" gorm:"size:16;index"` // GET / PUT / DELETE / HEAD / LIST / POST …
	Bucket    string    `json:"bucket" gorm:"size:255;index"`
	Object    string    `json:"object" gorm:"size:1024"`
	Status    int       `json:"status"`
	Size      int64     `json:"size"` // bytes transferred (best effort)
	Duration  int64     `json:"duration"` // milliseconds
	ClientIP  string    `json:"client_ip" gorm:"size:64"`
	CreatedAt time.Time `json:"created_at" gorm:"index`
}
