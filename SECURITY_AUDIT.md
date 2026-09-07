# chaos-oss 安全审计报告

审计日期：2026-09-07
审计范围：本 fork 相对上游 OpenList 的自有改动（`c589b1c2~1..HEAD`，176 个文件 / +22,126 行 / 60 个 Go 文件）
基线状态：`go build ./...` 通过、`go vet ./...` 通过、`govulncheck` 对被调用代码为 **0 漏洞**

> 上游 OpenList 继承代码不在审计范围内，除非 fork 修改了它。
> 所有"已确认"结论均由可执行的临时 Go 测试／原始 HTTP 请求验证，验证后已删除，工作树保持干净。

---

## 摘要

fork 新增的 S3 网关存在**两个可组合的严重漏洞**：签名从不校验 + 路径穿越。任何知道"访问密钥 ID"（非机密标识符）的人，可对**所有已挂载存储**进行任意读 / 写 / 删除。这是本次审计最需要立刻处理的问题。

同时必须指出：fork 在认证方面做了不少**真实且正确的加固**（JWT 算法白名单、修复上游空 admin token 绕过、postMessage 指定 origin、移除 Bearer Token 日志、默认关闭 XFF 信任、前端构建产物可复现），这些经验证成立，不应被下面的问题清单掩盖。

| 级别 | 数量 | 关键条目 |
|---|---|---|
| Critical | 2 | S3 签名不校验；S3 路径穿越 |
| High | 6 | 刷新令牌可重放；SSO state 未绑定浏览器；密钥 ACL 被静默清空；`policy:"all"` 未生效；CopyObject 删除交接文件；硬编码第三方 OAuth secret |
| Medium | 9 | SSO state 竞态、限流器无界增长、代理下限流退化、登出不吊销刷新令牌、fanOutMkdir 路径双前缀、Cancel 无法取消进行中重试、指标标签基数 DoS、`raw_url` 未校验协议、下载路径未编码 |
| Low | 8 | 见下文 |

---

## Critical

### C1. S3 网关从不校验请求签名（访问密钥 ID 即等于完全访问权）

`server/s3/server.go:16,23` · `server/s3/utils.go:267-276` · `server/s3/auth.go:264`

`authlistResolver()` 只读取**旧版**设置 `s3_access_key_id` / `s3_secret_access_key`；而管理界面新建的密钥保存在数据库 `s3KeyStore` 中，两者从不互通。默认安装下旧设置为空 → `WithV4Auth(nil)` → gofakes3 的 `authMiddleware` 因 `len(v4AuthPair)==0` **完全跳过 `V4SignVerify`**。此后 `gatekeeper` 仅做**访问密钥 ID 的字符串相等比较**，从不计算 HMAC。SecretKey 实际上从未被用于任何校验。

**决定性证据**：前端 `Settings.tsx:439` 主动过滤掉了这两个旧设置项，管理员**无法**通过 UI 填写它们 —— 因此该校验开关在正常使用下**永久处于关闭状态**。

实测（真实处理链）：
```
authPairs = map[] (len=0)
伪造签名 GET  /bucket/secret.txt -> 200，返回 "SECRET FILE CONTENTS"
伪造签名 PUT  /bucket/evil.txt   -> 200，写入被授权
对照：signature.V4SignVerify(同一请求) -> errSignatureDoesNotMatch（校验器本身正常，只是从未被调用）
```

附带后果：预签名 URL 的**有效期检查也只存在于被跳过的校验器内**，因此预签名 URL 永不过期。

**修复**：在 `NewServer` 用 `op.GetS3AccessKeys()` 构建 authPairs，并在 `RefreshS3Keys()` 中通过 `AddAuthKeys`/`DelAuthKeys` 同步；或直接在 `gatekeeper` 内调用 `signature.V4SignVerify(r)` 并拒绝非 `ErrNone`（`keyStore.load()` 已在填充 `signature.StoreKeys`，只差调用）。

### C2. 路径穿越，可逃逸桶根目录并绕过按桶 ACL

`server/s3/backend.go:202,273,562,610,734` · ACL 位于 `server/s3/auth.go:274`

