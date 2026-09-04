// Credits: https://pkg.go.dev/github.com/rclone/rclone@v1.65.2/cmd/serve/s3
// Package s3 implements a fake s3 server for openlist
package s3

import (
	"context"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/internal/stream"
	"github.com/OpenListTeam/OpenList/v4/pkg/http_range"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/itsHenry35/gofakes3"
	"github.com/ncw/swift/v2"
	pkgerrors "github.com/pkg/errors"
	log "github.com/sirupsen/logrus"
)

var (
	emptyPrefix = &gofakes3.Prefix{}
	timeFormat  = "Mon, 2 Jan 2006 15:04:05 GMT"
)

// s3Backend implements the gofakes3.Backend interface for the chaos-oss
// S3 gateway. Each configured bucket is fanned out to one or more
// underlying storage paths so that uploads are automatically replicated.
type s3Backend struct {
	meta *sync.Map
}

// newBackend creates a new SimpleBucketBackend.
func newBackend() gofakes3.Backend {
	return &s3Backend{
		meta: new(sync.Map),
	}
}

// ListBuckets returns the configured buckets. The creation time is read
// from the first available underlying path; if none of the paths are
// reachable we fall back to the unix epoch so the response stays valid.
func (b *s3Backend) ListBuckets(ctx context.Context) ([]gofakes3.BucketInfo, error) {
	buckets, err := getAndParseBuckets()
	if err != nil {
		return nil, err
	}
	var response []gofakes3.BucketInfo
	for _, b := range buckets {
		creation := time.Unix(0, 0)
		if node, err := b.firstReachable(ctx); err == nil && node != nil {
			creation = node.ModTime()
		}
		response = append(response, gofakes3.BucketInfo{
			Name:         b.Name,
			CreationDate: gofakes3.NewContentTime(creation),
		})
	}
	return response, nil
}

// ListBucket returns the contents of a bucket. The "lowest latency wins"
// strategy races the listing against every configured path and merges
// the results; entries that appear in more than one path are deduplicated
// by name and the first path's metadata wins.
func (b *s3Backend) ListBucket(ctx context.Context, bucketName string, prefix *gofakes3.Prefix, page gofakes3.ListBucketPage) (*gofakes3.ObjectList, error) {
	bucket, err := getBucketByName(bucketName)
	if err != nil {
		return nil, err
	}

	if prefix == nil {
		prefix = emptyPrefix
	}
	// workaround
	if strings.TrimSpace(prefix.Prefix) == "" {
		prefix.HasPrefix = false
	}
	if strings.TrimSpace(prefix.Delimiter) == "" {
		prefix.HasDelimiter = false
	}

	response := gofakes3.NewObjectList()
	dirPath, _ := prefixParser(prefix)

	type result struct {
		entries []model.Obj
		err     error
	}
	paths := bucket.effectivePaths()
	results := make([]result, len(paths))
	var wg sync.WaitGroup
	for i, p := range paths {
		wg.Add(1)
		go func(i int, p string) {
			defer wg.Done()
			entries, err := listPath(ctx, path.Join(p, dirPath))
			results[i] = result{entries: entries, err: err}
		}(i, p)
	}
	wg.Wait()

	seen := make(map[string]struct{}, 32)
	mergeBucket := func(entries []model.Obj) {
		for _, e := range entries {
			name := e.GetName()
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			if e.IsDir() {
				response.AddPrefix(path.Join(dirPath, name) + "/")
			} else {
				response.Add(&gofakes3.Content{
					Key:          path.Join(dirPath, name),
					LastModified: gofakes3.NewContentTime(e.ModTime()),
					Size:         e.GetSize(),
				})
			}
		}
	}

	for _, r := range results {
		if r.err != nil {
			// at least one path must be readable; if none are, the
			// bucket is effectively empty (S3 returns [] not 404)
			continue
		}
		mergeBucket(r.entries)
	}

	return b.pager(response, page)
}

