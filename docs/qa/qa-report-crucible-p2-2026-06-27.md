# P2 QA Report — Crucible

> Date: 2026-06-27
> Branch: crucible/dev
> P2 scope: 采集层 + MCP + UI + 沙箱 (§2.1-2.4)
> Tier: Standard (critical + high + medium)

---

## 摘要

| 指标 | 值 |
|------|-----|
| 测试总数 | 253 |
| 测试通过 | 253 (100%) |
| 测试文件 | 36 |
| tsc 类型检查 | clean |
| P2 新增测试 | 51 (sandbox 9 + collection 14 + mcp 10 + p2-qa 10 + demo-html 8) |
| QA 发现问题 | 1 |
| 已修复 | 1 (verified) |
| 健康分数 | **95/100** |

## 健康分数明细

| 类别 | 权重 | 得分 | 说明 |
|------|------|------|------|
| 测试覆盖 | 25% | 100 | 253/253 pass, P2 4 模块全覆盖 |
| 类型安全 | 20% | 100 | tsc --noEmit clean |
| 错误处理 | 20% | 95 | 沙箱/采集/MCP 降级路径完整, demo-html guard 修复 |
| 功能正确 | 20% | 95 | 集成验证通过(collection→Scorer→违规抓出) |
| 代码卫生 | 15% | 80 | 生成文件 untrack 修复, 1 个历史 demo-report 残留已清 |

**总分: 95/100** (P0: 92/100, P1: ~94, P2: 95)

## P2 验收标准核对 (§3.1-3.4)

### §3.1 沙箱可用 ✅
- code_predicate.impl 可在 isolated-vm 沙箱中执行
- 恶意代码(require fs)被拦截 — "require is not defined"
- 恶意代码(while-true)超时被拦截 — 1004ms 后 "Script execution timed out"
- 降级路径: isolated-vm 不可用 → Node vm(已实现,detectSandboxBackend)
- 9 个沙箱测试全部通过

### §3.2 采集层可用 ✅
- BigSet 适配器: 报告 JSON → intel-table Artifact 转换正确
- Travel 适配器: 攻略 JSON → sequence Artifact 转换正确
- 边界: 空输入/null/格式错误 → 返回空 artifact + warning,不 crash
- **集成验证**: 缺 source 的行 → 采集为 undefined → Scorer 抓出 no_empty_source 违规
- 14 个采集层测试全部通过

### §3.3 MCP server 可用 ✅
- 5 个工具注册成功(score_artifact/run_workflow/calibrate_judge/evolve_contract/ab_compare)
- JSON-RPC 2.0 协议: initialize/tools/list/tools/call 全部实现
- **stdio 传输验证**: 真实 stdin→stdout 测试通过(initialize 返回正确 serverInfo)
- 降级模式(无 API key)不 crash — 工具返回 neutral 0.5
- 10 个 MCP 测试全部通过

### §3.4 UI 路演可视化 ✅
- generateHtml 生成五段式 HTML(契约+校准τ / 分数曲线SVG / 契约演化 / A/B柱状图 / 跨族go徽章)
- 静态 HTML(SVG + 内联样式,无 JS 框架)
- 8 个 UI 测试全部通过(5段标题 + SVG + 徽章 + 分数 + τ + 违规 + A/B)

## QA 发现的问题

### ISSUE-001: demo-report.html 是生成文件但被 git tracked [已修复]
- **严重度**: medium
- **类别**: 代码卫生
- **描述**: demo-report.html 由 src/demo-html.ts 生成,但被 git 跟踪。仓库中存留的是 P0 残留版本("119 tests pass · health score 92/100"),与 P2 不符。生成产物不应进版本历史。
- **修复**: 加入 .gitignore,git rm --cached 移除跟踪(文件保留本地)
- **提交**: 1b12133
- **验证**: git status 确认 demo-report.html 不再 tracked

## 未发现问题(验证通过的点)

1. **沙箱隔离性**: isolated-vm 创建独立 V8 isolate,require/fs/network 全不可用
2. **沙箱超时**: while(true) 在 1000ms 被正确中断,不卡死进程
3. **采集层防御**: 缺字段/空输入/null 全部降级,不抛异常
4. **MCP stdio**: 真实管道传输(JSON-RPC over stdin/stdout)工作正常
5. **MCP 错误路径**: 未知工具/未知方法/无效 JSON 全部返回正确 error code
6. **UI 类型安全**: HtmlData 接口用直接类型(ScoreReport/Contract 等),tsc clean
7. **测试稳定性**: setup-env 不加载 LLM key,并行测试无 flaky

## 结论

P2 4 项全部通过验收(§3.1-3.4),健康分数 95/100。1 个 medium 问题(生成文件 tracked)已修复。

**STATUS: DONE**