`objectName` 直接来自 URL，全程无 `..` 校验；`path.Join` 会**解析** `..`。而 ACL 的 `bucketFromPath()` 只取第一个路径段 —— 于是被限定在 `public` 桶的密钥可通过校验，随后读写任意位置。

实测（经真实 gin 路由，gin 不会规范化点号段，`%2e%2e` 亦会解码）：
```
/s3/public/../private/secret.txt   -> /mnt/private/secret.txt      逃逸
/s3/public/../../etc/passwd        -> /etc/passwd                  逃逸
/s3/public/%2e%2e/private/x        -> 同上（gin 解码后仍保留 ..）
```
影响 GET / HEAD / PUT / **DELETE**，即任意读 + 任意写/删。

**修复**：在任何 `path.Join` 前拒绝 `..`，并在拼接后断言 `strings.HasPrefix(fp, basePath+"/")`。需覆盖 `headAtPath`、`getAtPath`、`putOnePath`、`deleteObject`、`CopyObject`（源与目标）及 `replication.go`。

> **C1 + C2 组合**：知道一个非机密的访问密钥 ID，即可对全部挂载存储任意读写删。建议一并立即修复。

---

## High

### H1. 刷新令牌轮换并非"恰好一次"，可重放
`server/common/auth.go:156-159` → `server/handles/auth.go:128`

根因：`go-cache@v0.1.0` 的 `GetDel` 实现为 `defer c.Del(k); return c.Get(k)`（`Get` 用 RLock、`Del` 用 Lock），**并非原子**。实测同一刷新令牌被并发消费成功 **4 次**，各自签发新的 access+refresh，形成攻击者可持续续期的并行会话；配合 30 天 TTL 且无重用检测，窃取行为不会被发现。

**修复**：改为数据库条件更新 `UPDATE ... SET used_at=? WHERE jti=? AND used_at IS NULL` 并检查 `RowsAffected==1`；对失败的消费触发整个令牌家族吊销。

### H2. SSO state 未与浏览器绑定 → 登录 CSRF / 账号接管
`server/handles/ssologin.go:39-54,224,356`

state 仅绑定 `(clientID, ClientIP)`，无 cookie/会话绑定，且 `/api/auth/sso` 无需认证即可铸造 state。更关键的是 fork 默认 `trusted_proxies: []` 且 `ForwardedByClientIP=false`（`internal/bootstrap/run.go:97-109`）—— 在任何反向代理后 `ClientIP()` 恒为代理地址，IP 绑定形同虚设。state 也**未绑定 `method`**。
后果：诱导受害者访问带攻击者 `code`/`state` 的回调，受害者前端拿到**攻击者的**令牌（会话固定）；若用 `method=get_sso_id`，可把攻击者的 IdP 身份绑定到管理员账号 → 账号接管。

**修复**：下发时把 state 写入 `HttpOnly; Secure; SameSite=Lax` cookie，回调时与 cookie 比对（`hmac.Equal`）；把 `method` 纳入缓存值并校验。

### H3. 部分更新 S3 密钥会静默清空全部访问限制
`server/handles/s3admin.go:105-108`

`Buckets` / `ReadOnly` / `IPAllowlist` 被无条件赋值；缺省 JSON 字段解码为 `""`/`false`。实测仅提交 `{"remark":"new note"}` 后：
```
前：ReadOnly=true  Buckets="only-this-bucket" IPAllowlist="10.0.0.0/8"
后：ReadOnly=false Buckets=""                 IPAllowlist=""
```
只读、限定桶、限定 IP 的密钥被提升为全权限。（同函数已对 `SecretKey`/`Enabled` 做了保护，唯独漏掉这三项。）
**修复**：改为 `*string`/`*bool`，仅在非 nil 时赋值。

### H4. `policy:"all"` 未被强制执行
`server/s3/backend.go:413-451`（`CopyObject` 同）