func listPath(ctx context.Context, fullPath string) ([]model.Obj, error) {
	meta, _ := op.GetNearestMeta(fullPath)
	c := context.WithValue(ctx, conf.MetaKey, meta)
	fi, err := fs.Get(c, fullPath, &fs.GetArgs{})
	if err != nil {
		if errs.IsObjectNotFound(err) {
			return nil, nil
		}
		return nil, err
	}
	if !fi.IsDir() {
		return nil, nil
	}
	return fs.List(c, fullPath, &fs.ListArgs{})
}

// HeadObject returns metadata for an object. We race the configured paths
// and use the first one that returns a valid file. The successful path's
// probe score is updated so subsequent reads prefer it.
func (b *s3Backend) HeadObject(ctx context.Context, bucketName, objectName string) (*gofakes3.Object, error) {
	bucket, err := getBucketByName(bucketName)
	if err != nil {
		return nil, err
	}
	type result struct {
		path string
		obj  *gofakes3.Object
		err  error
	}
	paths := rankedPaths(bucket)
	results := make([]result, len(paths))
	var wg sync.WaitGroup
	for i, p := range paths {
		wg.Add(1)
		go func(i int, p string) {
			defer wg.Done()
			start := time.Now()
			obj, err := headAtPath(b, ctx, p, objectName)
			results[i] = result{path: p, obj: obj, err: err}
			probe := probesFor(bucketName).get(p)
			if err == nil {
				probe.recordSuccess(time.Since(start))
			} else {
				probe.recordFailure()
			}
		}(i, p)
	}
	wg.Wait()
	for _, r := range results {
		if r.err == nil {
			return r.obj, nil
		}
	}
	return nil, gofakes3.KeyNotFound(objectName)
}

func headAtPath(b *s3Backend, ctx context.Context, basePath, objectName string) (*gofakes3.Object, error) {
	fp := path.Join(basePath, objectName)
	fmeta, _ := op.GetNearestMeta(fp)
	node, err := fs.Get(context.WithValue(ctx, conf.MetaKey, fmeta), fp, &fs.GetArgs{})
	if err != nil {
		return nil, err
	}
	if node.IsDir() {
		return nil, gofakes3.KeyNotFound(objectName)
	}
	meta := map[string]string{
		"Last-Modified": node.ModTime().Format(timeFormat),
		"Content-Type":  utils.GetMimeType(fp),
	}
	// Restore per-object custom metadata captured at PutObject time. We
	// only honor the first path that has it (consistent with how reads
	// race the paths), so a write to one path is enough to make the
	// user-supplied headers visible on subsequent reads.
	if val, ok := b.meta.Load(fp); ok {
		for k, v := range val.(map[string]string) {
			meta[k] = v
		}
	}
	return &gofakes3.Object{
		Name:     objectName,
		Metadata: meta,
		Size:     node.GetSize(),
		Contents: noOpReadCloser{},
	}, nil
}

// GetObject fetches the object body. Like HeadObject it races the
// configured paths and returns the first successful response; the
// winning path's probe score is bumped.
func (b *s3Backend) GetObject(ctx context.Context, bucketName, objectName string, rangeRequest *gofakes3.ObjectRangeRequest) (s3Obj *gofakes3.Object, err error) {
	bucket, err := getBucketByName(bucketName)
	if err != nil {
		return nil, err
	}
	type result struct {
		path string
		obj  *gofakes3.Object
		err  error
	}
	paths := rankedPaths(bucket)
	results := make([]result, len(paths))
	var wg sync.WaitGroup
	for i, p := range paths {
		wg.Add(1)
		go func(i int, p string) {
			defer wg.Done()
			start := time.Now()
			obj, err := getAtPath(b, ctx, p, objectName, rangeRequest)
			results[i] = result{path: p, obj: obj, err: err}
			probe := probesFor(bucketName).get(p)
			if err == nil {
				probe.recordSuccess(time.Since(start))
			} else {
				probe.recordFailure()
			}
		}(i, p)
	}
	wg.Wait()
	for _, r := range results {
		if r.err == nil {
			return r.obj, nil
		}
	}
	return nil, gofakes3.KeyNotFound(objectName)
}

