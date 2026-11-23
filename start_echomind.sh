#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="${SOFTWARE_AGENT_SDK_DIR:-${ROOT}/../software-agent-sdk}"
ENV_FILE="${ECHOMIND_ENV_FILE:-${ROOT}/.env.echomind.local}"
MODE=start
INSTALL=1

usage() {
  cat <<'HELP'
用法：bash start_echomind.sh [--check | --install-only] [--skip-install]
  默认安装依赖并启动前后端，Ctrl+C 同时停止。
  --check         仅检查工具与配置，不安装、不启动、不连接数据库
  --install-only  安装依赖，不启动服务
  --skip-install  跳过 make build / 前端 npm ci；后端仍执行自身初始化
配置：先在同一个终端 export，或写入 .env.echomind.local（Shell 语法）。
路径：SOFTWARE_AGENT_SDK_DIR 指定后端；ECHOMIND_ENV_FILE 指定配置文件。
日志页面：http://127.0.0.1:5173/logs（默认展示后端全部日志，不按用户过滤）。
原始日志：logs/echomind/backend.log；ECHOMIND_LOG_FILE 可指定日志文件。
旧版实时日志查看器：ECHOMIND_ENABLE_RAW_LOG_VIEWER=1 启用，ECHOMIND_LOG_PORT 指定端口（默认8002）。
HELP
}

for arg in "$@"; do
  case "$arg" in
    --check) MODE=check ;;
    --install-only) MODE=install ;;
    --skip-install) INSTALL=0 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }
[[ -f "$BACKEND/start_inference.sh" ]] || fail "找不到后端：$BACKEND"
BACKEND="$(cd "$BACKEND" && pwd)"
export SOFTWARE_AGENT_SDK_DIR="$BACKEND"

# This is an explicit local Shell configuration, so it can contain export commands.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi
export SOFTWARE_AGENT_SDK_DIR="$BACKEND"

if [[ "$MODE" != check ]]; then
  if ! command -v uv >/dev/null || ! command -v node >/dev/null || ! command -v npm >/dev/null; then
    command -v brew >/dev/null || fail "请先安装 uv 和 Node >=22.19.0（macOS 可使用 Homebrew）。"
    command -v uv >/dev/null || brew install uv
    if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
      brew install node
    fi
  fi
fi
for tool in uv node npm make; do
  command -v "$tool" >/dev/null || fail "缺少 $tool"
done
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22 || (a===22 && b>=19) ? 0 : 1)' \
  || fail "Node 版本过低，需要 >=22.19.0；请切换或升级当前 Node。"

# Match start_inference.sh: exported variables win over its dotenv file.
if [[ -f "$BACKEND/.env.test.local" ]]; then
  [[ "$MODE" == check ]] || uv sync --project "$BACKEND" --frozen
  [[ -x "$BACKEND/.venv/bin/python" ]] || fail "检查 dotenv 需要后端 .venv，请先安装依赖。"
  dotenv_exports="$("$BACKEND/.venv/bin/python" - "$BACKEND/.env.test.local" <<'PY'
import os
import re
import shlex
import sys
from dotenv import dotenv_values
for name, value in dotenv_values(sys.argv[1], interpolate=False).items():
    if value is not None and name not in os.environ:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            raise ValueError("Invalid dotenv variable name")
        print(f"export {name}={shlex.quote(value)}")
PY
  )"
  eval "$dotenv_exports"
  unset dotenv_exports
fi

export EXPERIMENT_DB_BACKEND="${EXPERIMENT_DB_BACKEND:-mariadb}"
case "$EXPERIMENT_DB_BACKEND" in
  mariadb)
    db_env="${EXPERIMENT_PLAN_ENV_FILE:-$BACKEND/.env.experiment-plans.local}"
    if [[ -z "${EXPERIMENT_PLAN_DATABASE_URL:-}" && -f "$db_env" ]]; then
      source "$db_env"
    fi
    [[ -n "${EXPERIMENT_PLAN_DATABASE_URL:-}" ]] || fail "缺少 EXPERIMENT_PLAN_DATABASE_URL；本地 SQLite 可设置 EXPERIMENT_DB_BACKEND=sqlite。"
    export EXPERIMENT_PLAN_DATABASE_URL
    ;;
  sqlite) ;;
  *) fail "EXPERIMENT_DB_BACKEND 只能是 sqlite 或 mariadb" ;;
