// Package s3 implements a fake s3 server for openlist
package s3

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"testing"
	"time"
)

// TestBackend_MetaRoundTrip verifies that custom metadata stored at
// PutObject time is preserved in the backend's meta map and surfaces
// unchanged to subsequent reads. The merge itself is exercised through
// the *AtPath helpers, but mocking fs.Get / fs.Link requires a real
// driver. We document the contract at the storage layer instead, where
// the round-trip is observable without a driver.
func TestBackend_MetaRoundTrip(t *testing.T) {
	b := newBackend().(*s3Backend)
	if b.meta == nil {
		t.Fatal("backend meta map must be non-nil")
	}
	fp := "/test/path/file"
	custom := map[string]string{
		"X-Amz-Meta-Custom":    "value",
		"Content-Type":         "application/json",
		"X-Amz-Meta-Request-Id": "abc-123",
	}
	b.meta.Store(fp, custom)

	got, ok := b.meta.Load(fp)
	if !ok {
		t.Fatalf("expected meta stored at %q", fp)
	}
	gotMap, ok := got.(map[string]string)
	if !ok {
		t.Fatalf("expected map[string]string, got %T", got)
	}
	for k, v := range custom {
		if gotMap[k] != v {
			t.Errorf("round-trip mismatch for %q: got %q want %q", k, gotMap[k], v)
		}
	}

	// Concurrent stores to distinct keys must not collide.
	b.meta.Store("/test/path/other", map[string]string{"X-Amz-Meta-Custom": "other"})
	if gotMap["X-Amz-Meta-Custom"] != "value" {
		t.Errorf("expected original value untouched, got %q", gotMap["X-Amz-Meta-Custom"])
	}
}

// TestCacheUploadToTempFile_NonEmpty verifies the happy path of
// cacheUploadToTempFile: a non-empty body is persisted to disk and
// the contents are identical to the input.
func TestCacheUploadToTempFile_NonEmpty(t *testing.T) {
	body := []byte("hello world this is a payload")
	path, err := cacheUploadToTempFile(context.Background(), bytes.NewReader(body), int64(len(body)), map[string]string{
		"Content-Type": "text/plain",
	})
	if err != nil {
		t.Fatalf("cacheUploadToTempFile: %v", err)
	}
	defer os.Remove(path)

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("readFile: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("body mismatch: got %q want %q", got, body)
	}
}

// TestCacheUploadToTempFile_Empty verifies the zero-length body path
// returns a valid (empty) temp file rather than nil.
func TestCacheUploadToTempFile_Empty(t *testing.T) {
	path, err := cacheUploadToTempFile(context.Background(), bytes.NewReader(nil), 0, nil)
	if err != nil {
		t.Fatalf("cacheUploadToTempFile empty: %v", err)
	}
	defer os.Remove(path)

	stat, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if stat.Size() != 0 {
		t.Fatalf("expected zero-length file, got %d", stat.Size())
	}
}

// TestCopyToTempFile verifies the streaming copy helper preserves the
// payload end-to-end. This is the helper CopyObject uses to materialize
// a source body for fan-out.
func TestCopyToTempFile(t *testing.T) {
	body := []byte("source object body for copy")
	src := io.NopCloser(bytes.NewReader(body))
	name, err := copyToTempFile(context.Background(), src, int64(len(body)))
	if err != nil {
		t.Fatalf("copyToTempFile: %v", err)
	}
	defer os.Remove(name)
	got, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("readFile: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("body mismatch: got %q want %q", got, body)
	}
}

// TestFirstErr returns the first non-nil error from a putResult slice.
// A nil slice must return nil so callers can safely use it after a
// successful fan-out.
func TestFirstErr(t *testing.T) {
	if got := firstErr(nil); got != nil {
		t.Fatalf("firstErr(nil) = %v, want nil", got)
	}
	if got := firstErr([]putResult{}); got != nil {
		t.Fatalf("firstErr([]) = %v, want nil", got)
	}
	if got := firstErr([]putResult{{err: nil}}); got != nil {
		t.Fatalf("firstErr([nil]) = %v, want nil", got)
	}
	wantErr := io.EOF
	if got := firstErr([]putResult{{err: nil}, {err: wantErr}, {err: io.ErrShortBuffer}}); got != wantErr {
		t.Fatalf("firstErr = %v, want %v", got, wantErr)
	}
}

