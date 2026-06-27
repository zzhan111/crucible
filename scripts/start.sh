#!/usr/bin/env bash
#
# Crucible 一键启动入口 — 从冷启动到端到端可验证结果。
#
# 用法:
#   bash scripts/start.sh           # 降级模式(judge=neutral 0.5,无需 API key)
#   bash scripts/start.sh --llm     # 真实 LLM 模式(需 .env 填好 OPENAI_API_KEY,会调计费 API)
#   npm start                        # 等价于 bash scripts/start.sh
#
# 任一步失败立即退出(set -e)。该脚本只读不写业务逻辑,不改契约/打分器。
# 设计依据见 docs/qa/handtest-startup.md 与 docs/decisions/bigset-fork-evaluation.md。
#
set -euo pipefail

# ── 颜色 ────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m';  C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'
  C_RED=$'\033[31m';   C_CYAN=$'\033[36m'; C_YELLOW=$'\033[33m'; C_DIM=$'\033[2m'
else
  C_RESET=''; C_BOLD=''; C_GREEN=''; C_RED=''; C_CYAN=''; C_YELLOW=''; C_DIM=''
fi

step() { echo "${C_CYAN}${C_BOLD}▶ $1${C_RESET}"; }
ok()   { echo "${C_GREEN}  ✓ $1${C_RESET}"; }
warn() { echo "${C_YELLOW}  ! $1${C_RESET}"; }
fail() { echo "${C_RED}${C_BOLD}  ✗ $1${C_RESET}" >&2; }
die()  { fail "$1"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LLM_MODE=0
for arg in "$@"; do
  case "$arg" in
    --llm) LLM_MODE=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"; exit 0 ;;
    *) die "未知参数: $arg (用 --llm 或 --help)" ;;
  esac
done

echo "${C_BOLD}═══════════════════════════════════════════════════════════${C_RESET}"
echo "${C_BOLD}  Crucible 一键启动 — 契约驱动合成引擎${C_RESET}"
echo "${C_BOLD}  Worktree: $ROOT${C_RESET}"
echo "${C_BOLD}  模式: $([[ $LLM_MODE -eq 1 ]] && echo '真实 LLM' || echo '降级 (judge=neutral 0.5)')${C_RESET}"
echo "${C_BOLD}═══════════════════════════════════════════════════════════${C_RESET}"

# ── 1. 前置检查 ──────────────────────────────────────────
step "1/6 前置检查 (node / npm / better-sqlite3 native binding)"
command -v node >/dev/null 2>&1 || die "未找到 node。安装 Node.js v20+。"
command -v npm  >/dev/null 2>&1 || die "未找到 npm。安装 Node.js v20+。"
NODE_VER="$(node -v)"
ok "node $NODE_VER, npm $(npm -v)"

# ── 2. 依赖 ──────────────────────────────────────────────
step "2/6 依赖检查 (尊重 .npmrc include=dev)"
NEED_INSTALL=0
if [[ ! -d node_modules ]]; then
  NEED_INSTALL=1
else
  for dep in node_modules/.bin/tsx node_modules/.bin/vitest node_modules/@mastra/core; do
    [[ -e "$dep" ]] || { NEED_INSTALL=1; break; }
  done
fi
if [[ $NEED_INSTALL -eq 1 ]]; then
  echo "  ${C_DIM}缺失依赖,执行 npm install(含 devDeps: tsx/vitest/typescript)...${C_RESET}"
  npm install
  ok "依赖已安装"
else
  ok "依赖已就绪,跳过安装"
fi
# native binding 抽检:若 better-sqlite3 的 .node 文件缺失,构建会失败,这里提前暴露
if ! node -e "require('better-sqlite3')" >/dev/null 2>&1; then
  warn "better-sqlite3 native binding 加载失败,尝试 npm rebuild better-sqlite3 ..."
  npm rebuild better-sqlite3 || die "better-sqlite3 native binding 重建失败(可能缺编译工具链)"
  node -e "require('better-sqlite3')" >/dev/null 2>&1 || die "better-sqlite3 仍不可用"
fi
ok "better-sqlite3 native binding 可加载"

# ── 3. .env ──────────────────────────────────────────────
step "3/6 .env 检查"
if [[ ! -f .env ]]; then
  cp .env.example .env
  warn ".env 不存在,已从 .env.example 复制空模板。填 OPENAI_API_KEY 可跑真实 LLM(judge),否则降级模式。"
