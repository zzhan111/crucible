# P4.3 尽调 vertical 人工 QA 清单

> 财务红旗筛查(偷漏税/现金流/关联方/资不抵债)+ 公开财报解析 + 审计导出的人测对照表。
> 每条给出**命令**与**预期结果**,可逐条判 pass/fail。
> Worktree:`D:\Apps\traveller.crucible-dev` · 分支 `crucible/dev`

## 前置

- 依赖已装(`npm install`),`better-sqlite3` native binding 可加载。
- **降级模式即可**(无 `OPENAI_API_KEY`)。财务红旗全部是确定性谓词,不依赖 LLM;judge 维度 `tax_compliance` 降级为 neutral 0.5(设计内,非故障)。
- 合规边界:本清单所有数据为**合成 fixture 或公开样例**,非真实企业敏感数据。

---

## A. 财务红旗筛查 demo(核心,必跑)

**命令**
```bash
cd /d/Apps/traveller.crucible-dev
npm run dd:financial
```

**预期**:打印 6 份档案的红旗筛查报告(4 合成 + 2 公开财报解析),末尾"合规说明"。

| 档案 | 红旗数 | 命中 constraint_id | source_trust | ratio_health |
|---|---|---|---|---|
| 合成-干净 (audited) | 0 | — | 0.950 | 1.000 |
| 合成-偷漏税 (reviewed) | 1 | `tax_ratio_floor`(3.0%) | 0.700 | 1.000 |
| 合成-现金流 (audited) | 1 | `cashflow_anomaly`(0.22) | 0.950 | 1.000 |
| 合成-关联方 (reviewed) | 1 | `related_party_transfer`(45%) | 0.500 | 0.793 |
| 公开-干净 (audited) | 0 | — | 0.950 | 1.000 |
| 公开-税务红旗 (reviewed) | 1 | `tax_ratio_floor`(4.0%) | 0.700 | 1.000 |

**Pass 判据**:
1. 干净档案(合成 + 公开)红旗数 = 0,打印 `✓ 无红旗(干净档案)`。
2. 3 个红旗档案各触发**对应且仅对应**的 constraint_id(不串扰)。
3. source_trust 区分审计质量:audited 0.950 > reviewed 0.700。
4. 末尾"合规说明"含"红旗 = 按尽调 rubric 触发的筛查信号,非偷漏税定性"。

**Fail 信号**:红旗串扰(偷漏税档案触发现金流红旗)、干净档案误报红旗、沙箱失败(`[Sandbox:vm] execution failed` 警告 + 红旗漏报)。

---

## B. 4 个红旗谓词逐项验证

逐个谓词单独触发,确认边界正确。**命令**:用 `npx tsx` 跑内联检查(见下),或直接看 A 段 demo 输出。

| 谓词 | 触发条件 | 验证档案 | 预期 message 含 |
|---|---|---|---|
| `tax_ratio_floor` | 有效税率 < 10% | `financialTaxFlag` | `3.0% 低于 10%` |
| `cashflow_anomaly` | 经营现金流/净利润 < 0.5 | `financialCashflowFlag` | `0.22(低于 0.5` |
| `related_party_transfer` | 关联收入占比 > 30% 且未披露 | `financialRelatedPartyFlag` | `45% 超过 30% 且未披露` |
| `ratio_breach` | 资产负债率 > 85% | (无现成 fixture,见 B.5) | `超过 85%` |

**B.1-B.4** 由 A 段 demo 覆盖(前 3 个)。

**B.5 ratio_breach 手测**(无 fixture,手造一个高负债档案):

> ⚠️ 注意:`npx tsx -e` 带相对 import(`./src/...`)会失败(从 temp 运行)。**用项目内临时脚本**:

```bash
cd /d/Apps/traveller.crucible-dev
cat > scripts/_qa-rb.ts << 'EOF'
import { loadContract } from '../src/contract/validate.js';
import { compileContract } from '../src/contract/compiler.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const s = compileContract(loadContract(join(__dirname, '..', 'contracts', 'financial-v1.yaml')));
const art = { family:'financial', metadata:{fiscal_year:2025,currency:'CNY',audit_status:'unaudited'}, nodes:[
  {line_item:'revenue',amount:1000000,section:'income_statement',source_trust:0.3},
  {line_item:'pre_tax_profit',amount:200000,section:'income_statement',source_trust:0.3},
  {line_item:'tax_expense',amount:50000,section:'income_statement',source_trust:0.3},
  {line_item:'total_liabilities',amount:9000000,section:'balance_sheet',source_trust:0.3},
  {line_item:'total_assets',amount:10000000,section:'balance_sheet',source_trust:0.3},
]} as any;
console.log('constraint_ids:', s.score(art).deterministic.violations.map(v=>v.constraint_id));
EOF
npx tsx scripts/_qa-rb.ts   # 预期含 ratio_breach
rm -f scripts/_qa-rb.ts
```
**预期**:输出含 `ratio_breach`(负债率 90% > 85%)。