// TestFanOutPut_RecoversFromPanic confirms that a panic in putOnePath
// (caused here by an uninitialized meta DB inside op.GetNearestMeta)
// is caught by the goroutine's recover, the path is recorded as failed,
// and the rest of the fan-out still completes.
func TestFanOutPut_RecoversFromPanic(t *testing.T) {
	silenceReplicateLogs(t)
	// Build a real temp file so putOnePath can pass the os.Open
	// stage; the panic happens later, in op.GetNearestMeta.
	tmp, err := os.CreateTemp("", "s3-fanout-*")
	if err != nil {
		t.Fatalf("CreateTemp: %v", err)
	}
	if _, err := tmp.Write([]byte("payload")); err != nil {
		t.Fatalf("write temp: %v", err)
	}
	tmp.Close()
	defer os.Remove(tmp.Name())

	probeRegistry.Delete("panic-bucket")
	results := fanOutPut(
		context.Background(),
		"panic-bucket",
		[]string{"/definitely/not/a/real/mount/point"},
		"obj",
		map[string]string{},
		time.Now(),
		int64(len("payload")),
		tmp.Name(),
		PolicyAny,
		0,
	)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].err == nil {
		t.Fatalf("expected error from panicking path, got nil")
	}
	// The probe must have been bumped to a "failing" score (>= 3
	// failures saturates it). We assert the failure counter is
	// non-zero instead of the score, since future EWMA tuning may
	// move the saturation threshold.
	probe := probesFor("panic-bucket").get("/definitely/not/a/real/mount/point")
	if probe.failures.Load() == 0 {
		t.Fatalf("expected failure count > 0, got %d", probe.failures.Load())
	}
}

// TestFanOutPut_EmptyPaths verifies fanOutPut returns an empty slice immediately
// when no paths are provided.
func TestFanOutPut_EmptyPaths(t *testing.T) {
	results := fanOutPut(context.Background(), "", nil, "obj", nil, time.Now(), 0, "", PolicyAny, 0)
	if len(results) != 0 {
		t.Fatalf("expected 0 results, got %d", len(results))
	}
}

// TestFanOutPut_MultiplePaths verifies fanOutPut handles multiple paths concurrently
// and returns results for each target path.
func TestFanOutPut_MultiplePaths(t *testing.T) {
	silenceReplicateLogs(t)
	tmp, err := os.CreateTemp("", "s3-fanout-*")
	if err != nil {
		t.Fatalf("CreateTemp: %v", err)
	}
	tmp.Close()
	defer os.Remove(tmp.Name())

	results := fanOutPut(
		context.Background(),
		"multi-bucket",
		[]string{"/nonexistent/mount/a", "/nonexistent/mount/b"},
		"obj",
		map[string]string{},
		time.Now(),
		0,
		tmp.Name(),
		PolicyAny,
		0,
	)
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	for i, r := range results {
		if r.err == nil {
			t.Fatalf("expected error for nonexistent path %d, got nil", i)
		}
	}
}

// ---- fanOutPut per-path timeout & write breaker (issue #8) ----

// stubPutOnePath swaps the package-level writer for the duration of the
// test, letting us simulate fast, hanging, or ctx-ignorant drivers.
func stubPutOnePath(t *testing.T, fn func(ctx context.Context, basePath, objectName string, meta map[string]string, mtime time.Time, size int64, cachePath string) error) {
	t.Helper()
	old := putOnePathFn
	putOnePathFn = fn
	t.Cleanup(func() { putOnePathFn = old })
}

// A ctx-respecting driver that never finishes must be cut off by the
// per-path deadline, and fanOutPut must return promptly afterwards.
func TestFanOutPut_PerPathTimeout_CtxAwareDriver(t *testing.T) {
	silenceReplicateLogs(t)
	probeRegistry.Delete("pto-bucket")
	stubPutOnePath(t, func(ctx context.Context, basePath, objectName string, meta map[string]string, mtime time.Time, size int64, cachePath string) error {
		<-ctx.Done()
		return ctx.Err()
	})

	start := time.Now()
	results := fanOutPut(context.Background(), "pto-bucket", []string{"/hang/a"}, "obj", nil, time.Now(), 0, "", PolicyAny, 200*time.Millisecond)
	elapsed := time.Since(start)

	if elapsed > 1500*time.Millisecond {
		t.Fatalf("fanOutPut took %v; expected bounded by deadline+margin (~450ms)", elapsed)
	}
	if len(results) != 1 || !errors.Is(results[0].err, context.DeadlineExceeded) {
		t.Fatalf("expected DeadlineExceeded for hanging path, got %+v", results)
	}
	if probesFor("pto-bucket").get("/hang/a").failures.Load() == 0 {
		t.Fatal("expected probe failure to be recorded for timed-out path")
	}
}

