# 发布与验收清单（网页版 1.0.0）

> 状态：**发布准备材料**，不是已经发布的 GitHub Release。以 GitHub Releases 页面实际显示为准。
>
> 版本选择：仓库 `app/core.py` 已声明 `VERSION = "1.0.0"`，CHANGELOG 也记录了网页版 1.0.0；因此首次正式标签应使用 **v1.0.0**，不要倒退至 v0.1.0。小程序在 `wechat-miniprogram/cloudfunctions/api/config.js` 单独管理版本，GitHub 的 `v*` 发行包以网页版为主。

## 代码审查基线（2026-10-21）

- 仓库公开，MIT 许可证；两个实现分别位于根目录和 `wechat-miniprogram/`。
- 已有 `tests/test_app.py` 的 WSGI 测试，以及 Node 云函数/小程序模拟运行时测试。
- GitHub Actions CI 含 Python 3.8–3.13、Node 18/20/22、Shell 语法及 Docker 健康检查；历史成功运行不等于本次变更自动通过。
- `docs/screenshots/` 已有演示数据截图，但截图不是实际校园门店运营证据。
- 本次编写的演示手册和证据模板不意味着已真实部署到学校或完成真实试点。

## 首次 v1.0.0 发布门槛

- [ ] `main` 最新 CI 全部通过；核对对应提交 SHA。
- [ ] 完成本地/内网应用实操：初始化→登录→产品卡→客户→跟进→学员交付；按 [DEPLOYMENT_DEMO.md](DEPLOYMENT_DEMO.md) 留存去敏感化证据。
- [ ] 截图能追溯到版本、运行环境、采集者和时间；勿公开真实客户姓名、微信、手机号、身份证号及账号口令。
- [ ] 安全确认：内网限制生效；如使用反向代理，应确认 HTTPS、额外访问控制及备份权限。
- [ ] 审核 `CHANGELOG.md`、`docs/RELEASE_NOTES_1.0.0.md` 与版本值一致。
- [ ] 由维护者在 GitHub 仓库主分支上创建并推送 **注释标签** `v1.0.0`，触发 `.github/workflows/release.yml`。
- [ ] Release 工作流通过，并确认 Releases 页面包含安装包和 SHA-256 校验文件。
- [ ] 下载包、校验 SHA-256、在隔离的测试环境完成一次安装与登录验证。

## 创建首次 Release（需在主分支测试通过后）

```bash
git checkout main
git pull --ff-only
python3 run.py version        # 预期为 1.0.0
python3 -m unittest discover -s tests -v
(cd wechat-miniprogram && node --test tests/test_*.js)
git tag -a v1.0.0 -m "jiaxiao web v1.0.0"
git push origin v1.0.0
```

在仓库 **Actions → Release** 检查结果，然后检查 **Releases** 页面。如果失败，先修复原因，避免直接对同一个标签进行强制覆盖。不要将尚未完成的发布称为“已发布”。

## 校验发行包

```bash
sha256sum -c jiaxiao-1.0.0.tar.gz.sha256
tar -tzf jiaxiao-1.0.0.tar.gz | grep -E '(^jiaxiao-1.0.0/(run.py|README.md|wechat-miniprogram/README.md|docs/DEPLOYMENT_DEMO.md)$)'
```

版本初次发布与后续 1.0.x 修订必须分开记录。无法通过自动化测试证明现实业务成效，真实用户与反馈仅在获得授权、脱敏且有来源时记录。