**Pass 判据**:4 个谓词各自在阈值边界正确触发,阈值之上不误报。

---

## C. 公开财报解析器

**命令**:A 段 demo 的"公开财报样例"段已覆盖。另可单独验证解析(用项目内临时脚本,`tsx -e` 相对 import 不工作):

```bash
cd /d/Apps/traveller.crucible-dev
cat > scripts/_qa-parse.ts << 'EOF'
import { parseFinancialReport } from '../src/collection/financial-report-parser.js';
import { publicReportSample, publicReportTaxFlagSample } from '../src/fixtures/public-report-sample.js';
const a = parseFinancialReport(publicReportSample);
console.log('family:', a.family, '| nodes:', a.nodes.length, '| company:', a.metadata.company);
console.log('sections:', [...new Set(a.nodes.map(n=>n.section))]);
console.log('trust(audited):', a.nodes[0].source_trust);
const b = parseFinancialReport(publicReportTaxFlagSample);
console.log('trust(reviewed):', b.nodes[0].source_trust);
EOF
npx tsx scripts/_qa-parse.ts
rm -f scripts/_qa-parse.ts
```

| 验收点 | 预期 |
|---|---|
| family | `financial` |
| nodes 数量 | 10(income 5 + balance 4 + cashflow 1) |
| sections | `income_statement, balance_sheet, cash_flow` |
| company | `DemoListed Corp` |
| source_trust(audited) | 0.95 |
| source_trust(reviewed) | 0.70 |

**Pass 判据**:三大报表行项全进 nodes;审计状态正确映射 source_trust(audited 0.95 > reviewed 0.70 > unaudited 0.30)。

---

## D. 合规边界(必读,非命令)

本清单**不验证真实企业数据**。合规约束:

| 约束 | 说明 |
|---|---|
| 红旗 ≠ 定性 | "偷漏税红旗"是"按尽调 rubric 触发的筛查信号",**非证明偷税漏税**。"是否真逃税"是审计师/律师判断 |
| 数据来源 | 合成 fixture(`financial-dd.ts`)+ 公开样例(`public-report-sample.ts`,基于年报结构手造,非抓取真企业) |
| 真实落地 | 走 on-prem 客户自带数据(PRD §5 引擎开源/契约私有);Crucible 不抓企业财务数据 |
| 审计可辩护 | source_trust + P4.1 审计轨迹(出处+分数)支撑"可向监管/上级交代" |

**Pass 判据**:A 段 demo 末尾打印合规说明;contract YAML 顶部注释含"红旗筛查非偷漏税定性"。

---

## E. 跨功能:审计轨迹导出(财务工件落库 + 导出)

验证 P4.3 financial 工件能经 P4.1 审计导出链路产出报告(含 actor + RBAC 展望框)。

**命令**(`tsx -e` 相对 import 不工作,用项目内临时脚本):
```bash
cd /d/Apps/traveller.crucible-dev
rm -f crucible-qa.db*

# 1. 跑 workflow 落库 + 导出工件 JSON
# ⚠️ 落库的是 finalArtifact(每轮 post-patch 产物),不是输入 financialGolden!
#    导出时必须查 finalArtifact 的 hash,否则查不到记录。
cat > scripts/_qa-audit.ts << 'EOF'
import { writeFileSync } from 'node:fs';
import { loadContract } from '../src/contract/validate.js';
import { compileContract } from '../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../src/workflow/crucible.js';
import { financialGolden } from '../src/fixtures/financial-dd.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const c = loadContract(join(__dirname, '..', 'contracts', 'financial-v1.yaml'));
const r = await runCrucibleWorkflow({ artifact: financialGolden, contract: c, baseScorer: compileContract(c), artifactId:'qa-fin', knownStates:[], actor:{id:'qa-analyst',role:'author'} });
writeFileSync(join(__dirname, '_fin.json'), JSON.stringify(r.finalArtifact));  // 落库的是 finalArtifact
console.log('落库完成');
EOF
CRUCIBLE_DB_PATH=./crucible-qa.db npx tsx scripts/_qa-audit.ts

# 2. 导出审计三格式(用项目内 _fin.json,不用 /tmp — Windows 路径问题)
CRUCIBLE_DB_PATH=./crucible-qa.db npx tsx scripts/audit-trail-export.ts --artifact scripts/_fin.json --format all

# 3. 清理
rm -f scripts/_qa-audit.ts scripts/_fin.json crucible-qa.db* docs/audit/audit-*.*
```

