package handles

import (
	"bytes"
	"encoding/base64"
	"image/png"
	"net/http"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/pquerna/otp/totp"
)

type LoginReq struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password"`
	OtpCode  string `json:"otp_code"`
}

// Login Deprecated
func Login(c *gin.Context) {
	var req LoginReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	req.Password = model.StaticHash(req.Password)
	loginHash(c, &req)
}

// LoginHash login with password hashed by sha256
func LoginHash(c *gin.Context) {
	var req LoginReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	loginHash(c, &req)
}

func loginHash(c *gin.Context, req *LoginReq) {
	// check count of login
	ip := c.ClientIP()
	count, ok := model.LoginCache.Get(ip)
	if ok && count >= model.DefaultMaxAuthRetries {
		common.ErrorStrResp(c, model.TooManyAttempts, 429)
		model.LoginCache.Expire(ip, model.DefaultLockDuration)
		return
	}
	// check username
	user, err := op.GetUserByName(req.Username)
	if err != nil {
		common.ErrorStrResp(c, model.InvalidUsernameOrPassword, 401)
		model.LoginCache.Set(ip, count+1)
		return
	}
	// validate password hash
	if err := user.ValidatePwdStaticHash(req.Password); err != nil {
		common.ErrorStrResp(c, model.InvalidUsernameOrPassword, 401)
		model.LoginCache.Set(ip, count+1)
		return
	}
	// check 2FA
	if user.OtpSecret != "" {
		if !totp.Validate(req.OtpCode, user.OtpSecret) {
			// 402 - need opt
			common.ErrorStrResp(c, model.Invalid2FACode, 402)
			model.LoginCache.Set(ip, count+1)
			return
		}
	}
	// generate tokens
	token, err := common.GenerateToken(user)
	if err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	refreshToken, err := common.GenerateRefreshToken(user)
	if err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	common.SuccessResp(c, gin.H{
		"token":         token,
		"refresh_token": refreshToken,
		"expires_in":    common.AccessTokenTTL(),
	})
	model.LoginCache.Del(ip)
}

// RefreshToken exchanges a valid refresh token for a new access token
// (and rotates the refresh token). This lets web clients survive
// access-token expiry without re-entering credentials.
//
// POST /api/auth/refresh  { refresh_token: string }
func RefreshToken(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if req.RefreshToken == "" {
		common.ErrorStrResp(c, "refresh_token is required", 400)
		return
	}
	claims, err := common.ParseRefreshToken(req.RefreshToken)
	if err != nil {
		common.ErrorStrResp(c, err.Error(), 401)
		return
	}
	user, err := op.GetUserByName(claims.Username)
	if err != nil {
		common.ErrorStrResp(c, "user no longer exists", 401)
		return
	}
	// password changed since the refresh token was issued → force re-login
	if user.PwdTS != claims.PwdTS {
		common.ErrorStrResp(c, "credential has changed, please login again", 401)
		return
	}
	// Atomically retire the refresh token; a concurrent or replayed use of the
	// same token loses this race and is rejected, so rotation is exactly-once.
	if !common.ConsumeRefreshToken(req.RefreshToken) {
		common.ErrorStrResp(c, "refresh token was already used", 401)
		return
	}
	token, err := common.GenerateToken(user)
	if err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	refreshToken, err := common.GenerateRefreshToken(user)
	if err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	common.SuccessResp(c, gin.H{
		"token":         token,
		"refresh_token": refreshToken,
		"expires_in":    common.AccessTokenTTL(),
	})
}

type UserResp struct {
	model.User
	Otp bool `json:"otp"`
}

// CurrentUser get current user by token
// if token is empty, return guest user
func CurrentUser(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	userResp := UserResp{
		User: *user,
	}
	userResp.Password = ""
	if userResp.OtpSecret != "" {
		userResp.Otp = true
	}
	common.SuccessResp(c, userResp)
}

func UpdateCurrent(c *gin.Context) {
	var req model.User
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	if user.IsGuest() {
		common.ErrorStrResp(c, model.GuestCannotUpdateProfile, 403)
		return
	}
	user.Username = req.Username
	if req.Password != "" {
		user.SetPassword(req.Password)
	}
	user.SsoID = req.SsoID
	if err := op.UpdateUser(user); err != nil {
		common.ErrorResp(c, err, 500)
	} else {
		common.SuccessResp(c)
	}
}

func Generate2FA(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	if user.IsGuest() {
		common.ErrorStrResp(c, model.GuestCannotGenerate2FA, 403)
		return
	}
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "File Service",
		AccountName: user.Username,
	})
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	img, err := key.Image(400, 400)
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	// to base64
	var buf bytes.Buffer
	png.Encode(&buf, img)
	b64 := base64.StdEncoding.EncodeToString(buf.Bytes())
	common.SuccessResp(c, gin.H{
		"qr":     "data:image/png;base64," + b64,
		"secret": key.Secret(),
	})
}

type Verify2FAReq struct {
	Code   string `json:"code" binding:"required"`
	Secret string `json:"secret" binding:"required"`
}

func Verify2FA(c *gin.Context) {
	var req Verify2FAReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	if user.IsGuest() {
		common.ErrorStrResp(c, model.GuestCannotGenerate2FA, 403)
		return
	}
	if !totp.Validate(req.Code, req.Secret) {
		common.ErrorStrResp(c, model.Invalid2FACode, 400)
		return
	}
	user.OtpSecret = req.Secret
	if err := op.UpdateUser(user); err != nil {
		common.ErrorResp(c, err, 500)
	} else {
		common.SuccessResp(c)
	}
}

func LogOut(c *gin.Context) {
	err := common.InvalidateToken(c.GetHeader("Authorization"))
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	// Best effort: also retire the refresh token if the client sends it.
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if c.Request.Method == http.MethodPost && c.Request.ContentLength != 0 {
		_ = c.ShouldBind(&req)
		if req.RefreshToken != "" {
			_ = common.InvalidateToken(req.RefreshToken)
		}
	}
	common.SuccessResp(c)
}
