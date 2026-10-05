#!/bin/sh
# 驾校招生业务系统 —— 管理命令（由 install.sh 安装为 /usr/local/bin/jiaxiao）
#
#   sudo jiaxiao status                 看服务是不是在运行
#   sudo jiaxiao start | stop | restart
#   sudo jiaxiao logs [-f]              看日志（-f 持续滚动）
#   sudo jiaxiao url                    显示访问地址
#   sudo jiaxiao setup-code             查看初始化口令（第一次创建管理员用）
#   sudo jiaxiao reset-password 用户名   重置密码（管理员忘记密码时用）
#   sudo jiaxiao create-admin 用户名     再建一个管理员
#   sudo jiaxiao backup                 立即备份一次
#   sudo jiaxiao restore 备份文件        用一份备份替换现在的全部数据
#   sudo jiaxiao port 端口号             改端口
#   sudo jiaxiao serve                  在前台运行（没有 systemd 的环境用）
#   jiaxiao version
set -eu

SERVICE=jiaxiao
RUN_USER=jiaxiao
APP_DIR=/opt/jiaxiao
ENV_FILE=/etc/jiaxiao/jiaxiao.env

die() { printf '%s\n' "$*" >&2; exit 1; }

usage() { sed -n '4,15p' "$0" | sed 's/^# \{0,1\}//'; }

cmd="${1:-help}"
[ $# -gt 0 ] && shift

case "$cmd" in
  help|-h|--help) usage; exit 0 ;;
esac

[ -f "$APP_DIR/run.py" ] || die "没有找到 $APP_DIR/run.py，程序可能没装好。请重新运行安装包里的 install.sh。"
PYTHON="$(command -v python3 || true)"
[ -n "$PYTHON" ] || die "没有找到 python3。"

if [ "$cmd" = "version" ]; then exec "$PYTHON" "$APP_DIR/run.py" version; fi

[ "$(id -u)" -eq 0 ] || die "需要管理员权限，请在前面加 sudo：sudo jiaxiao $cmd"

# 读配置（KEY=VALUE，每行一个）
JX_HOST=0.0.0.0 JX_PORT=8000 JX_DATA_DIR=/var/lib/jiaxiao JX_TZ_OFFSET=8 JX_ALLOW_PUBLIC=0
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    value="$(printf '%s' "$value" | tr -d '\r')"     # 文件如果在 Windows 上编辑过，行尾会多一个回车符
    case "$key" in
      JX_HOST) JX_HOST="$value" ;; JX_PORT) JX_PORT="$value" ;; JX_DATA_DIR) JX_DATA_DIR="$value" ;;
      JX_TZ_OFFSET) JX_TZ_OFFSET="$value" ;; JX_ALLOW_PUBLIC) JX_ALLOW_PUBLIC="$value" ;;
    esac
  done < "$ENV_FILE"
fi

have_systemd() { [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; }

need_systemd() {
  have_systemd || die "这台机器没有在用 systemd，没有后台服务可管。用 sudo jiaxiao serve 在前台运行。"
}

# 以运行账号的身份执行程序自带的命令
run_app() {
  cd "$APP_DIR"
  if command -v runuser >/dev/null 2>&1; then
    runuser -u "$RUN_USER" -- env JX_HOST="$JX_HOST" JX_PORT="$JX_PORT" JX_DATA_DIR="$JX_DATA_DIR" \
      JX_TZ_OFFSET="$JX_TZ_OFFSET" JX_ALLOW_PUBLIC="$JX_ALLOW_PUBLIC" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
      "$PYTHON" "$APP_DIR/run.py" "$@"
  else
    su -s /bin/sh "$RUN_USER" -c 'exec "$0" "$@"' -- env JX_HOST="$JX_HOST" JX_PORT="$JX_PORT" \
      JX_DATA_DIR="$JX_DATA_DIR" JX_TZ_OFFSET="$JX_TZ_OFFSET" JX_ALLOW_PUBLIC="$JX_ALLOW_PUBLIC" \
      PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 "$PYTHON" "$APP_DIR/run.py" "$@"
  fi
}

# 这台机器在局域网里的地址（不算 Docker 之类的虚拟网桥，也不算公网地址）
all_ips() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show scope global 2>/dev/null |
      awk '$2 !~ /^(docker|br-|veth|virbr|lxcbr|lxdbr|cni|flannel|cali)/ { split($4, a, "/"); print a[1] }'
  else
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -v ':' || true
  fi
}
lan_ips() {
  # shellcheck disable=SC2046
  "$PYTHON" -c '
import ipaddress, sys
for text in sys.argv[1:]:
    try:
        ip = ipaddress.ip_address(text)
    except ValueError:
        continue
    if not ip.is_global and not ip.is_loopback:
        print(text)
' $(all_ips)
}