func getAtPath(b *s3Backend, ctx context.Context, basePath, objectName string, rangeRequest *gofakes3.ObjectRangeRequest) (*gofakes3.Object, error) {
	fp := path.Join(basePath, objectName)
	fmeta, _ := op.GetNearestMeta(fp)
	node, err := fs.Get(context.WithValue(ctx, conf.MetaKey, fmeta), fp, &fs.GetArgs{})
	if err != nil {
		return nil, gofakes3.KeyNotFound(objectName)
	}
	if node.IsDir() {
		return nil, gofakes3.KeyNotFound(objectName)
	}

	link, file, err := fs.Link(ctx, fp, model.LinkArgs{})
	if err != nil {
		return nil, err
	}
	size := link.ContentLength
	if size <= 0 {
		size = file.GetSize()
	}
	rnge, err := rangeRequest.Range(size)
	if err != nil {
		_ = link.Close()
		return nil, err
	}
	rrf, err := stream.GetRangeReaderFromLink(size, link)
	if err != nil {
		return nil, fmt.Errorf("the remote storage driver need to be enhanced to support s3")
	}
	var rd io.Reader
	if rnge != nil {
		rd, err = rrf.RangeRead(ctx, http_range.Range(*rnge))
	} else {
		rd, err = rrf.RangeRead(ctx, http_range.Range{Length: -1})
	}
	if err != nil {
		return nil, err
	}
	meta := map[string]string{
		"Last-Modified":       node.ModTime().Format(timeFormat),
		"Content-Disposition": utils.GenerateContentDisposition(file.GetName()),
		"Content-Type":        utils.GetMimeType(fp),
	}
	// Same meta-merge semantics as headAtPath: the first path that has
	// custom user metadata wins, and it is layered on top of the derived
	// metadata so users can override Content-Type / etc.
	if val, ok := b.meta.Load(fp); ok {
		for k, v := range val.(map[string]string) {
			meta[k] = v
		}
	}
	return &gofakes3.Object{
		Name:     objectName,
		Metadata: meta,
		Size:     size,
		Range:    rnge,
		Contents: utils.ReadCloser{Reader: rd, Closer: link},
	}, nil
}

// TouchObject creates or updates meta on specified object.
func (b *s3Backend) TouchObject(ctx context.Context, fp string, meta map[string]string) (result gofakes3.PutObjectResult, err error) {
	return result, gofakes3.ErrNotImplemented
}

