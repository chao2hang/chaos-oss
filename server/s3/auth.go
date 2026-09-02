// Credits: https://pkg.go.dev/github.com/rclone/rclone@v1.65.2/cmd/serve/s3
// Package s3 implements a fake s3 server for openlist
package s3

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	log "github.com/sirupsen/logrus"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/itsHenry35/gofakes3/signature"
)

// s3KeyStore keeps the S3 access keys loaded from the database, mirrors
// them into the gofakes3 signature credential store, and answers
// per-request permission questions (enabled / IP allowlist / bucket
// scope / read-only).
var s3KeyStore = &keyStore{}

type keyStore struct {
	mu   sync.RWMutex
	keys map[string]*model.S3AccessKey // by access key id
}

// loadS3Keys (re)loads keys from the database and syncs the signature
// credential store. Callers must hold no locks.
func (ks *keyStore) load() {
	keys, err := op.GetS3AccessKeys()
	if err != nil {
		log.Errorf("s3: failed to load access keys: %+v", err)
		return
	}
	m := make(map[string]*model.S3AccessKey, len(keys))
	pairs := make(map[string]string, len(keys))
	for i := range keys {
		k := &keys[i]
		if !k.Enabled {
			continue
		}
		m[k.AccessKey] = k
		pairs[k.AccessKey] = k.SecretKey
	}
	ks.mu.Lock()
	ks.keys = m
	ks.mu.Unlock()
	signature.StoreKeys(pairs)
}

// lookup resolves an access key id to its record.
func (ks *keyStore) lookup(accessKey string) (*model.S3AccessKey, bool) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()
	k, ok := ks.keys[accessKey]
	return k, ok
}

func (ks *keyStore) size() int {
	ks.mu.RLock()
	defer ks.mu.RUnlock()
	return len(ks.keys)
}

// RefreshS3Keys reloads the key store (called after admin mutations).
func RefreshS3Keys() {
	s3KeyStore.load()
}

// seedLegacyKey imports the single-key pair from settings into the key
// table the first time the S3 key store runs, so existing clients keep
// authenticating unchanged.
func seedLegacyKey() {
	keys, err := op.GetS3AccessKeys()
	if err != nil {
		log.Errorf("s3: failed to check existing keys: %+v", err)
		return
	}
	if len(keys) > 0 {
		return
	}
	ak := setting.GetStr(conf.S3AccessKeyId)
	sk := setting.GetStr(conf.S3SecretAccessKey)
	if ak == "" || sk == "" {
		return
	}
	err = op.CreateS3AccessKey(&model.S3AccessKey{
		AccessKey:   ak,
		SecretKey:   sk,
		Enabled:     true,
		Remark:      "默认密钥（由设置迁移）",
		CreatedTime: time.Now(),
	})
	if err != nil {
		log.Errorf("s3: failed to seed legacy key: %+v", err)
		return
	}
	log.Infof("s3: imported legacy setting key %q as the first access key", ak)
}

// InitS3Keys seeds and loads the key store; start the refresher.
func InitS3Keys(stop <-chan struct{}) {
	seedLegacyKey()
	s3KeyStore.load()
	go func() {
		t := time.NewTicker(60 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				s3KeyStore.load()
			case <-stop:
				return
			}
		}
	}()
}

// accessKeyFromRequest extracts the access key id from the V4/V2
// Authorization header or presigned query string.
func accessKeyFromRequest(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth != "" {
		// AWS4-HMAC-SHA256 Credential=AKID/date/..., SignedHeaders=...
		if i := strings.Index(auth, "Credential="); i >= 0 {
			rest := auth[i+len("Credential="):]
			if j := strings.IndexAny(rest, "/,"); j >= 0 {
				return rest[:j]
			}
			return rest
		}
		// AWS AKID:signature
		if strings.HasPrefix(auth, "AWS ") {
			parts := strings.SplitN(auth[4:], ":", 2)
			return parts[0]
		}
		return ""
	}
	// presigned: X-Amz-Credential=AKID/date/...
	if c := r.URL.Query().Get("X-Amz-Credential"); c != "" {
		if j := strings.Index(c, "/"); j >= 0 {
			return c[:j]
		}
		return c
	}
	return ""
}

