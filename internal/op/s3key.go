package op

import (
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	log "github.com/sirupsen/logrus"
	
)

var s3KeyMu sync.Mutex

// GetS3AccessKeys returns all S3 access keys.
func GetS3AccessKeys() ([]model.S3AccessKey, error) {
	return db.GetS3AccessKeys()
}

// GetS3AccessKeyByID returns one key by primary key.
func GetS3AccessKeyByID(id uint) (*model.S3AccessKey, error) {
	return db.GetS3AccessKeyByID(id)
}

// CreateS3AccessKey inserts a new key.
func CreateS3AccessKey(key *model.S3AccessKey) error {
	s3KeyMu.Lock()
	defer s3KeyMu.Unlock()
	key.AccessKey = strings.TrimSpace(key.AccessKey)
	key.CreatedTime = time.Now()
	return db.CreateS3AccessKey(key)
}

// UpdateS3AccessKey saves changes to an existing key.
func UpdateS3AccessKey(key *model.S3AccessKey) error {
	s3KeyMu.Lock()
	defer s3KeyMu.Unlock()
	return db.UpdateS3AccessKey(key)
}

// DeleteS3AccessKey removes a key by id.
func DeleteS3AccessKey(id uint) error {
	s3KeyMu.Lock()
	defer s3KeyMu.Unlock()
	return db.DeleteS3AccessKey(id)
}

// touchAt throttles last-used updates: one DB write per key per minute
// so a busy gateway does not flood the database.
var touchAt sync.Map // map[uint]time.Time

// TouchS3AccessKey updates last-used time (best effort, throttled to
// one write per key per minute).
func TouchS3AccessKey(id uint) {
	now := time.Now()
	if v, ok := touchAt.Load(id); ok && now.Sub(v.(time.Time)) < time.Minute {
		return
	}
	touchAt.Store(id, now)
	s3KeyMu.Lock()
	defer s3KeyMu.Unlock()
	_ = db.TouchS3AccessKey(id, now)
}

// ---------------------------- audit ----------------------------

// S3AuditRetentionDays: audit records older than this are purged.
const S3AuditRetentionDays = 90

var auditQueue = make(chan *model.S3AuditLog, 1024)
var auditOnce sync.Once

// LogS3Audit queues an audit record for asynchronous persistence.
// Never blocks the request path: a full queue drops the record.
func LogS3Audit(rec *model.S3AuditLog) {
	select {
	case auditQueue <- rec:
	default:
	}
}

// StartS3AuditWorker drains the audit queue into the database and
// periodically purges expired records. It is started once at boot.
func StartS3AuditWorker(stop <-chan struct{}) {
	auditOnce.Do(func() {
		go func() {
			batch := make([]*model.S3AuditLog, 0, 64)
			// flush pending records every 2s so the audit page stays fresh;
			// purge expired records once a day
			flushTicker := time.NewTicker(2 * time.Second)
			purgeTicker := time.NewTicker(24 * time.Hour)
			defer flushTicker.Stop()
			defer purgeTicker.Stop()
			for {
				select {
				case rec := <-auditQueue:
					batch = append(batch, rec)
					if len(batch) >= 64 {
						flushAuditBatch(batch)
						batch = batch[:0]
					}
				case <-flushTicker.C:
					if len(batch) > 0 {
						flushAuditBatch(batch)
						batch = batch[:0]
					}
				case <-purgeTicker.C:
					_ = db.PurgeS3AuditBefore(time.Now().AddDate(0, 0, -S3AuditRetentionDays))
				case <-stop:
					if len(batch) > 0 {
						flushAuditBatch(batch)
					}
					return
				}
			}
		}()
	})
}

func flushAuditBatch(batch []*model.S3AuditLog) {
	if err := db.InsertS3AuditLogs(batch); err != nil {
		log.Errorf("failed to persist %d s3 audit records: %+v", len(batch), err)
	}
}

// ListS3AuditLogs returns a page of audit records, newest first.
func ListS3AuditLogs(page, perPage int, key, bucket, action string) ([]model.S3AuditLog, int64, error) {
	return db.ListS3AuditLogs(page, perPage, key, bucket, action)
}

// S3AuditQueueLen reports the pending audit queue length (observability).
func S3AuditQueueLen() int {
	return len(auditQueue)
}
