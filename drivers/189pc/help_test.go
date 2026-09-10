package _189pc

import (
	"testing"
	"time"
)

// TestTimeUnmarshal covers every 189cloud timestamp shape seen from the
// API: the plain datetime, the US 12-hour form, the comma-after-year
// variant, the Unicode narrow no-break / no-break space before the
// AM/PM marker, and quoted JSON strings.
func TestTimeUnmarshal(t *testing.T) {
	cst := time.FixedZone("+08", 8*3600)
	want := time.Date(2026, time.September, 10, 15, 45, 49, 0, cst)
	cases := []struct {
		name  string
		input string
		valid bool
	}{
		{"datetime", "2026-09-10 15:45:49", true},
		{"us-12h", "Sep 10, 2026 3:45:49 PM", true},
		{"us-12h-comma", "Sep 10, 2026, 3:45:49 PM", true},
		{"us-12h-nnbsp", "Sep 10, 2026, 3:45:49\u202fPM", true},
		{"us-12h-nbsp", "Sep 10, 2026, 3:45:49\u00a0PM", true},
		{"quoted-datetime", "\"2026-09-10 15:45:49\"", true},
		{"garbage", "not-a-time", false},
	}
	for _, c := range cases {
		var got Time
		err := got.Unmarshal([]byte(c.input))
		if !c.valid {
			if err == nil {
				t.Errorf("%s: expected error for %q, got nil", c.name, c.input)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: Unmarshal(%q) returned error: %v", c.name, c.input, err)
			continue
		}
		if !time.Time(got).Equal(want) {
			t.Errorf("%s: parsed %v, want %v", c.name, time.Time(got), want)
		}
	}
}