注释（`backend.go:343-345`）承诺"任一路径失败即中止并回滚"，代码却只判断 `allFailed`。2 条路径中 1 条失败时：不返回错误、因重试仅在 `policy==PolicyAny` 时入队而**不重试**、随后 defer 删除缓存体 —— 客户端收到 **200**，数据只落在部分路径且无法恢复。
**修复**：`if policy == PolicyAll && firstErr(results) != nil { 回滚已成功路径; return err }`。

### H5. `CopyObject` 删除了刚交给复制 worker 的临时文件
`server/s3/backend.go:850` vs `890`

`defer os.Remove(cachePath)` 是**直接** defer，参数在 defer 语句处即求值，后续 `cachePath = ""` 无法抑制；而 `PutObject`（`402-406`）正确使用了闭包。实测：CopyObject 交接后文件已被删除，PutObject 则保留。后果是 COPY 的后台重试必然 ENOENT 失败，滞后路径静默丢数据。
**修复**：改为闭包 `defer func(){ if cachePath != "" { os.Remove(cachePath) } }()`。

### H6. 源码内硬编码第三方 OAuth client secret（fork 引入）
`server/handles/pan123_oauth.go:14-17` · `drivers/123_open/token.go:25-28`

```go
pan123OAuthClientSecret = "qxlth6oludklrutxxz8h4dh6jgicpe28"
pan123OAuthRedirectURI  = "https://api.filmly.netease.com/a/v1/123pan/callback"
```
经 `git show c589b1c2~1:...` 验证上游**不存在**，由 fork 提交 `7fe80218` 引入；注释自述取自"Filmly Android 客户端"，即疑似取自第三方 App 的凭据 —— 除安全问题外还涉及凭据挪用。凭据所有者一旦吊销，将同时影响全部使用者。
**修复**：移除常量、改由用户配置自有 client_id/secret。注意仅改 HEAD 不足够，该值已存于历史提交，需重写历史或接受长期暴露。

---

## Medium

- **M1. SSO state 一次性校验同样存在竞态**（`ssologin.go:52`）：实测同一 state 并发校验成功 3 次。
- **M2. 限流器 map 无界增长**（`middlewares/login_limit.go:34-42`）：仅当 `>10000` **且** 条目超过 10 分钟才清理，持续洪泛时永不驱逐；实测 60000 个不同 IP → 60001 条目。IPv6 /64 可轻易触发。
- **M3. 反向代理下按 IP 限流退化为全局限流**（`login_limit.go:44-58`）：默认 `trusted_proxies: []` 使所有请求同 IP，攻击者一人洪泛即可让全体用户 429（认证 DoS）。且仅按 IP、**从不按用户名**限流，跨账号撞库不受限。
- **M4. 登出不吊销刷新令牌**（`handles/auth.go:248-265`）：仅当客户端在 POST body 主动回传才吊销；仍在路由中的 `GET /api/auth/logout` 无法携带。实测登出后旧刷新令牌仍能换取新 access token（最长 30 天）。
- **M5. `fanOutMkdir` 路径双前缀**（`backend.go:384,610`）：`path.Join(paths[0], objectName)` 传入后又被逐路径再拼一次 → `/storageA/pub/storageA/pub/newdir`，目标目录从未被创建。
- **M6. `repWorker.Cancel` 无法取消进行中的重试**（`replication.go:91-108`）：仅清理缓冲队列；已进入 `processWithGrace`（最长 600s 退避重试）的条目不可见 → 已删除对象会被重新写回。另含两处缺陷：`select` 内的 `break` 只跳出 select（非循环）；`Cancel` 持锁发送而 `Enqueue` 不持锁，存在阻塞风险（未能稳定复现，标记为未验证）。
- **M7. 未认证即可撑爆指标基数**（`metrics.go:56,94` + `auth.go:244-245`）：`deny()` 把**攻击者提供**的密钥 ID 作为 Prometheus 标签与 map key，无上限无驱逐。实测 500 次被拒请求 → `byKey` 永久增长 500 条。
- **M8. `raw_url` 未校验协议即 `window.open`**（`frontend/src/pages/Share.tsx:102,247`、`Preview.tsx:166`）：对 `alist_v3`/`openlist` 驱动，`raw_url` 来自**远端上游服务器**的 JSON（`drivers/alist_v3/driver.go:141`），恶意上游可注入 `javascript:` 窃取 localStorage 中的令牌。现代浏览器多会拦截顶层 `javascript:` 导航，故定为 Medium。全部约 8 处 `window.open` 亦缺 `noopener,noreferrer`。
- **M9. 下载 URL 未对路径分段编码**（`frontend/src/api/client.ts:266-277`）：`sign` 已编码但路径未编码，文件名含 `#`/`?` 会使签名丢失、请求到错误对象（是功能损坏，签名不会泄露）。后端 `utils.EncodePath` 已正确处理。

