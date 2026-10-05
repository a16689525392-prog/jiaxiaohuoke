#!/usr/bin/env bash
# 驾校招生业务系统 —— 安装 / 升级脚本（Ubuntu）
#
#   sudo bash install.sh                 安装，或者在已安装的机器上升级（数据不动）
#   sudo bash install.sh --port 8080     换一个端口
#   sudo bash install.sh --local-only    只允许本机访问（监听 127.0.0.1）
#   sudo bash install.sh --lan           允许局域网访问（监听 0.0.0.0，默认就是这样）
#
# 只用系统自带的 python3，不联网，不装任何别的软件，不改防火墙。
set -euo pipefail

APP_NAME="驾校招生业务系统"
SERVICE="jiaxiao"
RUN_USER="jiaxiao"
APP_DIR="/opt/jiaxiao"
DATA_DIR="/var/lib/jiaxiao"
CONF_DIR="/etc/jiaxiao"
ENV_FILE="$CONF_DIR/jiaxiao.env"
UNIT_FILE="/etc/systemd/system/$SERVICE.service"
CLI="/usr/local/bin/jiaxiao"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say()  { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die()  { printf '\n安装没有完成：%s\n' "$*" >&2; exit 1; }

PORT="" HOST="" START=1
while [ $# -gt 0 ]; do
  case "$1" in
    --port)        [ $# -ge 2 ] || die "--port 后面要跟端口号，例如 --port 8080"; PORT="$2"; shift 2 ;;
    --port=*)      PORT="${1#*=}"; shift ;;
    --local-only)  HOST="127.0.0.1"; shift ;;
    --lan)         HOST="0.0.0.0"; shift ;;
    --no-start)    START=0; shift ;;
    -h|--help)     sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             die "不认识的参数：$1（用 --help 看用法）" ;;
  esac
done

# ---------------------------------------------------------------- 检查环境
[ "$(uname -s)" = "Linux" ] || die "这个脚本只能在 Linux（Ubuntu）上运行。"
[ "$(id -u)" -eq 0 ] || die "需要管理员权限，请这样运行：sudo bash install.sh"
for f in run.py app/__init__.py templates/base.tpl static/app.css deploy/jiaxiao.service deploy/jiaxiao.sh; do
  [ -f "$SRC_DIR/$f" ] || die "安装包不完整，缺少 $f。请重新解压整个安装包再运行。"
