package db

import (
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/pkg/errors"
	"gorm.io/gorm"
)

func GetS3AccessKeys() ([]model.S3AccessKey, error) {
	var keys []model.S3AccessKey
	if err := db.Order("id").Find(&keys).Error; err != nil {
		return nil, errors.WithStack(err)
	}
	return keys, nil
}

func GetS3AccessKeyByID(id uint) (*model.S3AccessKey, error) {
	var key model.S3AccessKey
	if err := db.First(&key, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.WithStack(err)
		}
		return nil, errors.WithStack(err)
	}
	return &key, nil
}

func CreateS3AccessKey(key *model.S3AccessKey) error {
	return errors.WithStack(db.Create(key).Error)
}

func UpdateS3AccessKey(key *model.S3AccessKey) error {
	return errors.WithStack(db.Save(key).Error)
}

func DeleteS3AccessKey(id uint) error {
	return errors.WithStack(db.Delete(&model.S3AccessKey{}, id).Error)
}

func TouchS3AccessKey(id uint, t time.Time) error {
	return errors.WithStack(db.Model(&model.S3AccessKey{}).Where("id = ?", id).
		Update("last_used_time", t).Error)
}

func InsertS3AuditLogs(logs []*model.S3AuditLog) error {
	if len(logs) == 0 {
		return nil
	}
	return errors.WithStack(db.Create(&logs).Error)
}

func PurgeS3AuditBefore(t time.Time) error {
	return errors.WithStack(db.Where("created_at < ?", t).Delete(&model.S3AuditLog{}).Error)
}

func ListS3AuditLogs(page, perPage int, key, bucket, action string) ([]model.S3AuditLog, int64, error) {
	q := db.Model(&model.S3AuditLog{})
	if key != "" {
		q = q.Where("access_key = ?", key)
	}
	if bucket != "" {
		q = q.Where("bucket = ?", bucket)
	}
	if action != "" {
		q = q.Where("action = ?", action)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, errors.WithStack(err)
	}
	var logs []model.S3AuditLog
	if err := q.Order("id DESC").Offset((page - 1) * perPage).Limit(perPage).
		Find(&logs).Error; err != nil {
		return nil, 0, errors.WithStack(err)
	}
	return logs, total, nil
}
