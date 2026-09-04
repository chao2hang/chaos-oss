// Package s3 implements a fake s3 server for openlist
package s3

import (
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func init() {
	dB, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		panic("failed to connect database")
	}
	conf.Conf = conf.DefaultConfig("data")
	db.Init(dB)
}

// setTestKeys replaces the key store contents for a test and restores
// an empty store afterwards.
func setTestKeys(t *testing.T, keys map[string]*model.S3AccessKey) {
	t.Helper()
	s3KeyStore.mu.Lock()
	old := s3KeyStore.keys
	s3KeyStore.keys = keys
	s3KeyStore.mu.Unlock()
	t.Cleanup(func() {
		s3KeyStore.mu.Lock()
		s3KeyStore.keys = old
		s3KeyStore.mu.Unlock()
	})
}

// setAnonymousAllowed toggles the anonymous-access opt-in through the
// setting cache so no database round trip is required.
func setAnonymousAllowed(t *testing.T, allowed bool) {
	t.Helper()
	v := "false"
	if allowed {
		v = "true"
	}
	op.Cache.SetSetting(conf.S3AllowAnonymousAccess, &model.SettingItem{
		Key:   conf.S3AllowAnonymousAccess,
		Value: v,
	})
	t.Cleanup(func() {
		op.Cache.SetSetting(conf.S3AllowAnonymousAccess, &model.SettingItem{
			Key:   conf.S3AllowAnonymousAccess,
			Value: "false",
		})
	})
}

// newGatekeptHandler wraps a recording next handler with the
// gatekeeper middleware under test.
func newGatekeptHandler(nextCalled *bool) http.Handler {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*nextCalled = true
		w.WriteHeader(http.StatusOK)
	})
	return gatekeeper(next)
}

func doRequest(t *testing.T, h http.Handler, method, target, authorization, remoteAddr string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	if remoteAddr != "" {
		req.RemoteAddr = remoteAddr
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// parseS3Error asserts that the body is well-formed XML and returns
// the decoded error.
func parseS3Error(t *testing.T, body []byte) s3XMLError {
	t.Helper()
	var xe s3XMLError
	if err := xml.Unmarshal(body, &xe); err != nil {
		t.Fatalf("error response is not parseable XML: %v; body=%q", err, body)
	}
	return xe
}

func TestGatekeeperNoKeysDeniesByDefault(t *testing.T) {
	setTestKeys(t, map[string]*model.S3AccessKey{})
	setAnonymousAllowed(t, false)
	nextCalled := false
	h := newGatekeptHandler(&nextCalled)

	rec := doRequest(t, h, http.MethodGet, "/bucket/obj", "", "127.0.0.1:1234")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
	if nextCalled {
		t.Fatal("next handler must not run when no keys are configured")
	}
	xe := parseS3Error(t, rec.Body.Bytes())
	if xe.Code != "AccessDenied" {
		t.Fatalf("expected AccessDenied, got %q", xe.Code)
	}
}

func TestGatekeeperNoKeysAllowsAnonymousOptIn(t *testing.T) {
	setTestKeys(t, map[string]*model.S3AccessKey{})
	setAnonymousAllowed(t, true)
	nextCalled := false
	h := newGatekeptHandler(&nextCalled)

	rec := doRequest(t, h, http.MethodGet, "/bucket/obj", "", "127.0.0.1:1234")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with anonymous opt-in, got %d", rec.Code)
	}
	if !nextCalled {
		t.Fatal("next handler must run when anonymous access is enabled")
	}
}

func TestGatekeeperInvalidKeyDenied(t *testing.T) {
	setTestKeys(t, map[string]*model.S3AccessKey{
		"AKID1": {ID: 1, AccessKey: "AKID1", SecretKey: "sk", Enabled: true},
	})
	setAnonymousAllowed(t, false)
	nextCalled := false
	h := newGatekeptHandler(&nextCalled)

	// no credentials at all
	rec := doRequest(t, h, http.MethodGet, "/bucket/obj", "", "127.0.0.1:1234")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for missing credentials, got %d", rec.Code)
	}
	// unknown access key id
	rec = doRequest(t, h, http.MethodGet, "/bucket/obj",
		"AWS4-HMAC-SHA256 Credential=WRONG/20260101/us-east-1/s3/aws4_request", "127.0.0.1:1234")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for unknown key, got %d", rec.Code)
	}
	if nextCalled {
		t.Fatal("next handler must not run for invalid keys")
	}
}

func TestGatekeeperValidKeyAllowed(t *testing.T) {
	setTestKeys(t, map[string]*model.S3AccessKey{
		"AKID1": {ID: 1, AccessKey: "AKID1", SecretKey: "sk", Enabled: true},
	})
	setAnonymousAllowed(t, false)
	nextCalled := false
	h := newGatekeptHandler(&nextCalled)

	rec := doRequest(t, h, http.MethodGet, "/bucket/obj",
		"AWS4-HMAC-SHA256 Credential=AKID1/20260101/us-east-1/s3/aws4_request", "127.0.0.1:1234")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid key, got %d; body=%q", rec.Code, rec.Body.String())
	}
	if !nextCalled {
		t.Fatal("next handler must run for a valid key")
	}
}

