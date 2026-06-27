# Crucible P2 Spec — 采集层 + MCP + UI + 沙箱

> P1 已完成(202 tests, τ=0.64, 跨族 GO, 13 commits)。
> 本 spec 定义 P2 范围(4 项核心工程),作为 P2 plan 的输入。
> PRD §5 P2+ 候选中,用户选定 4 项纳入 P2,Mastra评估+DSL草案留 P3。

---

## 1. P2 Goal

把 P1(闭环内核:真实 LLM judge + 契约自演化 + A/B + 跨族)升级为**可外部接入、可真实采集、可路演可视化**的完整引擎:
- 契约真可执行(code_predicate 沙箱动态加载)
- 能从真实数据源采集工件(采集层适配器)
- 外部 agent 可通过 MCP 协议调用引擎(MCP server)
- 路演有完整可视化报告(P1 五段式 HTML)

## 2. P2 范围(4 项,按依赖顺序)

### 2.1 code_predicate 沙箱(isolated-vm)

- 用 `isolated-vm` 隔离执行 Contract 的 `code_predicate.impl` 字符串
- 升级 `compiler.ts`: code_predicate case 从"跳过"改为"沙箱加载+执行"
- 沙箱限制: 内存上限(128MB)、执行超时(1000ms)、无 require/import/fs/network
- 降级: 若 isolated-vm native 编译失败,降级到 Node 内置 `vm` 模块 + 记录决议
- 测试: 正例(简单谓词) + 超时 + 恶意代码拦截(require fs / while-true)

**依赖: 无(独立技术债偿还)**

### 2.2 采集层框架

- 新增 `src/collection/` 模块: Collector 接口 + 工件适配器
- `types.ts`: `RawArtifact`(外部原始格式) → `Artifact`(Crucible 内部格式)转换接口
- `bigset-adapter.ts`: BigSet 深度调研报告 → intel-table Artifact 适配器(复用 P1 fixture 数据结构)
- `travel-adapter.ts`: 旅游攻略文本 → sequence Artifact 适配器
- 不实际 fork BigSet 仓库(工程量过大),写适配器接口 + 用 P1 数据做 fixture。真实 fork 留 P3。

**依赖: 无(独立模块)**

### 2.3 MCP server 封装

- 把引擎封装为 MCP server(stdio transport),暴露工具:
  - `score_artifact(artifact_json, contract_path)` → ScoreReport
  - `run_workflow(artifact_json, contract_path)` → CrucibleRunResult
  - `calibrate_judge(contract_path)` → CalibrationReport
  - `evolve_contract(contract_path, proposals_json)` → ContractPatch[]
  - `ab_compare(champion_path, challenger_path)` → ABResult
- 用 `@modelcontextprotocol/sdk`,加为 dependency
- 测试: 工具注册 + 参数校验 + 降级(无 API key)

**依赖: 2.1(沙箱让契约真可执行,MCP 调用时更完整)**

### 2.4 UI 路演可视化

- 重写 `src/demo-html.ts`: P1 五段式 HTML 报告
  - Section 1: 契约卡片 + 校准 τ 仪表盘
  - Section 2: 分数曲线 SVG(真实 LLM) + 违规卡片
  - Section 3: 契约演化时间线(版本+1 diff)
  - Section 4: A/B 对比柱状图(champion vs challenger τ)
  - Section 5: 跨族探针 go/no-go 徽章
- 静态 HTML(无 JS 框架),SVG + 内联样式

**依赖: 2.1-2.3(展示完整能力)**

## 3. P2 验收标准

### 3.1 沙箱可用
- code_predicate.impl 可在沙箱中执行
- 恶意代码(require fs / while-true)被拦截
- 降级路径(isolated-vm 不可用 → vm)有记录

### 3.2 采集层可用
- BigSet 适配器: 原始报告 → intel-table Artifact 转换正确
- Travel 适配器: 攻略文本 → sequence Artifact 转换正确
- 边界: 空输入 / 格式错误不 crash

### 3.3 MCP server 可用
- 5 个工具注册成功
- 工具调用返回正确类型(ScoreReport / CrucibleRunResult / 等)
- 降级模式(无 API key)不 crash

### 3.4 UI 路演可视化
- HTML 报告含 5 段(契约/分数/演化/A-B/跨族)
- 含 SVG 图表(分数曲线 / A-B 柱状图)
- 可在浏览器直接打开

## 4. P2 技术栈变更

- 新增: `isolated-vm`(native 沙箱) 或降级用 Node `vm`
- 新增: `@modelcontextprotocol/sdk`(MCP server)
- 保持: `ai`@6.x, `yaml`, `zod`, `vitest`, `tsx`

## 5. P2 不做(留 P3+)

- Mastra 升级评估(P2 末评估,P3 执行)
- DSL 开放标准草案(P3)
- 真实 fork BigSet 仓库(P3,需网络+仓库工程)
- 缓存层 / 分级延迟(P3)
- 数据库(P3+)
- 多租户 / ToB on-prem(P4)

## 6. 风险与对策

| 风险 | 对策 |
|------|------|
| isolated-vm native 编译失败 | 降级到 Node vm + 记录决议 |
| MCP SDK 版本不兼容 | 先验证 SDK 能装+import,再写 server |
| 采集层无真实 BigSet 数据 | 用 P1 intel-table fixture 数据做适配器测试 |
| UI 工程量超预期 | 保持静态 HTML,SVG + 内联样式,无 JS 框架 |

## 7. 执行结构(3 Plan)

- Plan 1: 沙箱(2.1) + 采集层(2.2)
- Plan 2: MCP server(2.3)
- Plan 3: UI(2.4) + P2 QA