show_urls() {
  case "$JX_HOST" in
    127.0.0.1|localhost)
      echo "http://127.0.0.1:$JX_PORT      （只有这台机器自己能访问）" ;;
    0.0.0.0|'')
      echo "这台机器上：        http://127.0.0.1:$JX_PORT"
      for ip in $(lan_ips); do echo "局域网里的其他设备：http://$ip:$JX_PORT"; done ;;
    *)
      echo "http://$JX_HOST:$JX_PORT" ;;
  esac
}

case "$cmd" in
  status)
    need_systemd
    if systemctl is-active --quiet "$SERVICE"; then
      echo "服务正在运行。"
      show_urls
    else
      echo "服务没有在运行。启动：sudo jiaxiao start    看原因：sudo jiaxiao logs"
      exit 3
    fi ;;
  start|stop|restart)
    need_systemd
    systemctl "$cmd" "$SERVICE"
    case "$cmd" in stop) echo "已停止。" ;; *) sleep 1; systemctl is-active --quiet "$SERVICE" && echo "已启动。" || die "没有启动成功，运行 sudo jiaxiao logs 看原因。" ;; esac ;;
  logs)
    need_systemd
    if [ "${1:-}" = "-f" ]; then exec journalctl -u "$SERVICE" -n 50 -f; fi
    exec journalctl -u "$SERVICE" -n 100 --no-pager ;;
  url)
    show_urls ;;
  port)
    new="${1:-}"
    case "$new" in ''|*[!0-9]*) die "用法：sudo jiaxiao port 端口号   例如：sudo jiaxiao port 8080" ;; esac
    [ "$new" -ge 1024 ] && [ "$new" -le 65535 ] || die "端口要在 1024 到 65535 之间。"
    [ -f "$ENV_FILE" ] || die "没有找到 $ENV_FILE。"
    if grep -q '^JX_PORT=' "$ENV_FILE"; then sed -i "s|^JX_PORT=.*|JX_PORT=$new|" "$ENV_FILE"; else echo "JX_PORT=$new" >> "$ENV_FILE"; fi
    JX_PORT="$new"
    echo "端口已改成 $new。"
    if have_systemd; then
      systemctl restart "$SERVICE"
      sleep 1
      systemctl is-active --quiet "$SERVICE" || die "服务没有启动成功（端口可能被别的程序占用了），运行 sudo jiaxiao logs 看原因。"
      show_urls
    fi ;;
  serve)
    if have_systemd && systemctl is-active --quiet "$SERVICE"; then
      die "后台服务已经在运行了，不需要再前台启动。看状态：sudo jiaxiao status"
    fi
    run_app serve ;;
  setup-code|backup|create-admin|reset-password)
    run_app "$cmd" "$@" ;;
  restore)
    src="${1:-}"
    [ -n "$src" ] || die "用法：sudo jiaxiao restore 备份文件
可以写 $JX_DATA_DIR/backups 里的文件名，也可以写任意位置的备份文件路径。
现有的备份：
$(ls -1t "$JX_DATA_DIR/backups" 2>/dev/null | grep '^jiaxiao-' | head -n 10 || true)"
    shift
    tmpdir=""
    if [ -f "$src" ]; then
      if [ "$(readlink -f "$src")" = "$(readlink -f "$JX_DATA_DIR/jiaxiao.db")" ]; then
        die "这就是正在使用的数据库，不是备份。备份文件在 $JX_DATA_DIR/backups 里。"
      fi
      # 备份文件可能在运行账号读不到的地方（比如你的主目录），先放一份到数据目录里
      tmpdir="$JX_DATA_DIR/restore-$$"
      install -d -o "$RUN_USER" -g "$RUN_USER" -m 0700 "$tmpdir"
      install -o "$RUN_USER" -g "$RUN_USER" -m 0600 "$src" "$tmpdir/$(basename "$src")"
      src="$tmpdir/$(basename "$src")"
    fi
    was_active=0
    if have_systemd && systemctl is-active --quiet "$SERVICE"; then was_active=1; systemctl stop "$SERVICE"; fi
    status=0
    run_app restore "$src" "$@" || status=$?
    if [ -n "$tmpdir" ]; then rm -rf "$tmpdir"; fi
    if [ "$was_active" -eq 1 ]; then systemctl start "$SERVICE"; echo "服务已重新启动。"; fi
    exit "$status" ;;
  *)
    echo "不认识的命令：$cmd" >&2
    usage >&2
    exit 2 ;;
esac
