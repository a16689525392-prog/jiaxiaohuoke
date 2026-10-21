# 驾校招生业务系统 · 首次正式版 v1.0.0

本次为**网页版 1.0.0 的首次 GitHub Release**；仓库也包含独立维护的微信小程序版 1.0.0 源码。正式 Release 是否已发布，请以 GitHub Releases 页面为准。

## 功能

- 校园驾校团队的产品卡、渠道与线索管理、客户分级、跟进日历与话术。
- 模拟或实际业务流程中的报名校验与学员交付清单、异常事项、转介绍与业务数据复盘。
- 多账号访问控制、SQLite 数据存储、CSV 导出、备份与恢复。
- 本地 Python 标准库部署、Ubuntu systemd 安装脚本、Docker 配置。
- 微信小程序 + 云函数版源代码（需使用者自己申请小程序与配置云开发）。

## 测试和限制

- 自动化覆盖 Python WSGI、Node 小程序模拟环境、Shell 检查及 Docker 构建/健康检查。请查看**当前发行标签对应的 GitHub Actions 记录**确认实际通过情况。
- 真实微信云环境、微信真机、实际校园组织使用案例及真实 systemd 服务环境须另行验证，不能根据模拟测试推断已通过。
- 截图使用演示数据；无法把演示数据作为真实使用量证明。
- 未配置 HTTPS 的服务不得直接在公网开放；首次安装日志中可能含初始化口令，注意保护。

## 下载、校验和安装

下载同一 Release 下的 `jiaxiao-1.0.0.tar.gz` 与 `jiaxiao-1.0.0.tar.gz.sha256`：

```bash
sha256sum -c jiaxiao-1.0.0.tar.gz.sha256
tar -xzf jiaxiao-1.0.0.tar.gz
cd jiaxiao-1.0.0
sudo bash install.sh --local-only
```

参考 [README](../README.md)、[安全部署与演示](DEPLOYMENT_DEMO.md) 与 [发布验收清单](RELEASE_READINESS.md)。这不是一个可安全直接暴露公网的 SaaS 服务。