esac
[[ -n "${OPENAI_API_KEY:-}" ]] || fail "请 export OPENAI_API_KEY，或在 $ENV_FILE 中配置。"
[[ -n "${DF_API_KEY:-${OPENROUTER_API_KEY:-}}" ]] || fail "请配置 OPENROUTER_API_KEY 或 DF_API_KEY。"
case "${OH_ENABLE_PYROMIND_JWT_AUTH:-true}" in
  true|True|TRUE|1)
    if [[ "${APP_ENV:-prod}" != dev && -z "${PYROMIND_WEB_SECRET_KEY:-${PYROMIND_AGENT_ACCESS_KEY_REQUEST_SECRET:-}}" ]]; then
      [[ -s "${PYROMIND_SECRET_PATH:-/etc/secrets}/web_secret_key" ]] \
        || fail "缺少 Studio JWT 签名配置：PYROMIND_WEB_SECRET_KEY 或 PYROMIND_AGENT_ACCESS_KEY_REQUEST_SECRET。"
    fi
    ;;
esac
echo "工具与必要配置检查通过（未检查网络、密钥有效性及数据库连接）。"
[[ "$MODE" != check ]] || exit 0

if [[ "$INSTALL" == 1 ]]; then
  (cd "$BACKEND" && make build)
  (cd "$ROOT" && npm ci)
fi
if [[ ! -f "$ROOT/.env" && ! -f "$ROOT/.env.local" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env.local"
  echo "已创建前端 .env.local；可按需调整模型与会话配置。"
fi
[[ "$MODE" != install ]] || { echo "基础依赖安装完成；DataFlow 与 Pi 由后端首次启动时安装。"; exit 0; }

LOG_DIR="$ROOT/logs/echomind"
mkdir -p "$LOG_DIR"
export ECHOMIND_LOG_FILE="${ECHOMIND_LOG_FILE:-$LOG_DIR/backend.log}"
mkdir -p "$(dirname "$ECHOMIND_LOG_FILE")"
backend_pid=
frontend_pid=
log_pid=
stop_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    stop_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$log_pid" ]] || stop_tree "$log_pid"
  [[ -z "$frontend_pid" ]] || stop_tree "$frontend_pid"
  [[ -z "$backend_pid" ]] || stop_tree "$backend_pid"
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

: >>"$ECHOMIND_LOG_FILE"
# The frontend owns /logs. Keep the legacy raw-log viewer opt-in.
if [[ "${ECHOMIND_ENABLE_RAW_LOG_VIEWER:-0}" == 1 ]]; then
  node "$ROOT/scripts/backend-log-server.mjs" "$ECHOMIND_LOG_FILE" >"$LOG_DIR/log-server.log" 2>&1 &
  log_pid=$!
fi
# JSON records keep each log event on one physical line, without Rich terminal wrapping.
(cd "$BACKEND" && export PYTHONUNBUFFERED=1 LOG_JSON=true && exec bash ./start_inference.sh) >>"$ECHOMIND_LOG_FILE" 2>&1 &
backend_pid=$!
(cd "$ROOT" && exec npm run dev -- --host 127.0.0.1 --port 5173 --strictPort) >"$LOG_DIR/frontend.log" 2>&1 &
frontend_pid=$!
echo "正在启动：前端 http://127.0.0.1:5173；后端 http://127.0.0.1:8000"
echo "日志追踪页面：http://127.0.0.1:5173/logs（默认展示后端全部日志，不按用户过滤）"
if [[ -n "$log_pid" ]]; then
  echo "旧版原始日志查看器：http://127.0.0.1:${ECHOMIND_LOG_PORT:-8002}"
fi
echo "后端日志：${ECHOMIND_LOG_FILE}（追加写入，保留历史）"
echo "前端日志：$LOG_DIR/frontend.log；Ctrl+C 停止所有已启动服务。"
while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null && { [[ -z "$log_pid" ]] || kill -0 "$log_pid" 2>/dev/null; }; do
  sleep 1
done
status=0
if ! kill -0 "$backend_pid" 2>/dev/null; then
  wait "$backend_pid" || status=$?
  tail -n 40 "$ECHOMIND_LOG_FILE"
elif ! kill -0 "$frontend_pid" 2>/dev/null; then
  wait "$frontend_pid" || status=$?
  tail -n 40 "$LOG_DIR/frontend.log"
elif [[ -n "$log_pid" ]]; then
  wait "$log_pid" || status=$?
  tail -n 40 "$LOG_DIR/log-server.log"
fi
exit "$status"
