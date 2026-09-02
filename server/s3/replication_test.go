// Credits: https://pkg.go.dev/github.com/rclone/rclone@v1.65.2/cmd/serve/s3
// Package s3 implements a fake s3 server for openlist
package s3

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	log "github.com/sirupsen/logrus"
)

func TestPendingPut_RequiresTargets(t *testing.T) {
	tmp := tempFileWithContent(t, []byte("hi"))
	// Use a fresh local worker so this test (and any test that
	// follows) doesn't poison the package-global repWorker, which is
	// stopped exactly once via sync.Once.
	w := newTestWorker()
	w.Enqueue(&pendingPut{cachedFile: tmp, size: 2, targets: nil})
	w.Enqueue(&pendingPut{cachedFile: tmp, size: 2, targets: []string{}})
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Fatalf("temp file should be removed when no targets: %v", err)
	}
}

// TestPendingPut_StopsOnShutdown ensures the worker honors the stop
// signal and does not block forever on an empty queue. It uses a local
// worker so it does not consume the package-global repWorker's
// one-shot sync.Once.
func TestPendingPut_StopsOnShutdown(t *testing.T) {
	// Smoke: start the worker, then stop it. We don't push anything
	// onto the queue, so the stop signal must be observed promptly.
	w := newTestWorker()
	w.Start()
	done := make(chan struct{})
	go func() {
		w.Stop()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("replicationWorker.Stop() did not return within 3s")
	}
}

// TestWorkerEnqueue_TempFileHandoff verifies that the worker accepts
// ownership of the temp file (does not double-delete) and removes the
// file once it has nothing left to do. This is a black-box test that
// uses the Stop() drain path.
func TestWorkerEnqueue_TempFileHandoff(t *testing.T) {
	// Re-initialize worker so this test is independent of package init.
	w := newTestWorker()
	w.Start()
	tmp := tempFileWithContent(t, []byte("payload"))
	w.Enqueue(&pendingPut{
		bucket:     "b",
		object:     "o",
		meta:       map[string]string{},
		cachedFile: tmp,
		size:       7,
		ctime:      time.Now(),
		targets:    []string{}, // no work, file should be cleaned
	})
	w.Stop()
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Fatalf("expected temp file removed, stat err: %v", err)
	}
}

// newTestWorker builds a fresh replicationWorker suitable for tests
// that need to exercise the worker without touching the package-global
// repWorker (which has a sync.Once-protected Start/Stop).
func newTestWorker() *replicationWorker {
	return &replicationWorker{
		queue: make(chan *pendingPut, 16),
		stop:  make(chan struct{}),
	}
}

// TestPathProbe_EWMA verifies the smoothing math doesn't drift
// unexpectedly across many samples.
func TestPathProbe_EWMA(t *testing.T) {
	p := &pathProbe{}
	p.recordSuccess(100 * time.Millisecond) // first sample verbatim -> 100
	p.recordSuccess(100 * time.Millisecond) // 0.3 weight: (100*7 + 100*3)/10 = 100
	if got := p.score(); got != 100 {
		t.Fatalf("stable 100ms should stay at 100, got %d", got)
	}
	p.recordSuccess(200 * time.Millisecond) // (100*7 + 200*3)/10 = 130
	if got := p.score(); got != 130 {
		t.Fatalf("EWMA after 200ms should be 130, got %d", got)
	}
}

// TestProcessWithGrace_TempFileCleanedOnExpiry verifies the temp file
// is removed after the grace window expires, even when every target
// fails. The attempt path will fail because the targets don't resolve
// to a mounted driver; we just want to confirm the temp file goes
// away and the failing targets stay attached to the pendingPut so the
// "DATA LOSS" log entry can report them.
func TestProcessWithGrace_TempFileCleanedOnExpiry(t *testing.T) {
	silenceReplicateLogs(t)
	tmp := tempFileWithContent(t, []byte("payload"))
	w := newTestWorker()
	p := &pendingPut{
		bucket:     "b",
		object:     "o",
		meta:       map[string]string{},
		cachedFile: tmp,
		size:       7,
		ctime:      time.Now(),
		// /definitely/not/a/real/mount/point will fail fs.Get / mkdir
		// so the attempt loop never makes progress and the grace
		// window will expire.
		targets: []string{"/definitely/not/a/real/mount/point"},
	}
	w.processWithGrace(p, 50*time.Millisecond)
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Fatalf("temp file should be removed after grace expiry, stat err: %v", err)
	}
	// targets should still hold the failing path so the "DATA LOSS"
	// log line has something to report.
	if len(p.targets) != 1 {
		t.Fatalf("expected failing target retained for DATA LOSS log, got %d", len(p.targets))
	}
}

// TestProcessWithGrace_RecoversFromPanic verifies that a panic raised
// deep inside attempt() (e.g. an uninitialized meta DB) is caught by
// processWithGrace and does not propagate out of the worker; the temp
// file is still removed.
func TestProcessWithGrace_RecoversFromPanic(t *testing.T) {
	silenceReplicateLogs(t)
	tmp := tempFileWithContent(t, []byte("payload"))
	w := newTestWorker()
	p := &pendingPut{
		bucket:     "panic-bucket",
		object:     "panic-obj",
		meta:       map[string]string{},
		cachedFile: tmp,
		size:       0,
		ctime:      time.Now(),
		// /dev/null/... triggers the panic in op.GetNearestMeta (no
		// DB), which the recover() must catch.
		targets: []string{"/dev/null/this/cannot/be/created"},
	}
	// The function must return normally; if the panic propagated the
	// test would crash with a non-zero exit code.
	w.processWithGrace(p, 30*time.Millisecond)
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Fatalf("temp file should be removed even after attempt failures, stat err: %v", err)
	}
}

// silenceReplicateLogs redirects logrus output to /dev/null so tests
// that intentionally exercise error paths don't pollute the test log.
// Restores the previous output on test cleanup.
func silenceReplicateLogs(t *testing.T) {
	t.Helper()
	// logrus uses a global StandardLogger; we just bump its level to
	// Panic so Errorf calls during the test are dropped. This is
	// lighter-weight than swapping the output writer.
	prev := log.GetLevel()
	log.SetLevel(log.PanicLevel)
	t.Cleanup(func() { log.SetLevel(prev) })
}

func tempFileWithContent(t *testing.T, body []byte) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "cache")
	if err := os.WriteFile(p, body, 0o600); err != nil {
		t.Fatalf("write temp: %v", err)
	}
	return p
}
