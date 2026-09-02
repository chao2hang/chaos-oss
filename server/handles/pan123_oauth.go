package handles

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/OpenListTeam/OpenList/v4/drivers/base"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

// 123 云盘开放平台 OAuth 凭据（Filmly Android 客户端）。
const (
	pan123OAuthClientID     = "uch86homnvtpukbenxv06whun7oayymz"
	pan123OAuthClientSecret = "qxlth6oludklrutxxz8h4dh6jgicpe28"
	pan123OAuthRedirectURI  = "https://api.filmly.netease.com/a/v1/123pan/callback"
	pan123OAuthScope        = "user:base,file:all:read,file:all:write"
	pan123OAuthState        = "FilmlyAndroid"
	pan123OAuthAuthPage     = "https://yun.123pan.com/auth"
	pan123OAuthTokenURL     = "https://open-api.123pan.com/api/v1/oauth2/access_token"
)

// Pan123OAuthInfo returns the authorization page URL so the frontend can
// build a "前往授权" link without hardcoding credentials client-side.
//
// GET /api/admin/123pan/oauth_info
func Pan123OAuthInfo(c *gin.Context) {
	common.SuccessResp(c, gin.H{
		"auth_url": fmt.Sprintf(
			"%s?client_id=%s&redirect_uri=%s&scope=%s&state=%s&response_type=code",
			pan123OAuthAuthPage, pan123OAuthClientID, pan123OAuthRedirectURI,
			pan123OAuthScope, pan123OAuthState,
		),
		"redirect_uri": pan123OAuthRedirectURI,
	})
}

// Pan123OAuthToken exchanges an authorization code (or refresh token) for
// an access token against the 123 open platform, proxying through the
// backend because the browser cannot call open-api.123pan.com directly
// (no CORS headers).
//
// POST /api/admin/123pan/oauth_token  { code?: string, refresh_token?: string }
func Pan123OAuthToken(c *gin.Context) {
	var req struct {
		Code         string `json:"code"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if req.Code == "" && req.RefreshToken == "" {
		common.ErrorStrResp(c, "code or refresh_token is required", 400)
		return
	}

	grantType := "authorization_code"

	// Only the fields relevant to the chosen grant are sent — an empty
	// refresh_token alongside a code (or vice versa) makes some OAuth
	// servers reject the whole request.
	payload := map[string]string{
		"client_id":     pan123OAuthClientID,
		"client_secret": pan123OAuthClientSecret,
		"grant_type":    grantType,
		"redirect_uri":  pan123OAuthRedirectURI,
	}
	if req.RefreshToken != "" {
		payload["grant_type"] = "refresh_token"
		payload["refresh_token"] = req.RefreshToken
	} else {
		payload["code"] = req.Code
	}

	// Empirically the token endpoint reads params from a form body or the
	// query string — a JSON body yields "unsupported_grant_type". The
	// Platform header only applies to the authenticated APIs; the token
	// endpoint is explicitly excluded from that rule.
	resp, err := base.RestyClient.R().
		SetHeader("User-Agent", "Filmly/2.1.0-20100").
		SetFormData(payload).
		Post(pan123OAuthTokenURL)
	if err != nil {
		common.ErrorResp(c, err, 502)
		return
	}

	body := resp.Body()
	// The token endpoint returns a FLAT OAuth response on success
	// ({"token_type","access_token","refresh_token","expires_in"} at the
	// top level — see the API doc §2.3), and an OAuth error body on
	// failure. Parse the flat fields via embedding; keep the nested
	// envelope as a fallback for deployments that wrap the response.
	var parsed struct {
		// flat success fields (embedded → parsed from the top level)
		TokenType    string `json:"token_type"`
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
		// envelope-style success (fallback)
		Code    int    `json:"code"`
		Message string `json:"message"`
		// OAuth-style failure
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
		Data             *struct {
			TokenType    string `json:"token_type"`
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    int64  `json:"expires_in"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		if resp.StatusCode() != 200 {
			common.ErrorStrResp(c, fmt.Sprintf("123pan token endpoint returned %d: %s",
				resp.StatusCode(), strings.TrimSpace(string(body))), 502)
			return
		}
		common.ErrorResp(c, err, 502)
		return
	}
	// OAuth-style error (e.g. invalid/expired code, mismatched redirect_uri)
	if parsed.Error != "" {
		detail := parsed.Error
		if parsed.ErrorDescription != "" {
			detail = fmt.Sprintf("%s: %s", parsed.Error, parsed.ErrorDescription)
		}
		common.ErrorStrResp(c, "123pan 授权失败（"+detail+"）", 502)
		return
	}
	if resp.StatusCode() != 200 {
		common.ErrorStrResp(c, fmt.Sprintf("123pan token endpoint returned %d: %s",
			resp.StatusCode(), strings.TrimSpace(string(body))), 502)
		return
	}
	if parsed.Code != 0 {
		common.ErrorStrResp(c, fmt.Sprintf("123pan oauth failed: [%d] %s",
			parsed.Code, parsed.Message), 502)
		return
	}
	// Prefer the flat fields; fall back to a nested envelope if present.
	result := gin.H{
		"token_type":    parsed.TokenType,
		"access_token":  parsed.AccessToken,
		"refresh_token": parsed.RefreshToken,
		"expires_in":    parsed.ExpiresIn,
	}
	if parsed.Data != nil && parsed.Data.AccessToken != "" && parsed.AccessToken == "" {
		result = gin.H{
			"token_type":    parsed.Data.TokenType,
			"access_token":  parsed.Data.AccessToken,
			"refresh_token": parsed.Data.RefreshToken,
			"expires_in":    parsed.Data.ExpiresIn,
		}
	}
	if result["access_token"] == "" {
		common.ErrorStrResp(c, "123pan 未返回 access_token，请重新授权获取新 code 后重试", 502)
		return
	}
	common.SuccessResp(c, result)
}