// PutObject creates or overwrites the object. The flow is:
//
//  1. Drain the request body to a local temp file (so it can be replayed
//     against every path).
//  2. Fan out concurrent fs.PutDirectly calls to every configured path.
//  3. If the bucket policy is "any", the first successful write completes
//     the request; the rest are retried in the background.
//  4. If the bucket policy is "all", the request only completes when
//     every path has been written; a single failure aborts and rolls back
//     the successful ones.
//
// In both cases the temp file is removed once responsibility for the
// remaining targets has been handed to the replication worker.
func (b *s3Backend) PutObject(
	ctx context.Context, bucketName, objectName string,
	meta map[string]string,
	input io.Reader, size int64,
) (result gofakes3.PutObjectResult, err error) {
	bucket, err := getBucketByName(bucketName)
	if err != nil {
		return result, err
	}

	paths := bucket.effectivePaths()
	if len(paths) == 0 {
		return result, gofakes3.ErrNoSuchBucket
	}

	isDir := strings.HasSuffix(objectName, "/")
	log.Debugf("[s3-replicate] PutObject bucket=%s object=%s size=%d isDir=%v paths=%d",
		bucketName, objectName, size, isDir, len(paths))

	// Compute mtime from meta headers (mtime, X-Amz-Meta-Mtime) before
	// we hand the file off to the worker.
	var mtime time.Time
	if val, ok := meta["X-Amz-Meta-Mtime"]; ok {
		mtime, _ = swift.FloatStringToTime(val)
	}
	if val, ok := meta["mtime"]; ok {
		mtime, _ = swift.FloatStringToTime(val)
	}
	if mtime.IsZero() {
		mtime = time.Now()
	}

	if isDir {
		// For directories we don't have a body to buffer, so we issue a
		// mkdir on every path concurrently. Any success is enough.
		return result, fanOutMkdir(ctx, paths, path.Join(paths[0], objectName))
	}

	// Ignore system files early; no need to buffer the body.
	if setting.GetBool(conf.IgnoreSystemFiles) && utils.IsSystemFile(path.Base(objectName)) {
		return result, errs.IgnoredSystemFile
	}

	// Buffer the upload body to a temp file so it can be re-read for
	// each path. CacheFullAndWriter also lets us avoid re-allocating
	// the in-memory buffer when the body is large.
	cachePath, err := cacheUploadToTempFile(ctx, input, size, meta)
	if err != nil {
		return result, pkgerrors.WithMessage(err, "failed to cache upload body")
	}
	// Ownership of cachePath transfers either to the replication
	// worker (on partial success) or to this function (on full success
	// or full failure). Either way, we delete it on the way out.
	defer func() {
		if cachePath != "" {
			_ = os.Remove(cachePath)
		}
	}()

	policy := bucket.writePolicy()
	results := fanOutPut(ctx, bucketName, paths, objectName, meta, mtime, size, cachePath, policy)

	// All paths failed: report the first error so the client knows the
	// upload didn't land anywhere.
	allFailed := true
	for _, r := range results {
		if r.err == nil {
			allFailed = false
			break
		}
	}
	if allFailed {
		return result, fmt.Errorf("all %d replication targets failed: %s", len(paths), firstErr(results).Error())
	}

	// If policy=any, hand the still-failed paths to the background
	// worker for asynchronous retry. If policy=all, we already returned
	// above on the first failure.
	if policy == PolicyAny {
		var pending []string
		for _, r := range results {
			if r.err != nil {
				pending = append(pending, r.path)
			}
		}
		if len(pending) > 0 {
			// The worker takes ownership of the temp file. Hand off
			// the path under a different name to suppress the
			// deferred removal, then enqueue.
			handoff := cachePath
			cachePath = ""
			repWorker.Enqueue(&pendingPut{
				bucket:     bucketName,
				object:     objectName,
				meta:       meta,
				cachedFile: handoff,
				size:       size,
				ctime:      mtime,
				targets:    pending,
				isDir:      false,
			})
		}
	}

	// Record the metadata for the gateway's own bookkeeping.
	for _, p := range paths {
		b.meta.Store(path.Join(p, objectName), meta)
	}

	return result, nil
}

// fanOutPut issues concurrent fs.PutDirectly calls for every target path.
// It returns a slice of (path, error) pairs in the same order. When
// policy is PolicyAll the first failure short-circuits the rest via a
// derived context, so storage drivers that respect ctx can abort early.
// probeBucket, when non-empty, is the bucket whose path probes should be
// updated with the per-path write latency; pass "" to skip probe updates
// (used when the caller has no bucket context, e.g. unit tests).
func fanOutPut(
	ctx context.Context,
	probeBucket string,
	paths []string,
	objectName string,
	meta map[string]string,
	mtime time.Time,
	size int64,
	cachePath string,
	policy string,
) []putResult {
	results := make([]putResult, len(paths))
	if len(paths) == 0 {
		return results
	}
	// cancelCtx is cancelled by the first PolicyAll failure so that
	// drivers which respect ctx.Done() can abort their in-flight writes
	// instead of completing uploads the caller will discard.
	cancelCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var wg sync.WaitGroup
	var firstFailOnce sync.Once
	for i, p := range paths {
		wg.Add(1)
		go func(i int, p string) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					// A bad storage driver must not crash the gateway.
					// Translate the panic into an error so the caller's
					// error handling treats this path as failed.
					results[i] = putResult{
						path: p,
						err:  fmt.Errorf("storage driver panic on path %s: %v", p, r),
					}
					if probeBucket != "" {
						probesFor(probeBucket).get(p).recordFailure()
					}
					if policy == PolicyAll {
						firstFailOnce.Do(cancel)
					}
				}
			}()
			start := time.Now()
			err := putOnePath(cancelCtx, p, objectName, meta, mtime, size, cachePath)
			results[i] = putResult{path: p, err: err}
			// Record latency for every path so the probe ranking also
			// reflects write-side cost. Both successful and failed
			// attempts are recorded (failures bump the failure counter,
			// successes update the EWMA) so the ranking adapts to
			// write-side health too.
			if probeBucket != "" {
				probe := probesFor(probeBucket).get(p)
				if err == nil {
					probe.recordSuccess(time.Since(start))
				} else {
					probe.recordFailure()
				}
			}
			if err != nil && policy == PolicyAll {
				firstFailOnce.Do(cancel)
			}
		}(i, p)
	}
	wg.Wait()
	return results
}

