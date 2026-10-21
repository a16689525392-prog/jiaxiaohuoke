# 安全部署与操作演示（可复现）

> **演示流程，不是现场使用报告。** 本文依据仓库提供的 `run.py`、`install.sh`、Docker 配置和现有自动化测试编写。每次实测须附版本、日期、环境、执行结果。截图只能证明画面，不能替代实际使用反馈。

## 1. 本地无依赖演示（适合录屏）

准备 Python 3.8+、SQLite 3.24+；选择一台与真实客户数据隔离的机器。**不要录制或传播初始化口令。**

```bash
git clone https://github.com/a16689525392-prog/jiaxiaohuoke.git
cd jiaxiaohuoke
python3 run.py version
JX_HOST=127.0.0.1 JX_PORT=8000 JX_DATA_DIR="$(mktemp -d)" python3 run.py
```

浏览器访问 `http://127.0.0.1:8000`。初始化口令只在本地终端读取并输入，不记录进截图或仓库。录屏结束后停止服务，安全删除临时数据目录。

**建议演示脚本（全部使用虚构演示数据，不能声称来自真实驾校）：**

| 步骤 | 操作 | 可核对的页面/结果 |
| --- | --- | --- |
| 1 | 使用初始化口令创建管理员 | 首次初始化、管理入口 |
| 2 | 新建演示班型并核对待确认项 | 产品卡与对客展示 |
| 3 | 新建演示客户并选择渠道/等级 | 客户列表与详情 |
| 4 | 写入沟通记录与下次跟进日期 | 今日待办与跟进日历 |
| 5 | 完成付款前核对后使用模拟业务流程建立学员 | 交付节点；**不要产生真实收款记录** |
| 6 | 查看数据看板与导出入口 | 统计视图、权限范围 |
| 7 | 登出并用未登录状态访问受保护页面 | 应跳到登录 |

### Docker 验证（与普通安装二选一）

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8000/healthz
docker compose logs jiaxiao | tail -50
docker compose down
```

`docker compose` 映射端口可能对所有网卡开放：测试机应通过防火墙或绑定本机地址限制访问，不要把 HTTP 管理系统直接暴露至公网。日志含初始化口令，不得公开上传。

### Ubuntu systemd 实机核验（必须在可用的 Ubuntu 测试机执行）

```bash
sudo bash install.sh --local-only
sudo jiaxiao status
curl -fsS http://127.0.0.1:8000/healthz
sudo jiaxiao backup
```

若 CI 通过只可说明构建和健康检查通过，不能称为已验证真实 systemd 服务启动。

## 2. 已存在的演示截图

仓库 `docs/screenshots/` 有网页版 `home.png`、`customers.png`、`product.png`、`data.png`、`scripts.png`、`channels.png`、`calendar.png`、`referrals.png` 等，README 已以“演示数据”明确标注。小程序截图来自 `wechat-miniprogram/tests/mp/shots.js` 的本地渲染器，**不是**微信真机照片。旧图的原始采集环境和日期如未留档，请标为“历史演示素材（采集信息未核实）”。

## 3. 新截图/录屏的取证办法

1. 在隔离数据目录启动同一个已记录 SHA 的版本，记录日期、OS、Python/Node 版本、部署方式。
2. 仅填演示数据；录制电脑和手机屏幕宽度，显示登录后主页、客户、跟进、交付；录屏里不要出现凭据。
3. 截图存入 `docs/screenshots/verified/`，另存 `docs/screenshots/verified/manifest.md` 写下文件名、Git SHA、采集方法、日期、测试结果，并标注“演示数据”。
4. 用 `sha256sum 文件名` 记录附件摘要，确保素材能够复核；**禁止捏造结果或生成假装真实使用的截图**。
5. 真实业务团队的使用截图只有在取得授权、充分脱敏后才能公开。请勿把真实微信聊天、联系人、合同或付款信息上传 GitHub。

## 4. 演示记录模板

- 日期与时区：待填写
- commit SHA / tag：待填写
- 部署方式（本地 / Docker / systemd / 微信云环境）：待填写
- 浏览器及终端环境：待填写
- 测试范围与结果（含失败项）：待填写
- 截图路径 / 录屏地址（演示数据）：待填写
- 限制 / 未验证项：待填写
- 验证人：待填写

> 微信小程序本地测试采用模拟运行时；真机与真实微信云开发行为须单独验证，不因截图或 Node 测试成功而视作通过。