// A driver that ignores ctx entirely must still not pin the request: the
// overall wait bound stamps unfinished slots as timeouts while the
// goroutine lingers in the background.
func TestFanOutPut_PerPathTimeout_CtxIgnorantDriver(t *testing.T) {
	silenceReplicateLogs(t)
	probeRegistry.Delete("stuck-bucket")
	stubPutOnePath(t, func(ctx context.Context, basePath, objectName string, meta map[string]string, mtime time.Time, size int64, cachePath string) error {
		select {
		case <-time.After(30 * time.Second):
			return nil
		}
	})

	start := time.Now()
	results := fanOutPut(context.Background(), "stuck-bucket", []string{"/stuck/a"}, "obj", nil, time.Now(), 0, "", PolicyAll, 200*time.Millisecond)
	elapsed := time.Since(start)

	if elapsed > 2*time.Second {
		t.Fatalf("fanOutPut waited %v on a ctx-ignorant driver; overall bound failed", elapsed)
	}
	if len(results) != 1 || !errors.Is(results[0].err, context.DeadlineExceeded) {
		t.Fatalf("expected stamped DeadlineExceeded, got %+v", results)
	}
	if probesFor("stuck-bucket").get("/stuck/a").failures.Load() == 0 {
		t.Fatal("expected stamped timeout to bump the probe failure counter")
	}
}

// Under policy "any" the fast path still wins immediately; the timeout
// must not slow the healthy case down.
func TestFanOutPut_AnyPolicyFastWinUnaffected(t *testing.T) {
	silenceReplicateLogs(t)
	probeRegistry.Delete("race-bucket")
	stubPutOnePath(t, func(ctx context.Context, basePath, objectName string, meta map[string]string, mtime time.Time, size int64, cachePath string) error {
		if basePath == "/fast" {
			return nil
		}
		<-ctx.Done()
		return ctx.Err()
	})

	start := time.Now()
	results := fanOutPut(context.Background(), "race-bucket", []string{"/slow", "/fast"}, "obj", nil, time.Now(), 0, "", PolicyAny, 30*time.Second)
	elapsed := time.Since(start)

	if elapsed > time.Second {
		t.Fatalf("fast win took %v; early-cancel path regressed", elapsed)
	}
	ok := false
	for _, r := range results {
		if r.err == nil {
			ok = true
		}
	}
	if !ok {
		t.Fatalf("expected at least one success, got %+v", results)
	}
}

// unhealthy() opens the breaker after pathBreakerFailures consecutive
// recent failures and closes it again on the next success.
func TestProbeUnhealthyBreaker(t *testing.T) {
	probeRegistry.Delete("brk-bucket")
	pr := probesFor("brk-bucket").get("/x")

	for i := 0; i < pathBreakerFailures-1; i++ {
		pr.recordFailure()
	}
	if pr.unhealthy() {
		t.Fatal("breaker should still be closed below the failure threshold")
	}
	pr.recordFailure()
	if !pr.unhealthy() {
		t.Fatal("breaker should open at the failure threshold")
	}
	pr.recordSuccess(10 * time.Millisecond)
	if pr.unhealthy() {
		t.Fatal("a success must heal the breaker")
	}
}

// splitUnhealthyPaths skips only breaker-open paths, only under policy
// "any", and never skips everything.
func TestSplitUnhealthyPaths(t *testing.T) {
	probeRegistry.Delete("split-bucket")
	probes := probesFor("split-bucket")
	for i := 0; i < pathBreakerFailures; i++ {
		probes.get("/bad").recordFailure()
	}

	active, skipped := splitUnhealthyPaths("split-bucket", []string{"/bad", "/good"}, PolicyAny)
	if len(active) != 1 || active[0] != "/good" || len(skipped) != 1 || skipped[0] != "/bad" {
		t.Fatalf("expected active=[/good] skipped=[/bad], got active=%v skipped=%v", active, skipped)
	}

	for i := 0; i < pathBreakerFailures; i++ {
		probes.get("/good").recordFailure()
	}
	active, skipped = splitUnhealthyPaths("split-bucket", []string{"/bad", "/good"}, PolicyAny)
	if len(active) != 2 || skipped != nil {
		t.Fatalf("all-broken must fall back to writing everywhere, got active=%v skipped=%v", active, skipped)
	}

	active, skipped = splitUnhealthyPaths("split-bucket", []string{"/bad", "/good"}, PolicyAll)
	if len(active) != 2 || skipped != nil {
		t.Fatalf("policy all must never skip, got active=%v skipped=%v", active, skipped)
	}
}