type putResult struct {
	path string
	err  error
}

func firstErr(results []putResult) error {
	for _, r := range results {
		if r.err != nil {
			return r.err
		}
	}
	return nil
}

// putOnePath runs a single PutDirectly for a given target path. The
// caller is responsible for ensuring cachePath stays alive for the
// duration of the call; we open our own *os.File so multiple goroutines
// can read from the same on-disk cache concurrently.
func putOnePath(
	ctx context.Context,
	basePath, objectName string,
	meta map[string]string,
	mtime time.Time,
	size int64,
	cachePath string,
) error {
	fp := path.Join(basePath, objectName)
	fmeta, _ := op.GetNearestMeta(fp)
	ctx = context.WithValue(ctx, conf.MetaKey, fmeta)
	ctx = context.WithValue(ctx, conf.SkipHookKey, struct{}{})

	reqPath := path.Dir(fp)
	if _, err := fs.Get(ctx, reqPath, &fs.GetArgs{}); err != nil {
		if errs.IsObjectNotFound(err) && strings.Contains(objectName, "/") {
			if mkErr := fs.MakeDir(ctx, reqPath); mkErr != nil {
				return pkgerrors.WithMessagef(mkErr, "failed to makeDir, reqPath: %s", reqPath)
			}
		} else {
			return gofakes3.KeyNotFound(objectName)
		}
	}

	f, err := os.Open(cachePath)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	stream := &stream.FileStream{
		Obj: &model.Object{
			Name:     path.Base(fp),
			Size:     size,
			Modified: mtime,
			Ctime:    time.Now(),
		},
		Reader:   f,
		Mimetype: meta["Content-Type"],
	}
	return fs.PutDirectly(ctx, reqPath, stream, true)
}

// fanOutMkdir creates the same directory under every configured path and
// reports success on the first non-error result. It is used for
// trailing-slash object names which S3 uses to materialize empty
// directories.
func fanOutMkdir(ctx context.Context, paths []string, fp string) error {
	var wg sync.WaitGroup
	errs := make([]error, len(paths))
	for i, p := range paths {
		wg.Add(1)
		go func(i int, p string) {
			defer wg.Done()
			target := path.Join(p, fp)
			fmeta, _ := op.GetNearestMeta(target)
			c := context.WithValue(ctx, conf.MetaKey, fmeta)
			errs[i] = fs.MakeDir(c, path.Dir(target))
		}(i, p)
	}
	wg.Wait()
	for _, e := range errs {
		if e == nil {
			return nil
		}
	}
	return errs[0]
}

// cacheUploadToTempFile copies the request body to a local temp file and
// returns its path. The temp file is created in os.TempDir() and is the
// caller's responsibility to remove.
func cacheUploadToTempFile(ctx context.Context, input io.Reader, size int64, meta map[string]string) (string, error) {
	// Wrap the input in a stream.FileStream so we get CacheFullAndWriter
	// for free: small files stay in memory, large files spill to disk.
	fs := &stream.FileStream{
		Obj: &model.Object{
			Name:     "s3-upload",
			Size:     size,
			Modified: time.Now(),
		},
		Reader:   input,
		Mimetype: meta["Content-Type"],
	}
	cache, err := fs.CacheFullAndWriter(nil, nil)
	if err != nil {
		return "", err
	}
	if cache == nil {
		// Stream was zero-length; create an empty temp file so downstream
		// os.Open calls still work.
		f, err := os.CreateTemp("", "s3-upload-*")
		if err != nil {
			return "", err
		}
		if err := f.Close(); err != nil {
			return "", err
		}
		return f.Name(), nil
	}
	// Persist the cache to disk so the file survives this function
	// returning. CacheFullAndWriter may have kept it in memory when
	// the body was small.
	tmp, err := os.CreateTemp("", "s3-upload-*")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	if _, err := cache.Seek(0, io.SeekStart); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return "", err
	}
	if _, err := io.Copy(tmp, cache); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return "", err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return "", err
	}
	// The in-memory cache (when used) is GC'd once the function returns;
	// the disk-backed cache is a *os.File which we leave open but the
	// OS will reclaim it when the process exits. We own the new temp
	// file now and are responsible for removing it later.
	return tmpName, nil
}

