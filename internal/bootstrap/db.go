package bootstrap

import (
	"fmt"
	stdlog "log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	log "github.com/sirupsen/logrus"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

// backupSQLite copies the database file before it gets opened, keeping
// the most recent N startup snapshots under data/backup/. Losing the
// settings/storages/shares to a corrupt WAL or a bad upgrade is the one
// unrecoverable failure mode of a self-hosted box, so pay a few MB.
func backupSQLite() {
	if flags.Dev {
		return
	}
	dbFile := conf.Conf.Database.DBFile
	if conf.Conf.Database.Type != "sqlite3" || dbFile == "" {
		return
	}
	if _, err := os.Stat(dbFile); err != nil {
		return // first boot — nothing to back up
	}
	backupDir := filepath.Join(filepath.Dir(dbFile), "backup")
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		log.Warnf("backup: failed to create dir: %v", err)
		return
	}
	dst := filepath.Join(backupDir, fmt.Sprintf("data-%s.db", time.Now().Format("20060102-150405")))
	data, err := os.ReadFile(dbFile)
	if err != nil {
		log.Warnf("backup: failed to read db: %v", err)
		return
	}
	if err := os.WriteFile(dst, data, 0o600); err != nil {
		log.Warnf("backup: failed to write: %v", err)
		return
	}
	// prune: keep the newest 7 snapshots
	entries, _ := filepath.Glob(filepath.Join(backupDir, "data-*.db"))
	if len(entries) > 7 {
		sort.Strings(entries)
		for _, old := range entries[:len(entries)-7] {
			_ = os.Remove(old)
		}
	}
	log.Infof("backup: database snapshot saved to %s", dst)
}

func InitDB() {
	backupSQLite()
	logLevel := logger.Silent
	if flags.Debug || flags.Dev {
		logLevel = logger.Info
	}
	newLogger := logger.New(
		stdlog.New(log.StandardLogger().Out, "\r\n", stdlog.LstdFlags),
		logger.Config{
			SlowThreshold:             time.Second,
			LogLevel:                  logLevel,
			IgnoreRecordNotFoundError: true,
			Colorful:                  true,
		},
	)
	gormConfig := &gorm.Config{
		NamingStrategy: schema.NamingStrategy{
			TablePrefix: conf.Conf.Database.TablePrefix,
		},
		Logger: newLogger,
	}
	var dB *gorm.DB
	var err error
	if flags.Dev {
		dB, err = gorm.Open(openSQLite("file::memory:?cache=shared"), gormConfig)
		conf.Conf.Database.Type = "sqlite3"
	} else {
		database := conf.Conf.Database
		switch database.Type {
		case "sqlite3":
			{
				if !(strings.HasSuffix(database.DBFile, ".db") && len(database.DBFile) > 3) {
					log.Fatalf("db name error.")
				}
				dB, err = gorm.Open(openSQLite(fmt.Sprintf("%s?_journal=WAL&_vacuum=incremental",
					database.DBFile)), gormConfig)
			}
		case "mysql":
			{
				dsn := database.DSN
				if dsn == "" {
					//[username[:password]@][protocol[(address)]]/dbname[?param1=value1&...&paramN=valueN]
					dsn = fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=True&loc=Local&tls=%s",
						database.User, database.Password, database.Host, database.Port, database.Name, database.SSLMode)
				}
				dB, err = gorm.Open(mysql.Open(dsn), gormConfig)
			}
		case "postgres":
			{
				dsn := database.DSN
				if dsn == "" {
					if database.Password != "" {
						dsn = fmt.Sprintf("host=%s user=%s password=%s dbname=%s port=%d sslmode=%s TimeZone=Asia/Shanghai",
							database.Host, database.User, database.Password, database.Name, database.Port, database.SSLMode)
					} else {
						dsn = fmt.Sprintf("host=%s user=%s dbname=%s port=%d sslmode=%s TimeZone=Asia/Shanghai",
							database.Host, database.User, database.Name, database.Port, database.SSLMode)
					}
				}
				dB, err = gorm.Open(postgres.Open(dsn), gormConfig)
			}
		default:
			log.Fatalf("not supported database type: %s", database.Type)
		}
	}
	if err != nil {
		log.Fatalf("failed to connect database:%s", err.Error())
	}
	db.Init(dB)
}
