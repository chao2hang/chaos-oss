// Credits: https://pkg.go.dev/github.com/rclone/rclone@v1.65.2/cmd/serve/s3
// Package s3 implements a fake s3 server for openlist
package s3

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/itsHenry35/gofakes3"
	log "github.com/sirupsen/logrus"
)

// Write policies.
const (
	// PolicyAny: any one successful write is enough; failed paths are
	// retried in the background. This is the default and matches the
	// user-facing "任一成功" requirement.
	PolicyAny = "any"
	// PolicyAll: all paths must succeed before the upload is reported
	// as successful. Stronger consistency, lower availability.
	PolicyAll = "all"
)

// Bucket is the chaos-oss S3 gateway bucket definition.
//
// The original v0 schema was {Name, Path}; v1 introduces {Name, Paths, Policy}
// so that one logical S3 bucket can fan out writes to multiple underlying
// storage paths. The legacy Path field is still accepted and is transparently
// promoted to a single-element Paths slice on load.
type Bucket struct {
	Name string `json:"name"`
	// Path is kept for backward compatibility. When Paths is empty but
	// Path is non-empty, Path is promoted to Paths during normalization.
	Path string `json:"path,omitempty"`
	// Paths is the canonical list of underlying storage paths that this
	// bucket fans out to. Each path must be a chaos-oss mount path
	// (e.g. "/my_driver/folder").
	Paths []string `json:"paths,omitempty"`
	// Policy controls the write semantics:
	//   "any" - any successful write completes the upload; failures are
	//           retried in the background (default, "任一成功").
	//   "all" - all paths must succeed for the upload to be considered
	//           successful; the request fails on any error.
	Policy string `json:"policy,omitempty"`
}

// normalized returns a copy of b with legacy Path promoted to Paths, a
// default Policy applied, and Paths trimmed & deduped while preserving
// the first-seen order. The returned Bucket is a value-typed copy and
// Paths is freshly allocated, so callers may safely mutate either
// without affecting the original.
func (b Bucket) normalized() Bucket {
	if b.Policy == "" {
		b.Policy = PolicyAny
	}
	if len(b.Paths) == 0 && b.Path != "" {
		b.Paths = []string{b.Path}
	}
	// dedupe & trim, preserving first-seen order
	seen := make(map[string]struct{}, len(b.Paths))
	out := make([]string, 0, len(b.Paths))
	for _, p := range b.Paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	b.Paths = out
	return b
}

func (b Bucket) effectivePaths() []string {
	n := b.normalized()
	return n.Paths
}

func (b Bucket) writePolicy() string {
	if b.Policy != "" {
		return b.Policy
	}
	if v := setting.GetStr(conf.S3ReplicationDefaultPolicy); v != "" {
		return v
	}
	return PolicyAny
}

const emptyObjectName = "ThisIsAnEmptyFolderInTheS3Bucket"

// getAndParseBuckets loads the s3_buckets setting (a JSON array) and
// normalizes every entry (legacy path promotion, default policy).
func getAndParseBuckets() ([]Bucket, error) {
	raw := setting.GetStr(conf.S3Buckets)
	if raw == "" {
		return nil, nil
	}
	var res []Bucket
	if err := json.Unmarshal([]byte(raw), &res); err != nil {
		return nil, err
	}
	for i := range res {
		res[i] = res[i].normalized()
	}
	return res, nil
}

// getBucketByName returns the bucket configuration with the given name.
// The returned bucket is already normalized.
func getBucketByName(name string) (Bucket, error) {
	buckets, err := getAndParseBuckets()
	if err != nil {
		return Bucket{}, err
	}
	for _, b := range buckets {
		if b.Name == name {
			return b, nil
		}
	}
	return Bucket{}, gofakes3.BucketNotFound(name)
}

func getDirEntries(path string) ([]model.Obj, error) {
	ctx := context.Background()
	meta, _ := op.GetNearestMeta(path)
	fi, err := fs.Get(context.WithValue(ctx, conf.MetaKey, meta), path, &fs.GetArgs{})
	if errs.IsNotFoundError(err) {
		return nil, gofakes3.ErrNoSuchKey
	} else if err != nil {
		return nil, gofakes3.ErrNoSuchKey
	}

	if !fi.IsDir() {
		return nil, gofakes3.ErrNoSuchKey
	}

	dirEntries, err := fs.List(context.WithValue(ctx, conf.MetaKey, meta), path, &fs.ListArgs{})
	if err != nil {
		return nil, err
	}

	return dirEntries, nil
}