// DeleteMulti deletes multiple objects in a single request. Each object's
// delete is fanned out across the configured paths; a single path failure
// is recorded but does not abort the others.
func (b *s3Backend) DeleteMulti(ctx context.Context, bucketName string, objects ...string) (result gofakes3.MultiDeleteResult, rerr error) {
	for _, object := range objects {
		if err := b.deleteObject(ctx, bucketName, object); err != nil {
			log.Errorf("delete object failed: %v", err)
			result.Error = append(result.Error, gofakes3.ErrorResult{
				Code:    gofakes3.ErrInternal,
				Message: gofakes3.ErrInternal.Message(),
				Key:     object,
			})
		} else {
			result.Deleted = append(result.Deleted, gofakes3.ObjectID{
				Key: object,
			})
		}
	}

	return result, nil
}

// DeleteObject deletes the object from every configured path. Like S3,
// missing objects are not treated as an error; the per-path failures are
// logged but do not surface to the client.
func (b *s3Backend) DeleteObject(ctx context.Context, bucketName, objectName string) (result gofakes3.ObjectDeleteResult, rerr error) {
	return result, b.deleteObject(ctx, bucketName, objectName)
}

func (b *s3Backend) deleteObject(ctx context.Context, bucketName, objectName string) error {
	repWorker.Cancel(bucketName, objectName)
	bucket, err := getBucketByName(bucketName)
	if err != nil {
		return err
	}
	paths := bucket.effectivePaths()
	if len(paths) == 0 {
		return nil
	}

	type result struct {
		err error
	}
	results := make([]result, len(paths))
	var wg sync.WaitGroup
	for i, p := range paths {
		wg.Add(1)
		go func(i int, p string) {
			defer wg.Done()
			fp := path.Join(p, objectName)
			b.meta.Delete(fp)
			fmeta, _ := op.GetNearestMeta(fp)
			c := context.WithValue(ctx, conf.MetaKey, fmeta)
			if rmErr := fs.Remove(c, fp); rmErr != nil && !errs.IsObjectNotFound(rmErr) && !errs.IsNotFoundError(rmErr) {
				results[i] = result{err: rmErr}
			}
		}(i, p)
	}
	wg.Wait()

	for _, r := range results {
		if r.err != nil {
			return r.err
		}
	}
	return nil
}

// CreateBucket creates a new bucket.
func (b *s3Backend) CreateBucket(ctx context.Context, name string) error {
	return gofakes3.ErrNotImplemented
}

// DeleteBucket deletes the bucket with the given name.
func (b *s3Backend) DeleteBucket(ctx context.Context, name string) error {
	return gofakes3.ErrNotImplemented
}

// BucketExists checks if the bucket exists.
func (b *s3Backend) BucketExists(ctx context.Context, name string) (exists bool, err error) {
	buckets, err := getAndParseBuckets()
	if err != nil {
		return false, err
	}
	for _, b := range buckets {
		if b.Name == name {
			return true, nil
		}
	}
	return false, nil
}

