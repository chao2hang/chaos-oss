// Credits: https://pkg.go.dev/github.com/rclone/rclone@v1.65.2/cmd/serve/s3
// Package s3 implements a fake s3 server for openlist
package s3

import (
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// s3Metrics collects request counters for observability. Counters are
// kept in memory (for the JSON stats API) and mirrored into a private
// Prometheus registry exposed at /metrics.
type metricsCollector struct {
	requestsTotal   *prometheus.CounterVec
	requestDuration *prometheus.HistogramVec
	bytesIn         *prometheus.CounterVec
	bytesOut        *prometheus.CounterVec
	registry        *prometheus.Registry

	// in-memory snapshot for the JSON stats API
	mu       sync.Mutex
	since    time.Time
	total    int64
	errors   int64
	bytesInT  int64
	bytesOutT int64
	byKey    map[string]*keyStats
}

type keyStats struct {
	Requests  int64 `json:"requests"`
	Errors    int64 `json:"errors"`
	BytesIn   int64 `json:"bytes_in"`
	BytesOut  int64 `json:"bytes_out"`
	LastUsed  int64 `json:"last_used"` // unix ms
}

var s3Metrics = newMetricsCollector()

func newMetricsCollector() *metricsCollector {
	m := &metricsCollector{
		registry: prometheus.NewRegistry(),
		byKey:    map[string]*keyStats{},
		since:    time.Now(),
	}
	m.requestsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "openlist_s3_requests_total",
		Help: "S3 gateway requests",
	}, []string{"method", "code", "key"})
	m.requestDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "openlist_s3_request_duration_seconds",
		Help:    "S3 gateway request latency",
		Buckets: prometheus.DefBuckets,
	}, []string{"method"})
	m.bytesIn = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "openlist_s3_bytes_in_total",
		Help: "Bytes uploaded through the S3 gateway",
	}, []string{"key"})
	m.bytesOut = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "openlist_s3_bytes_out_total",
		Help: "Bytes downloaded through the S3 gateway",
	}, []string{"key"})
	m.registry.MustRegister(
		m.requestsTotal,
		m.requestDuration,
		m.bytesIn,
		m.bytesOut,
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "openlist_s3_replication_queue_depth",
			Help: "Pending multi-path replication retries",
		}, func() float64 { return float64(ReplicationQueueDepth()) }),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "openlist_s3_audit_queue_depth",
			Help: "Pending audit records waiting to be persisted",
		}, func() float64 { return float64(op.S3AuditQueueLen()) }),
	)
	return m
}

// observe records one completed request.
func (m *metricsCollector) observe(method string, status int, bytes int64, d time.Duration, accessKey string) {
	key := accessKey
	if key == "" {
		key = "anonymous"
	}
	code := strconv.Itoa(status)
	m.requestsTotal.WithLabelValues(method, code, key).Inc()
	m.requestDuration.WithLabelValues(method).Observe(d.Seconds())
	if method == http.MethodPut || method == http.MethodPost {
		m.bytesIn.WithLabelValues(key).Add(float64(bytes))
	} else if bytes > 0 {
		m.bytesOut.WithLabelValues(key).Add(float64(bytes))
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	atomic.AddInt64(&m.total, 1)
	if status >= 400 {
		atomic.AddInt64(&m.errors, 1)
	}
	ks, ok := m.byKey[key]
	if !ok {
		ks = &keyStats{}
		m.byKey[key] = ks
	}
	ks.Requests++
	if status >= 400 {
		ks.Errors++
	}
	if method == http.MethodPut || method == http.MethodPost {
		ks.BytesIn += bytes
		atomic.AddInt64(&m.bytesInT, bytes)
	} else if bytes > 0 {
		ks.BytesOut += bytes
		atomic.AddInt64(&m.bytesOutT, bytes)
	}
	ks.LastUsed = time.Now().UnixMilli()
}

// StatsSnapshot is the JSON shape served by the admin stats API.
type StatsSnapshot struct {
	Since    time.Time           `json:"since"`
	Total    int64               `json:"total"`
	Errors   int64               `json:"errors"`
	BytesIn  int64               `json:"bytes_in"`
	BytesOut int64               `json:"bytes_out"`
	ReplicationQueue int         `json:"replication_queue"`
	AuditQueue       int         `json:"audit_queue"`
	ByKeys   map[string]*keyStats `json:"by_keys"`
}

// Snapshot returns current counters since process start.
func (m *metricsCollector) Snapshot() StatsSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	byKeys := make(map[string]*keyStats, len(m.byKey))
	for k, v := range m.byKey {
		cp := *v
		byKeys[k] = &cp
	}
	return StatsSnapshot{
		Since:    m.since,
		Total:    atomic.LoadInt64(&m.total),
		Errors:   atomic.LoadInt64(&m.errors),
		BytesIn:  atomic.LoadInt64(&m.bytesInT),
		BytesOut: atomic.LoadInt64(&m.bytesOutT),
		ReplicationQueue: ReplicationQueueDepth(),
		AuditQueue:       op.S3AuditQueueLen(),
		ByKeys:   byKeys,
	}
}

// MetricsHandler serves the Prometheus exposition format.
func MetricsHandler() http.Handler {
	return promhttp.HandlerFor(s3Metrics.registry, promhttp.HandlerOpts{})
}
