// Credits: https://pkg.go.dev/github.com/rclone/rclone@v1.65.2/cmd/serve/s3
// Package s3 implements a fake s3 server for openlist
package s3

import (
	"context"
	"io"
	"os"
	"path"
	"runtime/debug"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/internal/stream"
	log "github.com/sirupsen/logrus"
)

// pendingPut represents an upload that needs (or may benefit from) a
// background retry on one or more target paths. The data has already been
// cached to a local temp file, so retries are cheap.
type pendingPut struct {
	bucket string
	object string // S3 object name, joined with the bucket path
	meta   map[string]string
	// cachedFile is the on-disk temp file holding the upload body. It is
	// deleted once all targets have been written successfully (or the
	// retry budget is exhausted).
	cachedFile string
	size       int64
	ctime      time.Time
	// targets are the paths that still need to receive the upload.
	targets []string
	// isDir marks trailing-slash placeholder uploads so the worker can
	// replicate the mkdir too.
	isDir bool
}

// replicationWorker drains pendingPut items and re-issues fs.PutDirectly
// calls for any failed targets, with exponential backoff. It also tracks
// in-flight items so the upload path can hand off cleanup responsibility.
type replicationWorker struct {
	queue chan *pendingPut
	wg    sync.WaitGroup
	mu    sync.Mutex
	stop  chan struct{}
	once  sync.Once
}

var repWorker = &replicationWorker{
	queue: make(chan *pendingPut, 1024),
	stop:  make(chan struct{}),
}

// Start launches the background replication worker. It is safe to call
// multiple times; only the first call starts the goroutine.
func (w *replicationWorker) Start() {
	w.once.Do(func() {
		w.wg.Add(1)
		go w.run()
	})
}

// Stop signals the worker to drain the queue and exit. Pending items are
// processed with a short grace period; after that the temp files are
// removed even if some paths were never reached.
func (w *replicationWorker) Stop() {
	select {
	case <-w.stop:
		return
	default:
		close(w.stop)
	}
	w.wg.Wait()
}

// Enqueue schedules a pending put for background replication. The temp
// file ownership is transferred to the worker; the upload path must not
// delete it itself once it returns.
// ReplicationQueueDepth reports how many replication retries are
// pending (observability).
func ReplicationQueueDepth() int {
	return len(repWorker.queue)
}

func (w *replicationWorker) Cancel(bucket, object string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	// Drain matching items from queue
	n := len(w.queue)
	for i := 0; i < n; i++ {
		select {
		case p := <-w.queue:
			if p.bucket == bucket && p.object == object {
				_ = os.Remove(p.cachedFile)
			} else {
				w.queue <- p
			}
		default:
			break
		}
	}
}

func (w *replicationWorker) Enqueue(p *pendingPut) {
	if p == nil || len(p.targets) == 0 {
		if p != nil {
			_ = os.Remove(p.cachedFile)
		}
		return
	}
	w.Start()
	select {
	case w.queue <- p:
	case <-w.stop:
		_ = os.Remove(p.cachedFile)
	}
}

func (w *replicationWorker) run() {
	defer wgRecover(&w.wg)
	defer w.wg.Done()
	for {
		select {
		case <-w.stop:
			// drain remaining items with a short grace period
			for {
				select {
				case p := <-w.queue:
					w.processWithGrace(p, 2*time.Second)
				default:
					return
				}
			}
		case p := <-w.queue:
			w.processWithGrace(p, replicationGrace())
		}
	}
}

// wgRecover is a helper that turns a panic in the worker goroutine into
// a logged error instead of crashing the process. The temp file
// ownership of the in-flight pendingPut stays with the worker and is
// cleaned up by processWithGrace's own defer chain.
func wgRecover(wg *sync.WaitGroup) {
	if r := recover(); r != nil {
		log.Errorf("[s3-replicate] worker goroutine panicked: %v\n%s", r, debug.Stack())
		// wg.Done is in the caller's defer; this defer is registered
		// first, so wg.Done still runs after we return.
		_ = wg
	}
}

