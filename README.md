<div align="center">

  <p><em>chaos-oss — 基于 OpenList 的二次构建（个人维护分支）</em></p>

  <a href="https://github.com/chao2hang/chaos-oss/blob/main/LICENSE"><img src="https://img.shields.io/github/license/chao2hang/chaos-oss" alt="License" /></a>
  <a href="https://github.com/chao2hang/chaos-oss/releases"><img src="https://img.shields.io/github/release/chao2hang/chaos-oss" alt="latest version" /></a>
  <a href="https://github.com/chao2hang/chaos-oss/releases"><img src="https://img.shields.io/github/downloads/chao2hang/chaos-oss/total?color=%239F7AEA&logo=github" alt="Downloads" /></a>

</div>

---

> **本项目是 [OpenList](https://github.com/OpenListTeam/OpenList)（AList 的社区维护 fork，AGPL-3.0）的个人二次构建版本。**
> 代码基于 OpenList 上游持续跟踪，用于个人部署与定制。上游功能、Bug 与特性请优先参考 [OpenList 官方仓库](https://github.com/OpenListTeam/OpenList)。

- English | [中文](./README/README_cn.md)
- [上游 OpenList](https://github.com/OpenListTeam/OpenList)
- [LICENSE](./LICENSE)

## 功能特性

- [x] 多存储支持
  - [x] 本地存储
  - [x] [阿里云盘](https://www.alipan.com)
  - [x] OneDrive / Sharepoint（全球、中国、德国、美国）
  - [x] [天翼云盘 189cloud](https://cloud.189.cn)（个人、家庭）
  - [x] [GoogleDrive](https://drive.google.com)
  - [x] [123 云盘](https://www.123pan.com)
  - [x] [FTP / SFTP](https://en.wikipedia.org/wiki/File_Transfer_Protocol)
  - [x] [PikPak](https://www.mypikpak.com)
  - [x] [S3](https://aws.amazon.com/s3)
  - [x] [Seafile](https://seafile.com)
  - [x] [又拍云 USS](https://www.upyun.com/products/file-storage)
  - [x] [WebDAV](https://en.wikipedia.org/wiki/WebDAV)
  - [x] Teambition（国内 / 国际版）
  - [x] [MediaFire](https://www.mediafire.com)
  - [x] [Mediatrack](https://www.mediatrack.cn)
  - [x] [ProtonDrive](https://proton.me/drive)
  - [x] [139 云盘](https://yun.139.com)（个人、家庭、群组、分享）
  - [x] [YandexDisk](https://disk.yandex.com)
  - [x] [百度网盘](http://pan.baidu.com)
  - [x] [Terabox](https://www.terabox.com/main)
  - [x] [UC](https://drive.uc.cn)
  - [x] [夸克](https://pan.quark.cn)
  - [x] [迅雷](https://pan.xunlei.com)
  - [x] [蓝奏云](https://www.lanzou.com)
  - [x] [ILanzou](https://www.ilanzou.com)
  - [x] [Google 相册](https://photos.google.com)
  - [x] [Mega.nz](https://mega.nz)
  - [x] [百度相册](https://photo.baidu.com)
  - [x] [SMB](https://en.wikipedia.org/wiki/Server_Message_Block)
  - [x] [115](https://115.com)
  - [x] [Cloudreve](https://cloudreve.org)
  - [x] [Dropbox](https://www.dropbox.com)
  - [x] [FeijiPan](https://www.feijipan.com)
  - [x] [dogecloud](https://www.dogecloud.com/product/oss)
  - [x] [Azure Blob Storage](https://azure.microsoft.com/products/storage/blobs)
  - [x] [超星 Chaoxing](https://www.chaoxing.com)
  - [x] [CNB](https://cnb.cool/)
  - [x] [Degoo](https://degoo.com)
  - [x] [豆包 Doubao](https://www.doubao.com)
  - [x] [Febbox](https://www.febbox.com)
  - [x] [GitHub](https://github.com)
  - [x] [OpenList](https://github.com/OpenListTeam/OpenList)
  - [x] [Teldrive](https://github.com/tgdrive/teldrive)
  - [x] [微云 Weiyun](https://www.weiyun.com)
  - [x] [钉钉文档](https://alidocs.dingtalk.com/)
- [x] 开箱即用，易于部署
- [x] 文件预览（PDF、Markdown、代码、纯文本等）
- [x] 画廊模式图片预览
- [x] 视频与音频预览，支持歌词和字幕
- [x] Office 文档预览（docx、pptx、xlsx 等）
- [x] `README.md` 预览渲染
- [x] 文件永久链接与直链下载
- [x] 暗色模式
- [x] 国际化（I18n）
- [x] 受保护路由（密码保护与身份认证）
- [x] WebDAV
- [x] Docker 部署
- [x] Cloudflare Workers 代理
- [x] 文件/文件夹打包下载
- [x] Web 上传（可允许访客上传）、删除、新建目录、重命名、移动与复制
- [x] 离线下载
- [x] 存储间文件复制
- [x] 单线程下载/流的多线程加速

## 构建

构建脚本与上游保持一致，详细用法见 `build.sh`：

```bash
# 本地 Docker 镜像（dev 版，自动拉取前端）
./build.sh dev docker

# 开发版（Linux musl amd64/arm64 + Windows/Darwin）
./build.sh dev

# 正式发布（全平台）
./build.sh release
```

- 前端产物在构建时自动从上游 `OpenListTeam/OpenList-Frontend` 拉取，无需手动准备。
- Go 版本要求：`go.mod` 声明 Go 1.25。
- 多语言构建（Windows 7 / LoongArch 等）需要对应的交叉编译工具链，脚本会自动下载。

## 许可证

本项目为 [OpenList](https://github.com/OpenListTeam/OpenList) 的派生项目，遵循上游的 [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.txt) 开源许可证，详见 [LICENSE](./LICENSE)。

## 免责声明

- 本项目是免费开源软件，用于通过网盘进行文件分享，仅作技术学习用途。
- 使用本软件时请遵守所有适用法律法规，禁止任何形式的滥用。
- 软件基于官方 SDK 或 API，未对其行为进行任何修改、破坏或干扰。
- 仅执行 HTTP 302 跳转或流量转发，不拦截、存储或篡改任何用户数据。
- 本项目与任何官方平台或服务提供商均无关联。
- 软件按"原样"提供，不附带任何明示或暗示的担保。
- 维护者对因使用本软件而产生的任何直接或间接损害概不负责。
- 使用本软件带来的任何风险（包括但不限于账号封禁或下载限速）由使用者自行承担。

## 致谢

- 感谢 [OpenList](https://github.com/OpenListTeam/OpenList) 团队维护的上游项目。
- 感谢原项目 [AlistGo/alist](https://github.com/AlistGo/alist) 作者 [Xhofe](https://github.com/Xhofe) 及所有贡献者。