---

## Low

- **L1. `TouchS3AccessKey` 更新不存在的列**（`internal/db/s3key.go:44`）：模型字段 `LastUsed` 对应列为 `last_used`，代码却更新 `last_used_time`；错误被 `_ =` 吞掉 → "最后使用时间"永久为空，无法识别陈旧/失陷密钥。
- **L2. 吊销的密钥仍留在签名凭据库**：`keyStore.load()` 只调用 `StoreKeys`（仅新增）而非 `ReloadKeys`（会清理）。实测删除后该 AKID 仍被验证器识别（返回 `errSignatureDoesNotMatch` 而非 `errInvalidAccessKeyID`；对照未知 AKID 返回后者）。目前因 C1 尚无实际放行影响，但修复 C1 后会成为真实的吊销失效。
- **L3. 审计日志静默丢弃**（`internal/op/s3key.go:76-81`）：队列满即丢且无计数无日志；实测 2000 条仅留 1024 条。攻击者可用负载冲掉自己的痕迹。
- **L4. `/api/auth/refresh` 未检查 `Disabled`/guest**（`handles/auth.go:116-131`）：被禁用用户仍可持续轮换令牌（因 Auth 中间件每次仍校验，实际影响有限）。
- **L5. 令牌存于 localStorage 且无 CSP**（`frontend/src/api/client.ts:50-61`）：access + 30 天 refresh 均可被 XSS 窃取；全仓库无 `Content-Security-Policy`。已验证令牌不会进入 URL、不会跨域发送。
- **L6. SQLite 备份未包含 WAL**（`internal/bootstrap/db.go`）：DSN 启用了 `_journal=WAL`，备份却只 `os.ReadFile` 主库文件，未 checkpoint，快照可能缺少最新事务甚至不一致。建议改用 `VACUUM INTO`。
- **L7. 供应链**：`jlumbroso/free-disk-space@main` 未固定版本，却运行在具 `contents: write` 的 release 作业中（`release.yml:36`）；`build.sh` 中 8 处工具链下载**无任何校验和验证**（无 `sha256sum`/`gpg --verify`），其中两处直接管道进 `sudo tar`；`Dockerfile:4` 使用滚动的 `alpine:edge`；`docker-compose.yml:8` 用 `user: '0:0'` 覆盖了镜像本身的非 root 加固。
- **L8. 存储导出返回明文凭据**（`handles/storage.go:261`）：确为明文 `Addition`，但上游 `storage/list`/`get` 对同一管理员受众早已如此，并非新增暴露面；建议加 UI 警示。导入无条数/体积上限（可接受 300 条）。

---

## 已排除的误报（经验证不成立）

这些是审计中重点怀疑、但**实测证明安全**的点，一并记录以免后续重复排查：