// replicationGrace returns the configured background retry grace period
// (clamped to a sensible range). Operators tune this in the admin UI
// to balance fast failure reporting against retry tolerance.
func replicationGrace() time.Duration {
	v := setting.GetInt(conf.S3ReplicationGraceSeconds, 30)
	if v <= 0 {
		return 30 * time.Second
	}
	if v > 600 {
		v = 600
	}
	return time.Duration(v) * time.Second
}

// processWithGrace retries a single pending put with backoff and a
// soft deadline. When the deadline expires the remaining targets are
// dropped and the temp file is cleaned up. A panic from a faulty
// storage driver is caught and reported so the worker keeps draining
// the queue (and the temp file is still removed).
func (w *replicationWorker) processWithGrace(p *pendingPut, grace time.Duration) {
	defer func() {
		if r := recover(); r != nil {
			log.Errorf("[s3-replicate] panic while replicating bucket=%s object=%s: %v\n%s",
				p.bucket, p.object, r, debug.Stack())
		}
		// Always clean up the temp file: either the upload landed on
		// every path, the grace window expired, or the worker crashed.
		_ = os.Remove(p.cachedFile)
	}()
	deadline := time.Now().Add(grace)
	backoff := 500 * time.Millisecond
	const maxBackoff = 30 * time.Second
	for len(p.targets) > 0 && time.Now().Before(deadline) {
		select {
		case <-w.stop:
			// hard shutdown: do not retry, but still clean up
			p.targets = nil
		default:
		}
		if len(p.targets) == 0 {
			break
		}
		remaining := p.targets[:0]
		for _, target := range p.targets {
			if err := w.attempt(p, target); err != nil {
				logf("background replicate to %s failed: %v (will retry)", target, err)
				remaining = append(remaining, target)
			} else {
				logf("background replicate to %s succeeded", target)
			}
		}
		p.targets = remaining
		if len(p.targets) == 0 {
			break
		}
		// wait before next round
		select {
		case <-time.After(backoff):
		case <-w.stop:
			p.targets = nil
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
	if len(p.targets) > 0 {
		// Surface the data-loss window to operators: clients got a
		// successful PUT response, but these targets never received
		// the object. The temp file is now gone, so the only recovery
		// path is re-uploading manually.
		log.Errorf("[s3-replicate] DATA LOSS: bucket=%s object=%s size=%d: %d path(s) still missing after grace=%s: %v",
			p.bucket, p.object, p.size, len(p.targets), grace, p.targets)
	}
}

// attempt performs a single background put against the given target path.
// The file is streamed from the cached temp file.
func (w *replicationWorker) attempt(p *pendingPut, target string) error {
	ctx := context.Background()
	fmeta, _ := op.GetNearestMeta(target)
	ctx = context.WithValue(ctx, conf.MetaKey, fmeta)
	ctx = context.WithValue(ctx, conf.SkipHookKey, struct{}{})

	fp := path.Join(target, p.object)
	var reqPath string
	if p.isDir {
		reqPath = fp + "/"
	} else {
		reqPath = path.Dir(fp)
	}
	// Ensure the parent directory exists; best effort.
	if _, err := fs.Get(ctx, reqPath, &fs.GetArgs{}); err != nil {
		if !errs.IsObjectNotFound(err) {
			// not a missing path: skip mkdir and let Put fail
		} else {
			if mkErr := fs.MakeDir(ctx, reqPath); mkErr != nil {
				return mkErr
			}
		}
	}
	if p.isDir {
		return nil
	}
	f, err := os.Open(p.cachedFile)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	obj := &stream.FileStream{
		Obj: &model.Object{
			Name:     path.Base(fp),
			Size:     p.size,
			Modified: p.ctime,
			Ctime:    p.ctime,
			IsFolder: false,
		},
		Reader:   f,
		Mimetype: p.meta["Content-Type"],
	}
	return fs.PutDirectly(ctx, reqPath, obj, true)
}
