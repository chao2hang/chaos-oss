package _189pc

import (
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/drivers/base"
	"github.com/google/uuid"
)

// Interactive login assistant: performs the driver's login flow outside
// of a storage instance so the UI can validate credentials (and answer
// captchas) before saving, then hands back the session for the config.

// AssistantResult carries everything the UI needs to fill the config.
type AssistantResult struct {
	LoginName           string `json:"login_name"`
	SessionKey          string `json:"session_key"`
	SessionSecret       string `json:"session_secret"`
	FamilySessionKey    string `json:"family_session_key"`
	FamilySessionSecret string `json:"family_session_secret"`
	AccessToken         string `json:"access_token"`
	RefreshToken        string `json:"refresh_token"`
}

type assistState struct {
	y      *Cloud189PC
	expire time.Time
}

var (
	assistMu     sync.Mutex
	assistStates = map[string]*assistState{}
)

const assistStateTTL = 10 * time.Minute

func assistGC() {
	now := time.Now()
	for k, v := range assistStates {
		if now.After(v.expire) {
			delete(assistStates, k)
		}
	}
}

func newAssistClient() *Cloud189PC {
	y := &Cloud189PC{Addition: Addition{LoginType: "password"}}
	y.client = base.NewRestyClient().SetHeaders(map[string]string{
		"Accept":  "application/json;charset=UTF-8",
		"Referer": WEB_URL,
	})
	return y
}

var captchaImgRe = regexp.MustCompile(`base64,([A-Za-z0-9+/=]+)`)

// LoginAssist runs one step of the interactive login.
//   - No state yet: starts a fresh flow. If a captcha is required it
//     returns (nil, captchaPngBase64, state, nil) and the caller retries
//     with the same state and the code the user typed.
//   - With state + code: submits the login. Success returns the session.
func LoginAssist(username, password, vcode, state string) (result *AssistantResult, captchaImage string, newState string, err error) {
	assistMu.Lock()
	defer assistMu.Unlock()
	assistGC()

	y := newAssistClient()
	if state != "" {
		st, ok := assistStates[state]
		if !ok {
			return nil, "", "", fmt.Errorf("登录会话已过期，请重新开始")
		}
		y = st.y
		if vcode != "" {
			y.VCode = vcode
		}
		if err := y.loginByPasswordAssist(); err != nil {
			// wrong/expired captcha consumes the login param — restart
			delete(assistStates, state)
			if strings.Contains(err.Error(), "need img validate code") {
				m := captchaImgRe.FindStringSubmatch(err.Error())
				if len(m) > 1 {
					return nil, m[1], state, nil
				}
			}
			return nil, "", "", err
		}
		delete(assistStates, state)
		return buildAssistantResult(y), "", "", nil
	}

	// fresh start
	y.Addition.Username = username
	y.Addition.Password = password
	state = uuid.NewString()
	if err := y.initLoginParam(); err != nil {
		if strings.Contains(err.Error(), "need img validate code") {
			m := captchaImgRe.FindStringSubmatch(err.Error())
			if len(m) > 1 {
				assistStates[state] = &assistState{y: y, expire: time.Now().Add(assistStateTTL)}
				return nil, m[1], state, nil
			}
		}
		return nil, "", "", err
	}
	// no captcha needed (or solved by OCR) — submit directly
	if err := y.loginByPasswordAssist(); err != nil {
		return nil, "", "", err
	}
	return buildAssistantResult(y), "", "", nil
}

// loginByPasswordAssist is loginByPassword without the storage-persisting
// side effects (safe for throwaway instances).
func (y *Cloud189PC) loginByPasswordAssist() (err error) {
	if y.loginParam == nil {
		if err := y.initLoginParam(); err != nil {
			return err
		}
	}
	param := y.loginParam
	var loginresp LoginResp
	_, err = y.client.R().
		ForceContentType("application/json;charset=UTF-8").SetResult(&loginresp).
		SetHeaders(map[string]string{
			"REQID": param.ReqId,
			"lt":    param.Lt,
		}).
		SetFormData(map[string]string{
			"appKey":       APP_ID,
			"accountType":  ACCOUNT_TYPE,
			"userName":     param.RsaUsername,
			"password":     param.RsaPassword,
			"validateCode": y.VCode,
			"captchaToken": param.CaptchaToken,
			"returnUrl":    RETURN_URL,
			"dynamicCheck": "FALSE",
			"clientType":   CLIENT_TYPE,
			"cb_SaveName":  "1",
			"isOauth2":     "false",
			"state":        "",
			"paramId":      param.ParamId,
		}).
		Post(AUTH_URL + "/api/logbox/oauth2/loginSubmit.do")
	if err != nil {
		return err
	}
	if loginresp.ToUrl == "" {
		return fmt.Errorf("login failed, no toUrl obtained, msg: %s", loginresp.Msg)
	}

	var erron RespErr
	var tokenInfo AppSessionResp
	_, err = y.client.R().
		SetResult(&tokenInfo).SetError(&erron).
		SetQueryParams(clientSuffix()).
		SetQueryParam("redirectURL", loginresp.ToUrl).
		Post(API_URL + "/getSessionForPC.action")
	if err != nil {
		return err
	}
	if erron.HasError() {
		return &erron
	}
	if tokenInfo.ResCode != 0 {
		return fmt.Errorf("%s", tokenInfo.ResMessage)
	}
	y.Addition.AccessToken = tokenInfo.AccessToken
	y.Addition.RefreshToken = tokenInfo.RefreshToken
	y.tokenInfo = &tokenInfo
	return nil
}

func buildAssistantResult(y *Cloud189PC) *AssistantResult {
	t := y.tokenInfo
	if t == nil {
		return nil
	}
	r := &AssistantResult{
		LoginName:           t.LoginName,
		SessionKey:          t.SessionKey,
		SessionSecret:       t.SessionSecret,
		FamilySessionKey:    t.FamilySessionKey,
		FamilySessionSecret: t.FamilySessionSecret,
		AccessToken:         t.AccessToken,
		RefreshToken:        t.RefreshToken,
	}
	return r
}
