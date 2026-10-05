#!/usr/bin/env bash
# 驾校招生业务系统 —— 卸载脚本
#
#   sudo bash uninstall.sh            卸载程序和服务，数据保留在 /var/lib/jiaxiao
#   sudo bash uninstall.sh --purge    连数据一起删除（客户、学员、备份全部删掉，不能恢复）
set -euo pipefail

SERVICE="jiaxiao"
RUN_USER="jiaxiao"
APP_DIR="/opt/jiaxiao"
DATA_DIR="/var/lib/jiaxiao"
CONF_DIR="/etc/jiaxiao"
UNIT_FILE="/etc/systemd/system/$SERVICE.service"
CLI="/usr/local/bin/jiaxiao"

PURGE=0 YES=0
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    --yes)   YES=1 ;;
    -h|--help) sed -n '2,5p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "不认识的参数：$arg" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "需要管理员权限，请这样运行：sudo bash uninstall.sh" >&2; exit 1; }

if [ "$PURGE" -eq 1 ] && [ "$YES" -ne 1 ]; then
  echo "这会删除 $DATA_DIR 里的全部数据：客户、跟进记录、学员、备份。删了就找不回来。"
  printf '确定要删的话，输入 DELETE 再回车：'
  read -r answer || answer=""
  [ "$answer" = "DELETE" ] || { echo "已取消，什么都没动。"; exit 1; }
fi

if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
  systemctl stop "$SERVICE" 2>/dev/null || true
  systemctl disable "$SERVICE" >/dev/null 2>&1 || true
  rm -f "$UNIT_FILE"
  systemctl daemon-reload
else
  rm -f "$UNIT_FILE"
fi
rm -f "$CLI"
rm -rf "$APP_DIR" "$CONF_DIR"
echo "程序和服务已卸载。"

if [ "$PURGE" -eq 1 ]; then
  rm -rf "$DATA_DIR"
  if id "$RUN_USER" >/dev/null 2>&1; then userdel "$RUN_USER" 2>/dev/null || true; fi
  echo "数据已删除。"
else
  echo "数据还在 $DATA_DIR（数据库 jiaxiao.db 和 backups 目录）。"
  echo "以后重新运行 install.sh，会接着用这些数据；确实不要了再运行：sudo rm -rf $DATA_DIR"
fi
