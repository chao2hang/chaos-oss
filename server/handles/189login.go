package handles

import (
	_189pc "github.com/OpenListTeam/OpenList/v4/drivers/189pc"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

type Cloud189LoginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
	VCode    string `json:"validate_code"`
	State    string `json:"state"`
}

// Cloud189Login runs one step of the interactive 189CloudPC login
// helper. First call (no state) starts the flow; if a captcha is
// required the response carries the image and a state token, and the
// client retries with the user-typed code. Success returns the session
// (sessionKey/Secret + access/refresh tokens) for the storage config.
func Cloud189Login(c *gin.Context) {
	var req Cloud189LoginReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if req.State == "" && (req.Username == "" || req.Password == "") {
		common.ErrorStrResp(c, "username and password are required", 400)
		return
	}
	result, captcha, state, err := _189pc.LoginAssist(req.Username, req.Password, req.VCode, req.State)
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	if result == nil {
		// captcha round-trip
		common.SuccessResp(c, gin.H{
			"need_captcha":  true,
			"captcha_image": captcha,
			"state":         state,
		})
		return
	}
	common.SuccessResp(c, gin.H{
		"need_captcha": false,
		"state":        "",
		"session":      result,
	})
}