fi
if [[ -n "${OPENAI_API_KEY:-${CRUCIBLE_STARTUP_KEY:-}}" ]]; then
  ok "检测到 OPENAI_API_KEY(环境变量或 .env)"
  HAS_KEY=1
else
  # 从 .env 读 key(脚本本身不 source .env,但 demo 入口会读)
  if grep -qE '^OPENAI_API_KEY=.+' .env 2>/dev/null; then
    ok ".env 中有 OPENAI_API_KEY"
    HAS_KEY=1
  else
    warn "无 OPENAI_API_KEY → judge 降级为 neutral 0.5,workflow 仍跑通,但 τ 校准会 skipped"
    HAS_KEY=0
  fi
fi

if [[ $LLM_MODE -eq 1 && $HAS_KEY -eq 0 ]]; then
  die "--llm 模式要求 OPENAI_API_KEY(在 .env 填好或导出环境变量)。当前无 key,改用降级模式: bash scripts/start.sh"
fi

# ── 4. typecheck ─────────────────────────────────────────
step "4/6 类型检查 (tsc --noEmit)"
npm run --silent typecheck
ok "typecheck 通过"

# ── 5. 测试 ──────────────────────────────────────────────
step "5/6 测试套件 (vitest, 含 e2e — 端到端跑通的客观判据)"
# e2e 测试强制 delete OPENAI_API_KEY,始终降级、确定性可复现
npm test
ok "全部测试通过(含 e2e: 分数上升 / 违规清零 / 多智能体日志 / curator proposal)"

# ── 6. 端到端报告 ────────────────────────────────────────
step "6/6 生成端到端 HTML 报告 (demo-report.html)"
# 直接用 bash 语法设 env 再调 tsx,绕开 npm 在 Windows 上用 cmd.exe
# 不认 "VAR=val cmd" 前缀的问题(npm run demo:html 在纯 Windows 会失败)。
# demo-html.ts 自加载 .env;无 key 时 τ=skipped 属正常。
CRUCIBLE_DEMO_HTML=1 node_modules/.bin/tsx src/demo-html.ts
REPORT="$ROOT/demo-report.html"
if [[ -f "$REPORT" ]]; then
  ok "报告已生成: $REPORT"
else
  die "demo-report.html 未生成"
fi

# ── 可选:真实 LLM 五段式 console ─────────────────────────
if [[ $LLM_MODE -eq 1 ]]; then
  step "附加:真实 LLM 五段式 console (demo-p1.ts, 会调计费 API)"
  node_modules/.bin/tsx src/demo-p1.ts
  ok "真实 LLM demo 完成,τ 应为真实数值(非 skipped)"
fi

# ── 手测 QA 指引 ─────────────────────────────────────────
echo
echo "${C_BOLD}═══════════════════════════════════════════════════════════${C_RESET}"
echo "${C_GREEN}${C_BOLD}  ✓ 端到端启动完成${C_RESET}"
echo "${C_BOLD}═══════════════════════════════════════════════════════════${C_RESET}"
echo
echo "${C_BOLD}手测 QA(完整清单见 docs/qa/handtest-startup.md):${C_RESET}"
echo "  ${C_CYAN}A.${C_RESET} 浏览器打开 ${C_BOLD}demo-report.html${C_RESET},核对五段全在"
echo "     (契约卡 / τ仪表盘 / 分数曲线SVG / 违规卡 / 演化时间线 / A/B柱状图 / 跨族GO徽章)"
echo "     降级模式 τ=skipped 属正常。"
echo "  ${C_CYAN}B.${C_RESET} 端到端闭环已由 e2e 测试自动覆盖(上面 npm test 已验证)。"
echo "  ${C_CYAN}C.${C_RESET} 真实 LLM(可选): ${C_BOLD}bash scripts/start.sh --llm${C_RESET}"
echo "     → τ 出真实值,分数曲线含 judge 贡献(会调计费 API)。"
echo "  ${C_CYAN}D.${C_RESET} MCP server(可选): ${C_BOLD}npm run mcp:serve${C_RESET}"
echo "     → stdin 发 JSON-RPC: initialize / tools/list / tools/call(score_artifact)。"
echo "  ${C_CYAN}E.${C_RESET} 降级安全网: 删 key 重跑应仍跑通(judge=0.5,不崩)。"
echo
echo "${C_DIM}风险: .env 含明文 API key(gitignore 未提交,本机盘上)。共享前请轮换。${C_RESET}"
echo "${C_DIM}架构: 永久 adapter 模式,不 fork BigSet(docs/decisions/bigset-fork-evaluation.md)。${C_RESET}"
