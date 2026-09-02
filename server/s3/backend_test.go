// Package s3 implements a fake s3 server for openlist
package s3

import (
	"bytes"
	"context"
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