// ipAllowed checks the request IP against the key's allowlist
// (comma-separated IPs or CIDRs; empty allows all).
func ipAllowed(allowlist, ipStr string) bool {
	if strings.TrimSpace(allowlist) == "" {
		return true
	}
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return false
	}
	for _, entry := range strings.Split(allowlist, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if strings.Contains(entry, "/") {
			if _, network, err := net.ParseCIDR(entry); err == nil && network.Contains(ip) {
				return true
			}
		} else if net.ParseIP(entry) != nil && net.ParseIP(entry).Equal(ip) {
			return true
		}
	}
	return false
}

// isWriteMethod reports whether the method mutates data (denied for
// read-only keys).
func isWriteMethod(method string) bool {
	switch method {
	case http.MethodPut, http.MethodPost, http.MethodDelete, "PATCH":
		return true
	}
	return false
}

// bucketFromPath returns the bucket name (first path segment); ok is
// false for a bare "/" (ListBuckets).
func bucketFromPath(p string) (string, bool) {
	p = strings.TrimPrefix(p, "/")
	if p == "" {
		return "", false
	}
	if i := strings.Index(p, "/"); i >= 0 {
		return p[:i], true
	}
	return p, true
}

// s3Error writes a minimal S3 XML error response.
func s3Error(w http.ResponseWriter, code, message string, status int) {
	w.Header().Set("Content-Type", "application/xml")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>` +
		code + `</Code><Message>` + message + `</Message></Error>`))
}

// deny writes the error response and records audit + metrics for the
// early-rejection paths.
func deny(w http.ResponseWriter, r *http.Request, ak, message string, start time.Time) {
	s3Error(w, "AccessDenied", message, http.StatusForbidden)
	recordAudit(r, ak, http.StatusForbidden, 0, start)
	s3Metrics.observe(r.Method, http.StatusForbidden, 0, time.Since(start), ak)
}

// gatekeeper enforces per-key permissions and records audit + metrics.
// It wraps the whole S3 handler chain (redirects included).
func gatekeeper(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// no keys configured at all -> behave as before (open or legacy)
		if s3KeyStore.size() > 0 {
			ak := accessKeyFromRequest(r)
			key, ok := s3KeyStore.lookup(ak)
			if !ok {
				deny(w, r, ak, "invalid access key id", start)
				return
			}
			clientIP := clientIPFromRequest(r)
			if !ipAllowed(key.IPAllowlist, clientIP) {
				deny(w, r, ak, "source IP not allowed for this key", start)
				return
			}
			if bucket, hasBucket := bucketFromPath(r.URL.Path); hasBucket {
				if !key.AllowsBucket(bucket) {
					deny(w, r, ak, "key is not authorized for bucket "+bucket, start)
					return
				}
			} else if key.Buckets != "" {
				// scoped key: ListBuckets would leak other bucket names
				deny(w, r, ak, "scoped keys cannot list all buckets", start)
				return
			}
			if key.ReadOnly && isWriteMethod(r.Method) {
				deny(w, r, ak, "key is read-only", start)
				return
			}
			// key identity for downstream audit / stats
			r = r.WithContext(contextWithKeyID(r.Context(), key.ID))
			go op.TouchS3AccessKey(key.ID)
		}

		reqKey := accessKeyFromRequest(r)
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		// bytes metric: uploads count the request body, downloads the
		// response body
		size := rec.bytes
		if size == 0 && isWriteMethod(r.Method) && r.ContentLength > 0 {
			size = r.ContentLength
		}
		auditSize := rec.bytes
		if rec.status < 400 && isWriteMethod(r.Method) && r.ContentLength > 0 {
			auditSize = r.ContentLength
		}
		recordAudit(r, reqKey, rec.status, auditSize, start)
		s3Metrics.observe(r.Method, rec.status, size, time.Since(start), reqKey)
	})
}

// statusRecorder captures the response status and bytes written.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int64
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.bytes += int64(n)
	return n, err
}

// Flush passes through so streaming responses are not buffered.
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// clientIPFromRequest extracts the peer IP for allowlist checks.
func clientIPFromRequest(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