// pathProbe records the last observed latency and outcome for a given
// (bucket, path) pair. It is used by the read path to prefer low-latency
// channels when one is healthy enough to answer first.
type pathProbe struct {
	// latencyEWMA is the exponentially weighted moving average of
	// successful round-trip time in milliseconds.
	latencyEWMA atomic.Int64
	// lastSeen is the wall-clock time of the most recent probe.
	lastSeen atomic.Int64
	// failures is a rolling count of consecutive failures used to
	// demote a path that has been unhealthy for a while.
	failures atomic.Int32
}

type bucketProbes struct {
	mu     sync.Mutex
	byPath map[string]*pathProbe
}

func newBucketProbes() *bucketProbes {
	return &bucketProbes{byPath: make(map[string]*pathProbe)}
}

func (p *bucketProbes) get(path string) *pathProbe {
	p.mu.Lock()
	defer p.mu.Unlock()
	pr, ok := p.byPath[path]
	if !ok {
		pr = &pathProbe{}
		p.byPath[path] = pr
	}
	return pr
}

// recordSuccess updates the EWMA with a successful probe. The first sample
// is taken verbatim; later samples are smoothed with alpha=0.3.
func (pr *pathProbe) recordSuccess(d time.Duration) {
	ms := d.Milliseconds()
	if ms < 1 {
		ms = 1
	}
	for {
		old := pr.latencyEWMA.Load()
		var next int64
		if old == 0 {
			next = ms
		} else {
			next = (old*7 + ms*3) / 10
		}
		if pr.latencyEWMA.CompareAndSwap(old, next) {
			break
		}
	}
	pr.lastSeen.Store(time.Now().UnixMilli())
	pr.failures.Store(0)
}

// recordFailure bumps the failure counter and pushes lastSeen forward.
func (pr *pathProbe) recordFailure() {
	pr.failures.Add(1)
	pr.lastSeen.Store(time.Now().UnixMilli())
}

// score returns a "lower is better" ranking for this path. Healthy paths
// with known latency return their EWMA; unknown paths return a moderate
// default; failing paths return a large penalty.
func (pr *pathProbe) score() int64 {
	fails := pr.failures.Load()
	if fails >= 3 {
		return 1<<62 - 1
	}
	ewma := pr.latencyEWMA.Load()
	if ewma == 0 {
		return 5000 // unknown, treat as mediocre
	}
	return ewma + int64(fails)*2000
}

func prefixParser(p *gofakes3.Prefix) (path, remaining string) {
	idx := strings.LastIndexByte(p.Prefix, '/')
	if idx < 0 {
		return "", p.Prefix
	}
	return p.Prefix[:idx], p.Prefix[idx+1:]
}

func authlistResolver() map[string]string {
	s3accesskeyid := setting.GetStr(conf.S3AccessKeyId)
	s3secretaccesskey := setting.GetStr(conf.S3SecretAccessKey)
	if s3accesskeyid == "" && s3secretaccesskey == "" {
		return nil
	}
	authList := make(map[string]string)
	authList[s3accesskeyid] = s3secretaccesskey
	return authList
}

// probeRegistry keeps the per-bucket probe state across requests.
var probeRegistry sync.Map // map[string]*bucketProbes, key = bucket name

func probesFor(bucket string) *bucketProbes {
	if v, ok := probeRegistry.Load(bucket); ok {
		return v.(*bucketProbes)
	}
	p := newBucketProbes()
	actual, _ := probeRegistry.LoadOrStore(bucket, p)
	return actual.(*bucketProbes)
}

// rankedPaths returns the bucket's paths sorted by their current probe
// score (lowest first). The slice is a fresh copy; callers may mutate it.
func rankedPaths(bucket Bucket) []string {
	paths := bucket.effectivePaths()
	if len(paths) == 0 {
		return nil
	}
	if len(paths) == 1 {
		return paths
	}
	probes := probesFor(bucket.Name)
	type scored struct {
		path  string
		score int64
	}
	scoredAll := make([]scored, len(paths))
	for i, p := range paths {
		scoredAll[i] = scored{path: p, score: probes.get(p).score()}
	}
	// simple selection sort: paths is small (typically 2-5) so O(n^2) is fine
	// and avoids pulling in sort just for an int64.
	for i := 1; i < len(scoredAll); i++ {
		j := i
		for j > 0 && scoredAll[j-1].score > scoredAll[j].score {
			scoredAll[j-1], scoredAll[j] = scoredAll[j], scoredAll[j-1]
			j--
		}
	}
	out := make([]string, len(scoredAll))
	for i, s := range scoredAll {
		out[i] = s.path
	}
	return out
}

// logf is a thin wrapper so we can grep replication-related log lines.
func logf(format string, args ...any) {
	log.Debugf("[s3-replicate] "+format, args...)
}
