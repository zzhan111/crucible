#!/usr/bin/env bash
#
# 把 crucible 源码打成 portable 压缩包,目标:在 Mac 上解压后
#   npm install && npm start  即可端到端跑通。
#
# 原理:直接打工作区文件(含未提交改动),显式排除平台 native binary 与生成物
# (node_modules / .env / coverage / proposals / .gstack / .git / demo-report.html)。
# Mac 上 npm install 会装 darwin 平台包(better-sqlite3/rollup/vite)。
#
# 注意:不用 git archive —— 它打不到未提交的新文件(如 start.mjs)。
#
# 用法:bash scripts/pack-portable.sh
# 产物:crucible-portable-<commit-short>-<timestamp>.tar.gz(放在 worktree 根)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'nogit')"
TS="$(date +%Y%m%d-%H%M%S)"
PKG="crucible-portable-${COMMIT}-${TS}"
TARBALL="${PKG}.tar.gz"

echo "▶ 打包 portable 源码包"
echo "  commit: ${COMMIT}"
echo "  产物:   ${TARBALL}"

# 临时 stage 目录,精确拷贝需要的文件(白名单制,避免误带)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STAGE="$TMP/$PKG"
mkdir -p "$STAGE"

# ── 顶层文件(白名单) ─────────────────────────────────
for f in package.json package-lock.json tsconfig.json vitest.config.ts \
         .npmrc .env.example .mcp.json README.md .gitignore; do
  [[ -f "$ROOT/$f" ]] && cp "$ROOT/$f" "$STAGE/"
done
# .mcp.json 里的 args 用了本机绝对路径,portable 包要改成相对路径(任何机器可用)。
# 用 node 跨平台替换,避免 sed 在 Windows/Mac 行为差异。
if [[ -f "$STAGE/.mcp.json" ]]; then
  node -e "
    const fs=require('fs'),p=process.argv[1];
    const j=JSON.parse(fs.readFileSync(p,'utf8'));
    for(const s of Object.values(j.mcpServers||{})){
      if(Array.isArray(s.args)) s.args=s.args.map(a=>a.replace(/^[^ ]*\/scripts\//,'scripts/'));
    }
    fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');
  " "$STAGE/.mcp.json"
fi

# ── 顶层目录(整目录拷贝,排除生成物) ───────────────────
# src/ tests/ contracts/ golden/ scripts/ docs/ 全部纯源码,直接拷
for d in src tests golden scripts docs; do
  [[ -d "$ROOT/$d" ]] && cp -r "$ROOT/$d" "$STAGE/"
done
# contracts/ 排除 proposals/ 和 rejected-proposals/(运行时生成)
if [[ -d "$ROOT/contracts" ]]; then
  mkdir -p "$STAGE/contracts"
  find "$ROOT/contracts" -maxdepth 1 -type f -exec cp {} "$STAGE/contracts/" \;
fi

# ── 剔除可能被 cp -r 带入的生成物/缓存 ──────────────────
# 注意:只删 contracts/proposals(运行时生成),绝不能删 src/proposals(源码)。
# find -name proposals 会误伤 src/proposals,故只按 contracts 子路径精确删。
find "$STAGE" -type d \( -name node_modules -o -name '.git' -o -name '.gstack' \
  -o -name coverage -o -name rejected-proposals \
  -o -name '.DS_Store' \) -prune -exec rm -rf {} + 2>/dev/null || true
rm -rf "$STAGE/contracts/proposals" 2>/dev/null || true
find "$STAGE" -name 'demo-report.html' -delete 2>/dev/null || true
find "$STAGE" -name '.env' ! -name '.env.example' -delete 2>/dev/null || true

# ── 生成 Mac 启动说明 ──────────────────────────────────
cat > "$STAGE/MAC-START.md" <<'EOF'
# Crucible — Mac 快速启动

## 前置
- macOS(Apple Silicon 或 Intel)
- Node.js v20+(`node -v` 确认;推荐 nvm/Homebrew 安装)
- Xcode Command Line Tools(better-sqlite3 编译需要):`xcode-select --install`
- 网络(npm install 需联网拉 darwin 平台包)

## 三步跑通
```bash
cd crucible-portable-*       # 解压出来的目录
npm install                   # 装 darwin 平台依赖(better-sqlite3/rollup/vite/pdfkit)
npm start                     # 一键: typecheck → test(485) → demo-report.html
```

`npm start` 全程降级模式(judge=neutral 0.5,无需 API key),约 30 秒完成,
末尾打印 `✓ 端到端启动完成` 即成功。

## 真实 LLM 模式(可选,会计费)
```bash
cp .env.example .env          # 填入 OPENAI_API_KEY(OpenAI/DeepSeek/任意 OpenAI 兼容端点)
npm start -- --llm            # τ 校准出真实数值
```

## 验证产物
- `npm test` → `Test Files 57 passed (57)`, `Tests 485 passed (485)`
- `demo-report.html` → 浏览器打开,核对五段(契约卡/τ仪表盘/分数曲线/违规卡/演化/A/B/跨族GO)
- `npm run dd:financial` → P4.3 财务尽调红旗筛查(6 档案,干净0红旗/3红旗各触发)
- `npm run intel:monitor` → P4.6 竞品监测(4 工件 5 维评分,含 strategic_insight judge mock fallback)
- `npm run audit:golden` → 黄金集覆盖矩阵全 ✓(sequence/table/financial)

## P4 新增能力(本包含全部 P4 commits)
- P4.1 审计轨迹导出:`CRUCIBLE_DB_PATH=./x.db npm run audit:trail -- --artifact <工件> --format all`(JSON/MD/PDF)
- P4.2 RBAC + 活动日志:actor_id 落库,human-gate approve:contract 权限检查
- P4.2.5 可插拔 IdP:users+sessions 表 + IdentityProvider 接口(凭证委托 IdP)
- P4.3 尽调 vertical:`npm run dd:financial`(财务红旗:偷漏税/现金流/关联方/资不抵债)
- P4.6 竞品监测 vertical:`npm run intel:monitor`(intel-table v1.1:6 硬约束 + 5 维 rubric + 公开快照)

## 常见问题
- `npm install` 卡在 better-sqlite3:它是 native 模块,Mac 需编译;先装 Xcode CLT
  (`xcode-select --install`)。仍失败:`npm rebuild better-sqlite3`。
- 无 API key 时 τ=skipped 属正常(降级模式设计内行为)。
- 完整手测 QA 清单:`docs/qa/handtest-startup.md`(启动)+ `docs/qa/handtest-financial-dd.md`(尽调)+ `docs/qa/handtest-intel-monitor.md`(竞品监测)。
EOF

# ── 打 tar.gz ──────────────────────────────────────────
tar -czf "$ROOT/$TARBALL" -C "$TMP" "$PKG"

# ── 校验 ───────────────────────────────────────────────
SIZE="$(du -h "$ROOT/$TARBALL" | cut -f1)"
FILES="$(tar -tzf "$ROOT/$TARBALL" | grep -v '/$' | wc -l | tr -d ' ')"
echo "  ✓ 打包完成"
echo "  大小: ${SIZE}"
echo "  文件数: ${FILES}"
echo
echo "▶ Mac 解压运行:"
echo "  tar -xzf ${TARBALL}"
echo "  cd ${PKG}"
echo "  npm install && npm start"