- **Markdown XSS —— 不存在。** 无 DOMPurify 并非漏洞：`react-markdown@10.1.0` 默认把原始 HTML 降级为文本节点，且强制协议白名单；`rehype-raw` 未安装。实测 `<script>`、`<img onerror>`、`javascript:` 链接均被中和。
- **JWT 算法混淆 / 过期未校验 —— 不存在。** fork 正确加入 `jwt.WithValidMethods([HS256])`（`common/auth.go:102,133`），`alg=none` 被拒；两条解析路径均拒绝过期令牌。
- **XFF 伪造绕过限流 —— 不存在。** 默认 `ForwardedByClientIP=false`，伪造 XFF 无效（此安全默认反而导致 M3）。
- **管理接口越权 —— 不存在。** 全部新增管理路由（`/s3key/*`、`/s3audit/list`、`/s3/stats`、`/storage/export|import`、`/123pan/*`、`/189cloud/login`）均位于 `AuthAdmin` 组内；`/api/metrics` 亦显式加了 `AuthAdmin`。
- **S3 密钥列表泄露 secret —— 不存在。** `model.S3AccessKey.SecretKey` 标记 `json:"-"`，响应体已验证无 secret。
- **审计日志 SQL 注入 —— 不存在。** 三个过滤条件均为 GORM 参数绑定；注入载荷返回 0 行且表完好。
- **GitHub Actions 脚本注入 / `pull_request_target` RCE —— 不存在。** `issue_pr_comment.yml` 虽用 `pull_request_target`，但全文件无 `actions/checkout`，不可控输入仅经 `context.payload.*` 进入 JS 判断，从不拼接进 `run:`；全仓 13 处 `github.event` 插值均非攻击者可控。
- **常量定时比较 —— 已正确使用。** `subtle.ConstantTimeCompare`，且 fork 额外补上的 `adminToken != ""` 判空**修复了上游真实漏洞**（未设置 admin token 时空 Authorization 头会被当作管理员）。
- **前端构建产物与源码不一致 —— 不存在。** `vite build` 重建结果与已提交的 `public/dist` **逐字节一致**（sha256 相同）。
- **`postMessage` 通配 origin / 弹窗 XSS —— 已修复且不可利用。** 使用 `window.location.origin`；Go 的 `json.Marshal` 会转义 `<`/`>`，无法闭合 `</script>`。
- **开放重定向 —— 当前不可利用。** `Login.tsx` 的 `startsWith('/')` 确实放行 `//evil.com`，但 `replaceState` 被同源策略拒绝（`SecurityError`）。仍建议加固，因为 react-router 的 push 分支存在 `location.assign` 回退，一旦去掉 `{replace:true}` 即成真实漏洞。
- **依赖漏洞 —— 无实际影响。** `govulncheck` 对被调用代码 0 漏洞；前端仅 `ansi-regex@5.0.0` ReDoS，属 CLI 依赖且经确认**未进入打包产物**。
- **提交的仓库内无真实密钥。** `data/`（含 SQLite 与 config.json）已被 `.gitignore` 正确忽略且未被跟踪；驱动中的 `pikpak`/`degoo`/`thunder` 等"secret"为上游继承的协议常量，未被 fork 修改（H6 是唯一例外）。

---

## 其他（非安全）

- **`docker build` 会失败**：`public/theme/install.sh:38,44` 调用 `python3`，但 `Dockerfile:15` 的 `apk add` 未安装它；`install.sh` 为 `set -euo pipefail` 且 `build.sh` 为 `set -e`，实测该失败会中断整个构建。CI 不受影响（用 `Dockerfile.ci` + runner 自带 python3），故仅影响本地/自建构建。
- **上游测试失败**：`TestNewOSSClientUsesEnvironmentHTTPSProxy`（`internal/net/oss_test.go`）因 Go 1.26 返回 `*net.safeTransport` 而失败，属上游代码与新版 Go 的兼容问题，非 fork 引入。
- **`s3_replication_default_policy` 为死代码**：`normalized()` 已把空策略固定为 `any`，全局设置永远不被读取。
- **前端 `tsc --noEmit` 有 9 处类型错误**，因构建使用 `--noCheck` 而未被 CI 捕获；`lucide-react` 存在 peer 依赖冲突。

---

## 建议修复顺序

1. **C1 + C2**（一并修复）—— 二者组合即为"知道一个非机密 ID 就能任意读写删所有存储"。
2. **H3、H6** —— 改动小、风险高（ACL 静默失效、已泄露的第三方 secret）。
3. **H1、H2** —— 认证核心，建议改为数据库条件更新 + state 绑定 cookie。
4. **H4、H5、M5** —— 数据一致性与静默丢数据。
5. 其余 Medium / Low 按运维实际暴露面排期。