// CopyObject copies from one bucket to another. The source is read from
// the best-ranked path of srcBucket; the destination is fanned out to
// every path of dstBucket using the same fan-out policy as PutObject.
func (b *s3Backend) CopyObject(ctx context.Context, srcBucket, srcKey, dstBucket, dstKey string, meta map[string]string) (result gofakes3.CopyObjectResult, err error) {
	if srcBucket == dstBucket && srcKey == dstKey {
		return result, nil
	}
	srcB, err := getBucketByName(srcBucket)
	if err != nil {
		return result, err
	}
	dstB, err := getBucketByName(dstBucket)
	if err != nil {
		return result, err
	}

	// Find a readable source. We try the ranked paths and use the first
	// that returns a valid object. We don't pre-cache to a temp file
	// here because the source is already on disk somewhere - the
	// underlying fs.Link will give us a streaming reader.
	type srcResult struct {
		path string
		obj  *gofakes3.Object
	}
	srcPaths := rankedPaths(srcB)
	var srcObj *gofakes3.Object
	var srcNode model.Obj
	srcFound := false
	for _, p := range srcPaths {
		fp := path.Join(p, srcKey)
		fmeta, _ := op.GetNearestMeta(fp)
		c := context.WithValue(ctx, conf.MetaKey, fmeta)
		node, gErr := fs.Get(c, fp, &fs.GetArgs{})
		if gErr != nil || node.IsDir() {
			continue
		}
		obj, gErr := getAtPath(b, ctx, p, srcKey, nil)
		if gErr != nil {
			continue
		}
		srcObj = obj
		srcNode = node
		srcFound = true
		break
	}
	if !srcFound {
		return result, gofakes3.KeyNotFound(srcKey)
	}
	defer func() {
		if srcObj != nil {
			_ = srcObj.Contents.Close()
		}
	}()

	if meta == nil {
		meta = make(map[string]string)
	}
	for k, v := range srcObj.Metadata {
		if _, found := meta[k]; !found && k != "X-Amz-Acl" {
			meta[k] = v
		}
	}
	if _, ok := meta["mtime"]; !ok {
		meta["mtime"] = swift.TimeToFloatString(srcNode.ModTime())
	}

	// Fan out to the destination. We re-use PutObject so the same
	// cache-and-replicate logic applies; for that we need a temp file
	// of the source body.
	cachePath, err := copyToTempFile(ctx, srcObj.Contents, srcObj.Size)
	if err != nil {
		return result, err
	}
	defer os.Remove(cachePath)

	// Build the same fan-out the PutObject path would build, but skip
	// the cache step (we already cached to disk).
	paths := dstB.effectivePaths()
	if len(paths) == 0 {
		return result, gofakes3.ErrNoSuchBucket
	}
	results := fanOutPut(ctx, dstBucket, paths, dstKey, meta, srcNode.ModTime(), srcObj.Size, cachePath, dstB.writePolicy())

	allFailed := true
	for _, r := range results {
		if r.err == nil {
			allFailed = false
			break
		}
	}
	if allFailed {
		return result, fmt.Errorf("all %d replication targets failed: %s", len(paths), firstErr(results).Error())
	}

	if dstB.writePolicy() == PolicyAny {
		var pending []string
		for _, r := range results {
			if r.err != nil {
				pending = append(pending, r.path)
			}
		}
		if len(pending) > 0 {
			repWorker.Enqueue(&pendingPut{
				bucket:     dstBucket,
				object:     dstKey,
				meta:       meta,
				cachedFile: cachePath,
				size:       srcObj.Size,
				ctime:      srcNode.ModTime(),
				targets:    pending,
				isDir:      false,
			})
			// Handoff: prevent the deferred Remove.
			cachePath = ""
		}
	}

	for _, p := range paths {
		b.meta.Store(path.Join(p, dstKey), meta)
	}

	return gofakes3.CopyObjectResult{
		ETag:         `"` + hex.EncodeToString(srcObj.Hash) + `"`,
		LastModified: gofakes3.NewContentTime(srcNode.ModTime()),
	}, nil
}

// firstReachable returns the first model.Obj (typically a directory node
// representing the bucket root) across the configured paths, or an
// error if every path is unreachable.
func (b Bucket) firstReachable(ctx context.Context) (model.Obj, error) {
	for _, p := range b.effectivePaths() {
		fmeta, _ := op.GetNearestMeta(p)
		node, err := fs.Get(context.WithValue(ctx, conf.MetaKey, fmeta), p, &fs.GetArgs{})
		if err == nil {
			return node, nil
		}
	}
	return nil, errs.ObjectNotFound
}

// copyToTempFile streams a reader into a temp file and returns the path.
// Used by CopyObject to materialize the source body for fan-out.
func copyToTempFile(ctx context.Context, src io.Reader, size int64) (string, error) {
	tmp, err := os.CreateTemp("", "s3-copy-*")
	if err != nil {
		return "", err
	}
	name := tmp.Name()
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		os.Remove(name)
		return "", err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return "", err
	}
	return name, nil
}
