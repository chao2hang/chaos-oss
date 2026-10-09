// Credits: https://pkg.go.dev/github.com/rclone/rclone@v1.65.2/cmd/serve/s3
// Package s3 implements a fake s3 server for openlist
package s3

import (
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
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

// TestReplicationBudgetsScaleWithSize pins the size-aware budgets from
// issue #9: the base is the configured grace (default 30 s with no
// settings DB), the allowance assumes 1 MiB/s and caps at 10 minutes.
func TestReplicationBudgetsScaleWithSize(t *testing.T) {
	if got := sizeAllowance(0); got != 0 {
		t.Fatalf("sizeAllowance(0) = %v, want 0", got)
	}
	if got := sizeAllowance(100 << 20); got != 100*time.Second {
		t.Fatalf("sizeAllowance(100MiB) = %v, want 100s", got)
	}
	if got := sizeAllowance(5 << 30); got != 600*time.Second {
		t.Fatalf("sizeAllowance(5GiB) = %v, want 600s cap", got)
	}
	grace := replicationGrace()
	if grace != 30*time.Second {
		t.Fatalf("default replicationGrace() = %v, want 30s", grace)
	}
	if got := attemptTimeout(100 << 20); got != 130*time.Second {
		t.Fatalf("attemptTimeout(100MiB) = %v, want 130s", got)
	}
	if got := backgroundBudget(100 << 20); got != 160*time.Second {
		t.Fatalf("backgroundBudget(100MiB) = %v, want 160s", got)
	}
	// Small objects keep the old snappy behavior.
	if got := backgroundBudget(0); got != 60*time.Second {
		t.Fatalf("backgroundBudget(0) = %v, want 60s", got)
	}
}

// TestProcessWithGrace_BudgetAllowsRetry verifies a failing target keeps
// getting retries within the provided budget (instead of being killed by
// a hard 30 s attempt cap), and that the DATA LOSS bookwriting (temp
// file removal + retained targets) still happens when the budget ends.
func TestProcessWithGrace_BudgetAllowsRetry(t *testing.T) {
	silenceReplicateLogs(t)
	var attempts int32
	old := replicateAttemptFn
	replicateAttemptFn = func(w *replicationWorker, p *pendingPut, target string) error {
		atomic.AddInt32(&attempts, 1)
		time.Sleep(50 * time.Millisecond)
		return errors.New("simulated slow failure")
	}
	t.Cleanup(func() { replicateAttemptFn = old })

	tmp := tempFileWithContent(t, []byte("payload"))
	w := newTestWorker()
	p := &pendingPut{
		bucket:     "budget-bucket",
		object:     "o",
		meta:       map[string]string{},
		cachedFile: tmp,
		size:       42,
		ctime:      time.Now(),
		targets:    []string{"/fake/target"},
	}
	start := time.Now()
	// Budget larger than one attempt + the 500 ms first backoff so the
	// loop must reach a second attempt, but short enough to be quick.
	w.processWithGrace(p, 1200*time.Millisecond)
	elapsed := time.Since(start)

	if got := atomic.LoadInt32(&attempts); got < 2 {
		t.Fatalf("expected at least 2 attempts within the budget, got %d", got)
	}
	if elapsed > 3*time.Second {
		t.Fatalf("processWithGrace overran its budget: %v", elapsed)
	}
	if _, err := os.Stat(tmp); !os.IsNotExist(err) {
		t.Fatal("temp file must be removed when the budget expires")
	}
	if len(p.targets) != 1 {
		t.Fatalf("failing target must be retained for the DATA LOSS log, got %d", len(p.targets))
	}
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