func TestGatekeeperReadOnlyKeyDeniesWrite(t *testing.T) {
	setTestKeys(t, map[string]*model.S3AccessKey{
		"AKRO": {ID: 2, AccessKey: "AKRO", SecretKey: "sk", Enabled: true, ReadOnly: true},
	})
	setAnonymousAllowed(t, false)
	nextCalled := false
	h := newGatekeptHandler(&nextCalled)

	authz := "AWS4-HMAC-SHA256 Credential=AKRO/20260101/us-east-1/s3/aws4_request"
	for _, m := range []string{http.MethodPut, http.MethodPost, http.MethodDelete} {
		rec := doRequest(t, h, m, "/bucket/obj", authz, "127.0.0.1:1234")
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s with read-only key: expected 403, got %d", m, rec.Code)
		}
	}
	if nextCalled {
		t.Fatal("next handler must not run for a write on a read-only key")
	}

	rec := doRequest(t, h, http.MethodGet, "/bucket/obj", authz, "127.0.0.1:1234")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET with read-only key: expected 200, got %d", rec.Code)
	}
}

func TestGatekeeperBucketScope(t *testing.T) {
	setTestKeys(t, map[string]*model.S3AccessKey{
		"AKSC": {ID: 3, AccessKey: "AKSC", SecretKey: "sk", Enabled: true, Buckets: "bucket-a"},
	})
	setAnonymousAllowed(t, false)
	nextCalled := false
	h := newGatekeptHandler(&nextCalled)

	authz := "AWS4-HMAC-SHA256 Credential=AKSC/20260101/us-east-1/s3/aws4_request"

	// allowed bucket
	rec := doRequest(t, h, http.MethodGet, "/bucket-a/obj", authz, "127.0.0.1:1234")
	if rec.Code != http.StatusOK {
		t.Fatalf("scoped bucket: expected 200, got %d", rec.Code)
	}
	if !nextCalled {
		t.Fatal("next handler must run for an allowed bucket")
	}

	// other bucket
	rec = doRequest(t, h, http.MethodGet, "/bucket-b/obj", authz, "127.0.0.1:1234")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("out-of-scope bucket: expected 403, got %d", rec.Code)
	}

	// ListBuckets would leak other bucket names
	rec = doRequest(t, h, http.MethodGet, "/", authz, "127.0.0.1:1234")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("ListBuckets with scoped key: expected 403, got %d", rec.Code)
	}
}

func TestGatekeeperIPAllowlist(t *testing.T) {
	setTestKeys(t, map[string]*model.S3AccessKey{
		"AKIP": {ID: 4, AccessKey: "AKIP", SecretKey: "sk", Enabled: true, IPAllowlist: "10.0.0.0/8, 192.168.0.1"},
	})
	setAnonymousAllowed(t, false)
	nextCalled := false
	h := newGatekeptHandler(&nextCalled)

	authz := "AWS4-HMAC-SHA256 Credential=AKIP/20260101/us-east-1/s3/aws4_request"

	// inside CIDR
	rec := doRequest(t, h, http.MethodGet, "/bucket/obj", authz, "10.1.2.3:5678")
	if rec.Code != http.StatusOK {
		t.Fatalf("allowed CIDR: expected 200, got %d", rec.Code)
	}
	// exact IP entry
	rec = doRequest(t, h, http.MethodGet, "/bucket/obj", authz, "192.168.0.1:5678")
	if rec.Code != http.StatusOK {
		t.Fatalf("exact allowed IP: expected 200, got %d", rec.Code)
	}
	// outside allowlist
	nextCalled = false
	rec = doRequest(t, h, http.MethodGet, "/bucket/obj", authz, "8.8.8.8:5678")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("disallowed IP: expected 403, got %d", rec.Code)
	}
	if nextCalled {
		t.Fatal("next handler must not run for a disallowed IP")
	}
}

func TestS3ErrorXMLEscaping(t *testing.T) {
	cases := []struct {
		code    string
		message string
	}{
		{"AccessDenied", "bad <xml> & \"chars\""},
		{"NoSuchBucket", `bucket <b> & 'quoted' does not exist`},
		{"InvalidArgument", "1 < 2 > 0 & 3 == 3"},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		s3Error(rec, tc.code, tc.message, http.StatusForbidden)

		if ct := rec.Header().Get("Content-Type"); ct != "application/xml" {
			t.Fatalf("expected application/xml content type, got %q", ct)
		}
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected status 403, got %d", rec.Code)
		}
		body := rec.Body.Bytes()
		// must be well-formed and round-trip the exact values
		xe := parseS3Error(t, body)
		if xe.Code != tc.code || xe.Message != tc.message {
			t.Fatalf("round-trip mismatch: got code=%q message=%q; want code=%q message=%q",
				xe.Code, xe.Message, tc.code, tc.message)
		}
		// raw special characters must not appear unescaped in the body
		if strings.Contains(rec.Body.String(), "<xml>") ||
			strings.Contains(rec.Body.String(), "<b>") {
			t.Fatalf("unescaped markup leaked into error response: %q", rec.Body.String())
		}
	}
}

func TestDenyRecordsForbidden(t *testing.T) {
	start := time.Now()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/bucket/obj", nil)
	req.RemoteAddr = "127.0.0.1:1234"

	deny(rec, req, "AKID-x", "denied & <escaped>", start)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
	xe := parseS3Error(t, rec.Body.Bytes())
	if xe.Code != "AccessDenied" || xe.Message != "denied & <escaped>" {
		t.Fatalf("unexpected deny payload: code=%q message=%q", xe.Code, xe.Message)
	}
}
