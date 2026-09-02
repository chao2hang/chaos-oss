package _123_open

import (
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/drivers/base"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
)

var (
	AccessToken = "https://open-api.123pan.com/api/v1/access_token"
	// OAuthTokenURL is the open-platform OAuth token endpoint. It accepts
	// the standard authorization_code / refresh_token grants — unlike the
	// rest of the API it reads params from a form body, not JSON.
	OAuthTokenURL = "https://open-api.123pan.com/api/v1/oauth2/access_token"
)

// Public open-platform app credentials (Filmly Android client). Used to
// refresh tokens issued through the OAuth authorization flow when the
// user does not have their own developer client_id/secret.
const (
	oauthClientID     = "uch86homnvtpukbenxv06whun7oayymz"
	oauthClientSecret = "qxlth6oludklrutxxz8h4dh6jgicpe28"
	oauthRedirectURI  = "https://api.filmly.netease.com/a/v1/123pan/callback"
)

// OAuthTokenResp models the flat OAuth success response
// ({"token_type","access_token","refresh_token","expires_in"} at the top
// level per the API doc §2.3) and the OAuth-style error body. The nested
// envelope form is kept as a fallback.
type OAuthTokenResp struct {
	TokenType    string `json:"token_type"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`

	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`

	Data *OAuthTokenData `json:"data"`
}

// OAuthTokenData mirrors OAuthTokenResp for the nested envelope form.
type OAuthTokenData struct {
	TokenType    string `json:"token_type"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
}

// Effective returns whichever form carried a usable access token.
func (r *OAuthTokenResp) Effective() *OAuthTokenData {
	if r.Data != nil && r.Data.AccessToken != "" {
		return r.Data
	}
	return &OAuthTokenData{
		TokenType:    r.TokenType,
		AccessToken:  r.AccessToken,
		RefreshToken: r.RefreshToken,
		ExpiresIn:    r.ExpiresIn,
	}
}

func expiresInToExpiredAt(expiresIn int64) (time.Time, error) {
	if expiresIn <= 0 {
		return time.Time{}, errors.New("invalid expires_in from official API")
	}
	return time.Now().UTC().Add(time.Duration(expiresIn) * time.Second), nil
}

type tokenManager struct {
	// accessToken  string
	expiredAt    time.Time
	mu           sync.Mutex
	blockRefresh bool
}

func (d *Open123) getAccessToken(forceRefresh bool) (string, error) {
	tm := d.tm
	tm.mu.Lock()
	defer tm.mu.Unlock()
	if tm.blockRefresh {
		return "", errors.New("Authentication expired")
	}
	if !forceRefresh && d.AccessToken != "" && time.Now().Before(tm.expiredAt.Add(-5*time.Minute)) {
		return d.AccessToken, nil
	}
	if err := d.flushAccessToken(); err != nil {
		// token expired and failed to refresh, block further refresh attempts
		tm.blockRefresh = true
		return "", err
	}
	return d.AccessToken, nil
}

func (d *Open123) flushAccessToken() error {
	// OAuth refresh-token grant against the official endpoint. When the
	// stored refresh token was issued through the open-platform OAuth
	// flow (e.g. via the web UI's OAuth helper), this renews it directly
	// with 123 instead of relying on a third-party renewal service.
	// Failure falls through to the legacy paths below.
	if d.RefreshToken != "" {
		var resp OAuthTokenResp
		_, err := base.RestyClient.R().
			SetHeader("User-Agent", "Filmly/2.1.0-20100").
			SetFormData(map[string]string{
				"client_id":     oauthClientID,
				"client_secret": oauthClientSecret,
				"grant_type":    "refresh_token",
				"refresh_token": d.RefreshToken,
				"redirect_uri":  oauthRedirectURI,
			}).
			SetResult(&resp).
			Post(OAuthTokenURL)
		if err == nil {
			if data := resp.Effective(); data.AccessToken != "" {
				expiresIn := data.ExpiresIn
				if expiresIn <= 0 {
					// The endpoint sometimes reports 0; assume a conservative
					// 25-day lifetime so the cached token is used meanwhile.
					expiresIn = 25 * 24 * 3600
				}
				expiredAt, err := expiresInToExpiredAt(expiresIn)
				if err == nil {
					d.AccessToken = data.AccessToken
					if data.RefreshToken != "" {
						d.RefreshToken = data.RefreshToken
					}
					d.tm.expiredAt = expiredAt
					op.MustSaveDriverStorage(d)
					d.tm.blockRefresh = false
					return nil
				}
			}
		}
		// Fall through to the legacy renewal paths.
	}

	// Official app renewapi response contains access_token, refresh_token and expires_in.
	if d.UseOnlineAPI && d.RefreshToken != "" && len(d.APIAddress) > 0 {
		var resp RefreshTokenResp
		_, err := base.RestyClient.R().
			SetResult(&resp).
			SetQueryParams(map[string]string{
				"refresh_ui": d.RefreshToken,
				"server_use": "true",
				"driver_txt": "123cloud_oa",
			}).
			Get(d.APIAddress)
		if err != nil {
			return err
		}

		if resp.AccessToken == "" || resp.RefreshToken == "" {
			errMessage := resp.ErrorDescription
			if errMessage == "" {
				errMessage = resp.Text
			}
			if errMessage == "" {
				errMessage = resp.Message
			}
			if errMessage == "" {
				errMessage = resp.Error
			}
			if errMessage != "" {
				return fmt.Errorf("failed to refresh token: %s", errMessage)
			}
			return fmt.Errorf("empty access_token or refresh_token returned from official API")
		}
		expiredAt, err := expiresInToExpiredAt(resp.ExpiresIn)
		if err != nil {
			return err
		}

		d.AccessToken = resp.AccessToken
		d.RefreshToken = resp.RefreshToken
		d.tm.expiredAt = expiredAt
		op.MustSaveDriverStorage(d)
		d.tm.blockRefresh = false
		return nil
	}

	// Developer API response contains code/message/data(accessToken, expiredAt).
	if d.ClientID != "" && d.ClientSecret != "" {
		req := base.RestyClient.R()
		req.SetHeaders(map[string]string{
			"platform":     "open_platform",
			"Content-Type": "application/json",
		})
		var resp AccessTokenResp
		req.SetBody(base.Json{
			"clientID":     d.ClientID,
			"clientSecret": d.ClientSecret,
		})
		req.SetResult(&resp)
		_, err := req.Execute(http.MethodPost, AccessToken)
		if err != nil {
			return err
		}
		if resp.Code != 0 {
			return fmt.Errorf("get access token failed: %s", resp.Message)
		}
		if resp.Data.AccessToken == "" || resp.Data.ExpiredAt == "" {
			return errors.New("invalid token payload from developer API")
		}
		expiredAt, err := time.Parse(time.RFC3339, resp.Data.ExpiredAt)
		if err != nil {
			return fmt.Errorf("parse expire time failed: %w", err)
		}
		d.AccessToken = resp.Data.AccessToken
		d.tm.expiredAt = expiredAt.UTC()
		op.MustSaveDriverStorage(d)
		d.tm.blockRefresh = false
		return nil
	}
	return errors.New("no valid authentication method available")
}
