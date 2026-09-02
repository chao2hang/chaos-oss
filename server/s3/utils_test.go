// Credits: https://pkg.go.dev/github.com/rclone/rclone@v1.65.2/cmd/serve/s3
// Package s3 implements a fake s3 server for openlist
package s3

import (
	"testing"
)

func TestBucketNormalize_LegacyPath(t *testing.T) {
	b := Bucket{Name: "backup", Path: "/disk1/bk"}
	got := b.normalized()
	if len(got.Paths) != 1 || got.Paths[0] != "/disk1/bk" {
		t.Fatalf("legacy Path not promoted: %+v", got)
	}
	if got.writePolicy() != PolicyAny {
		t.Fatalf("default policy should be any, got %q", got.writePolicy())
	}
}

func TestBucketNormalize_NewPaths(t *testing.T) {
	b := Bucket{
		Name:   "backup",
		Paths:  []string{"/d1/x", "/d2/x", "/d3/x"},
		Policy: PolicyAll,
	}
	got := b.normalized()
	if len(got.Paths) != 3 {
		t.Fatalf("expected 3 paths, got %d (%+v)", len(got.Paths), got.Paths)
	}
	if got.writePolicy() != PolicyAll {
		t.Fatalf("explicit Policy=lost: got %q", got.writePolicy())
	}
}

func TestBucketNormalize_DedupAndTrim(t *testing.T) {
	b := Bucket{
		Name:  "backup",
		Paths: []string{"  /d1/x  ", "/d1/x", "", "/d2/x", "/d2/x"},
	}
	got := b.normalized()
	if len(got.Paths) != 2 {
		t.Fatalf("expected dedup to 2 entries, got %d (%+v)", len(got.Paths), got.Paths)
	}
	if got.Paths[0] != "/d1/x" || got.Paths[1] != "/d2/x" {
		t.Fatalf("unexpected order/content: %+v", got.Paths)
	}
}

func TestBucketNormalize_EmptyGetsPolicy(t *testing.T) {
	b := Bucket{Name: "x", Paths: []string{"/d1"}}
	got := b.normalized()
	if got.Policy != PolicyAny {
		t.Fatalf("default policy not applied, got %q", got.Policy)
	}
}

// TestRankedPaths_FirstRequestUsesDefaultOrder verifies the first request
// for a brand-new bucket falls back to a stable ordering, since no probe
// data exists yet.
func TestRankedPaths_FirstRequestUsesDefaultOrder(t *testing.T) {
	b := Bucket{Name: "new", Paths: []string{"/c", "/a", "/b"}}
	// fresh probes for the bucket
	probeRegistry.Delete("new")
	got := rankedPaths(b)
	if len(got) != 3 {
		t.Fatalf("want 3 paths, got %d", len(got))
	}
	// All paths are unknown so they share the same default score and
	// the input order should be preserved.
	want := []string{"/c", "/a", "/b"}
	for i, p := range got {
		if p != want[i] {
			t.Fatalf("rankedPaths order broken at %d: want %q got %q", i, want[i], got)
		}
	}
}

// TestRankedPaths_PrefersLowLatency makes the /a path look fast and
// verifies it climbs to the front of the ranking after we feed the
// probes a few success samples.
func TestRankedPaths_PrefersLowLatency(t *testing.T) {
	probeRegistry.Delete("rank-test")
	b := Bucket{Name: "rank-test", Paths: []string{"/a", "/b", "/c"}}
	probes := probesFor("rank-test")
	for i := 0; i < 5; i++ {
		probes.get("/a").recordSuccess(10)   // 10ms
		probes.get("/b").recordSuccess(500)  // 500ms
		probes.get("/c").recordSuccess(2000) // 2s
	}
	got := rankedPaths(b)
	if got[0] != "/a" {
		t.Fatalf("expected /a first, got order %v", got)
	}
}

// TestRankedPaths_DemotesFailingPath ensures a path with three
// consecutive failures drops below the unknown default score (5000).
func TestRankedPaths_DemotesFailingPath(t *testing.T) {
	probeRegistry.Delete("demote")
	b := Bucket{Name: "demote", Paths: []string{"/bad", "/good"}}
	probes := probesFor("demote")
	// /good is a known fast path
	probes.get("/good").recordSuccess(20)
	// /bad keeps failing
	for i := 0; i < 5; i++ {
		probes.get("/bad").recordFailure()
	}
	got := rankedPaths(b)
	if got[0] != "/good" {
		t.Fatalf("expected /good to win over failing /bad, got order %v", got)
	}
}

// TestPathProbeScore_KnownVsUnknown documents the score math so future
// refactors don't drift silently.
func TestPathProbeScore_KnownVsUnknown(t *testing.T) {
	p := &pathProbe{}
	if got := p.score(); got != 5000 {
		t.Fatalf("unknown probe should score 5000, got %d", got)
	}
	p.recordSuccess(100)
	if got := p.score(); got > 200 {
		t.Fatalf("fresh 100ms sample should stay under 200, got %d", got)
	}
	for i := 0; i < 3; i++ {
		p.recordFailure()
	}
	if got := p.score(); got < 1<<62-2 {
		t.Fatalf("3 failures should saturate score, got %d", got)
	}
}