done
case "$SRC_DIR" in "$APP_DIR"|"$APP_DIR"/*) die "请不要在 $APP_DIR 里面运行安装脚本，把安装包解压到别的目录（比如你的主目录）再运行。" ;; esac

PYTHON="$(command -v python3 || true)"
[ -n "$PYTHON" ] || die "没有找到 python3。先运行：sudo apt update && sudo apt install -y python3"
"$PYTHON" - <<'PY' || die "python3 环境不满足要求（见上面的提示）。"
import sys
if sys.version_info < (3, 8):
    sys.exit("需要 Python 3.8 或更高版本，这台机器是 %s。Ubuntu 20.04 及以后的版本自带的 python3 都满足。" % sys.version.split()[0])
try:
    import sqlite3
except ImportError:
    sys.exit("这个 python3 没有 sqlite3 模块。运行：sudo apt install -y python3 libsqlite3-0")
if sqlite3.sqlite_version_info < (3, 24):
    sys.exit("需要 SQLite 3.24 或更高版本，这台机器是 %s。" % sqlite3.sqlite_version)
PY

if [ -n "$PORT" ]; then
  case "$PORT" in ''|*[!0-9]*) die "端口必须是数字：$PORT" ;; esac
  [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "端口要在 1 到 65535 之间：$PORT"
  [ "$PORT" -ge 1024 ] || die "请用 1024 以上的端口（服务不以 root 身份运行，用不了 $PORT）。"
fi

HAVE_SYSTEMD=0
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then HAVE_SYSTEMD=1; fi

UPGRADE=0
[ -f "$APP_DIR/run.py" ] && UPGRADE=1

# 这台机器的 IPv4 地址（不算 Docker 之类的虚拟网桥），分成内网地址和公网地址
lan_ips() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global 2>/dev/null |
      awk '$2 !~ /^(docker|br-|veth|virbr|lxcbr|lxdbr|cni|flannel|cali)/ { split($4, a, "/"); print a[1] }'
  else
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -v ':' || true
  fi
}
classify_ips() {   # classify_ips private|public 地址...
  "$PYTHON" - "$@" <<'PY'
import ipaddress, sys
want_public = sys.argv[1] == "public"
out = []
for text in sys.argv[2:]:
    try:
        ip = ipaddress.ip_address(text)
    except ValueError:
        continue
    if ip.is_global == want_public and not ip.is_loopback:
        out.append(text)
print(" ".join(out))
PY
}
# shellcheck disable=SC2046
ALL_IPS="$(lan_ips | tr '\n' ' ')"
# shellcheck disable=SC2086
PRIVATE_IPS="$(classify_ips private $ALL_IPS)"
# shellcheck disable=SC2086
PUBLIC_IPS="$(classify_ips public $ALL_IPS)"

# 读已有的配置（升级时保留）
conf_get() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 || true; }
OLD_PORT="$(conf_get JX_PORT)"; OLD_HOST="$(conf_get JX_HOST)"
PORT="${PORT:-${OLD_PORT:-8000}}"
AUTO_LOCAL=0
if [ -z "$HOST" ] && [ -z "$OLD_HOST" ] && [ -n "$PUBLIC_IPS" ]; then
  # 网卡上直接有公网地址：默认不对外监听，免得把明文 http 的登录页挂到公网上
  HOST="127.0.0.1"; AUTO_LOCAL=1
fi
HOST="${HOST:-${OLD_HOST:-0.0.0.0}}"

if [ "$UPGRADE" -eq 1 ]; then
  step "检测到已经安装过，这次是升级（数据和设置都保留）"
else
  step "开始安装 $APP_NAME"
fi

# ---------------------------------------------------------------- 停掉旧服务，确认端口可用
# 升级中途如果出错退出，把原来在运行的服务重新拉起来，不让系统停在半路。
WAS_ACTIVE=0 FINISHED=0 REPLACED=0
restart_if_unfinished() {
  if [ "$FINISHED" -eq 0 ] && [ "$WAS_ACTIVE" -eq 1 ]; then
    if systemctl start "$SERVICE" 2>/dev/null && [ "$REPLACED" -eq 0 ]; then
      printf '（没有改动任何文件，原来的服务已经重新启动。）\n' >&2
    fi
  fi
}
trap restart_if_unfinished EXIT
if [ "$HAVE_SYSTEMD" -eq 1 ]; then
  if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then WAS_ACTIVE=1; fi
  systemctl stop "$SERVICE" 2>/dev/null || true
fi
"$PYTHON" - "$HOST" "$PORT" <<'PY' || die "端口 $PORT 已经被别的程序占用。换一个端口再装，例如：sudo bash install.sh --port 8080"
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket(socket.AF_INET6 if ":" in host else socket.AF_INET)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind((host, port))
except OSError as e:
    sys.exit(1)
finally:
    s.close()
PY

# ---------------------------------------------------------------- 账号、目录、程序文件
step "准备运行账号和目录"
if ! id "$RUN_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$RUN_USER"
  say "已创建系统账号 $RUN_USER（不能登录，只用来运行这个服务）"
fi
install -d -m 0755 -o root -g root "$APP_DIR" "$CONF_DIR"
install -d -m 0750 -o "$RUN_USER" -g "$RUN_USER" "$DATA_DIR"

step "复制程序文件到 $APP_DIR"
REPLACED=1
rm -rf "$APP_DIR/app" "$APP_DIR/templates" "$APP_DIR/static" "$APP_DIR/tests" "$APP_DIR/deploy"
cp -R "$SRC_DIR/app" "$SRC_DIR/templates" "$SRC_DIR/static" "$SRC_DIR/deploy" "$APP_DIR/"
[ -d "$SRC_DIR/tests" ] && cp -R "$SRC_DIR/tests" "$APP_DIR/"
install -m 0644 "$SRC_DIR/run.py" "$APP_DIR/run.py"
for f in README.md uninstall.sh; do [ -f "$SRC_DIR/$f" ] && install -m 0644 "$SRC_DIR/$f" "$APP_DIR/$f"; done
find "$APP_DIR" -name '__pycache__' -type d -prune -exec rm -rf {} +
chown -R root:root "$APP_DIR"
chmod -R u=rwX,go=rX "$APP_DIR"
"$PYTHON" -m compileall -q "$APP_DIR/app" "$APP_DIR/run.py" >/dev/null 2>&1 || true

step "写配置 $ENV_FILE"
conf_set() {   # conf_set KEY VALUE —— 有就改，没有就加
  if grep -q "^$1=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
# $APP_NAME 的运行设置。改完以后运行：sudo systemctl restart $SERVICE
# 监听地址：0.0.0.0 = 局域网里的设备都能访问；127.0.0.1 = 只有这台机器自己能访问
JX_HOST=$HOST
# 端口
JX_PORT=$PORT
# 数据目录（数据库和备份）。安装脚本和服务都按这个目录设置，一般不要改
JX_DATA_DIR=$DATA_DIR
# “今天”按哪个时区算：东八区（北京时间）填 8
JX_TZ_OFFSET=8
# 默认只接受内网和本机的访问。确实要让公网地址访问（不建议，系统用的是不加密的 http）才改成 1
JX_ALLOW_PUBLIC=0
EOF
else
  conf_set JX_HOST "$HOST"
  conf_set JX_PORT "$PORT"
  grep -q '^JX_DATA_DIR=' "$ENV_FILE" || conf_set JX_DATA_DIR "$DATA_DIR"
fi
chown root:root "$ENV_FILE"; chmod 0644 "$ENV_FILE"

install -m 0755 "$SRC_DIR/deploy/jiaxiao.sh" "$CLI"

# ---------------------------------------------------------------- 开机自启的服务
STARTED=0
if [ "$HAVE_SYSTEMD" -eq 1 ]; then
  step "注册系统服务（开机自动启动）"
  sed "s|@PYTHON@|$PYTHON|g" "$SRC_DIR/deploy/jiaxiao.service" > "$UNIT_FILE"
  chmod 0644 "$UNIT_FILE"
  systemctl daemon-reload
  systemctl enable "$SERVICE" >/dev/null 2>&1 || true
  if [ "$START" -eq 1 ]; then
    systemctl restart "$SERVICE" || true     # 启动不了的话，下面的检查会把日志打出来
    step "等待服务启动"
    for _ in $(seq 1 40); do
      if "$PYTHON" - "$PORT" <<'PY' 2>/dev/null
import sys, urllib.request
urllib.request.urlopen("http://127.0.0.1:%s/healthz" % sys.argv[1], timeout=2).read()
PY
      then STARTED=1; break; fi
      sleep 0.5
    done
    if [ "$STARTED" -ne 1 ] && [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "0.0.0.0" ]; then
      systemctl is-active --quiet "$SERVICE" && STARTED=1   # 监听在某个指定地址上，本机回环探测不到
    fi
    if [ "$STARTED" -ne 1 ]; then
      say ""
      journalctl -u "$SERVICE" -n 30 --no-pager 2>/dev/null || true
      die "服务没有正常启动，上面是最近的日志。也可以运行 sudo jiaxiao logs 查看。"
    fi
  fi
else
  say ""
  say "这台机器没有在用 systemd（例如在容器里），所以没有注册开机自启的服务。"
  say "程序已经装好，可以这样在前台启动：  sudo jiaxiao serve"
fi

# ---------------------------------------------------------------- 结果
FINISHED=1
SETUP_CODE="$("$CLI" setup-code 2>/dev/null || true)"
say ""
say "=============================================================="
if [ "$UPGRADE" -eq 1 ]; then say "  $APP_NAME 已升级到 $("$CLI" version 2>/dev/null || echo '新版本')"; else say "  $APP_NAME 安装完成"; fi
say "=============================================================="
if [ "$STARTED" -eq 1 ]; then
  say ""
  say "用浏览器打开："
  case "$HOST" in
    127.0.0.1)
      say "    http://127.0.0.1:$PORT      （只有这台机器自己能访问）" ;;
    0.0.0.0)
      say "    这台机器上：        http://127.0.0.1:$PORT"
      for ip in $PRIVATE_IPS; do say "    局域网里的其他设备：http://$ip:$PORT"; done ;;
    *)
      say "    http://$HOST:$PORT" ;;
  esac
elif [ "$HAVE_SYSTEMD" -eq 1 ]; then
  say ""
  say "服务已经注册，还没有启动。启动：sudo jiaxiao start"
fi
if [ "$AUTO_LOCAL" -eq 1 ]; then
  say ""
  say "这台机器的网卡上有公网地址（$PUBLIC_IPS），所以这次只开放给本机访问，没有对外监听。"
  say "如果它其实在可信的内网里、要让局域网的设备也能打开，重新运行：sudo bash install.sh --lan"
fi
case "$SETUP_CODE" in
  ????-????)
    say ""
    say "第一次打开会让你创建管理员账号，需要填这个初始化口令："
    say ""
    say "    $SETUP_CODE"
    say ""
    say "（之后想再看：sudo jiaxiao setup-code）" ;;
esac
say ""
say "数据在 $DATA_DIR（数据库和每天的自动备份），升级和重装都不会动它。"
say "常用命令： sudo jiaxiao status | restart | logs | backup | reset-password 用户名"
if [ "$HOST" != "127.0.0.1" ]; then
  say ""
  say "注意：这套系统用的是不加密的 http，只适合在内网使用。"
  say "  · 不要在路由器或云服务器的安全组里把 $PORT 端口开放到公网；"
  say "  · 系统自己也会拒绝来自公网地址的访问。"
  if [ -n "$PUBLIC_IPS" ]; then
    say "  · 这台机器的网卡上有公网地址（$PUBLIC_IPS），$PORT 端口现在对公网是开着的，"
    say "    请用防火墙或安全组挡住它，或者改成只允许本机访问：sudo bash install.sh --local-only"
  fi
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    say "  · 这台机器开着 ufw 防火墙，局域网里别的设备打不开的话，放行本网段即可，例如："
    say "        sudo ufw allow from 192.168.0.0/16 to any port $PORT proto tcp"
  fi
fi
say ""