**预期**:第 2 步生成 `docs/audit/audit-<hash>-<date>.{json,md,pdf}` 三文件。

| 验收点 | 预期 |
|---|---|
| JSON 含 `financial` family | 报告 runs[].family = **financial** |
| MD 含 actor | `操作者 (actor): qa-analyst` |
| MD 含 source_trust | `来源可信度 (source_trust)` 高亮 |
| MD 含 RBAC 展望框 | `🔒 RBAC 演进展望` + `IdentityProvider` |
| PDF 有效 | 魔数 `%PDF-` |

**Pass 判据**:三格式文件生成;MD 含 financial family + actor + source_trust + RBAC 展望框;PDF 有效。

---

## F. 黄金集覆盖(自动 + 手测)

**命令**
```bash
npm run audit:golden 2>&1 | grep -iE "financial|✗|gap"
```

**预期**:
```
    ✓ financial/high: 2
    ✓ financial/mid: 2
    ✓ financial/low: 2
```
无 `✗` / `gap` 行(financial 族 3 cell 全 ≥2)。

**Pass 判据**:financial 族 3 个 calibration cell 全 `✓`;无缺口告警。

---

## G. 沙箱降级安全网(可选,验证不崩)

`code_predicate` 走沙箱。验证沙箱失败时降级为"无 violation"+ 警告,不 crash。

**命令**(造一个抛错的 impl,看是否优雅降级;用项目内临时脚本):
```bash
cd /d/Apps/traveller.crucible-dev
cat > scripts/_qa-sb.ts << 'EOF'
import { runInSandbox } from '../src/contract/sandbox.js';
const r = runInSandbox('function check(a){ throw new Error("boom") }', { family:'financial', nodes:[] });
console.log('returned:', JSON.stringify(r), '(应为 [],不 crash)');
EOF
npx tsx scripts/_qa-sb.ts   # 预期:1 行 [Sandbox:vm] 警告 + 1 行 returned: []
rm -f scripts/_qa-sb.ts
```

**预期**:打印 `[Sandbox:vm] execution failed: boom` 警告 + `returned: []`。

**Pass 判据**:不 crash,返回空数组(降级为"无 violation")。**注意**:这意味着沙箱失败会**漏报红旗** — A 段测试是验证红旗不漏报的保障。

---

## H. 自动测试覆盖(无需手测)

以下由 `npm test` 自动覆盖,列此供对照:

| 测试文件 | 覆盖 |
|---|---|
| `tests/predicates/financial.test.ts` | 4 谓词触发/不触发 + det_score 下降 + ratio_health + source_trust 区分 |
| `tests/collection/financial-report-parser.test.ts` | JSON→artifact 字段映射 + source_trust 赋值 + 解析后可打分 |
| `tests/fixtures/golden-set-expanded.test.ts` | financial 条目数量 + cell ≥2 + 3 红旗 pattern + calibration 无硬违规 |

**Pass 判据**:`npm test` 全绿(457 测试)。

---

## 常见坑

| 坑 | 现象 | 对策 |
|---|---|---|
| 沙箱 ESM bug(P2 遗留) | `require is not defined in ES module scope` | 已修(`createRequire`);若复现说明 sandbox.ts 被回退 |
| 红旗漏报 | 干净档案 0 红旗但红旗档案也 0 | 查沙箱是否失败(`[Sandbox] execution failed` 警告);impl 字段名与 fixture 不匹配 |
| `ratio_breach` 无 fixture | B.5 手造,不在 demo | 设计内;4 个谓词只有 3 个有 fixture(ratio_breach 需手造高负债) |
| 关联方 ratio 算错 | related_party 不触发 | 谓词按 `line_item==='revenue'` 算占比,不是所有 income_statement 行(曾 bug,已修) |
| `tax_compliance` judge = 0.5 | 误判为故障 | 设计内:降级模式 judge neutral;真实 LLM 才有值 |
| 审计导出查不到记录 | "无评分记录" | 落库的是 `finalArtifact`(每轮 post-patch 产物),不是输入工件;导出 `--artifact` 必须传 finalArtifact 的 JSON |
| `/tmp/` 路径在 Windows 失败 | `工件文件不存在` | Node 的 `writeFileSync('/tmp/x')` 在 Win 解析到 `AppData\Local\Temp` 且易失败;用项目内路径(如 `scripts/_fin.json`) |

## 风险提示

- **合规**:勿用真实企业税务/财务数据跑本 vertical(数据敏感)。真实落地走 on-prem 客户自带。
- **红旗非定性**:本工具输出是筛查信号,不能直接用于"认定偷税漏税"的法律/审计结论。
- **沙箱**:vm 后端隔离性弱于 isolated-vm(共享 process);生产环境装 `isolated-vm` 强化隔离。
