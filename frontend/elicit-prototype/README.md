# Crucible 偏好挖掘原型 · v0.2 完整重设计（方向 B 为底）

单文件离线版：`index.html`（双击即可打开，内嵌 599 个 SKU；也会拷贝一份到 `dist/index.html`）。

## 构建 / 测试 / 截图
```bash
python3 build.py                 # src/ + data/sparrow_599.csv -> index.html, dist/index.html
cd test && npm install           # 首次：安装 playwright-core（test/node_modules 不入库）
cd test && node run.js           # 核心流程 + 新结构 + 55 个 data-act 可达性 -> last-result.json, ../shots/flow-*.png
cd test && node shots.js [过滤]   # 全部屏幕 @1366x768 & 1440x900 -> ../shots/
```
浏览器：默认找系统 Chrome/Chromium（`test/chrome.js`），可用 `CHROME_PATH=/path/to/chrome node run.js` 指定。

设计文档见仓库 `docs/design/`（`2026-10-04-interview-to-contract-design-v0.2.md` 等）。

## 文件结构
- `src/data.js`、`src/model.js`：数据与状态模型（沿用原版；只把 `rightOpen` 的默认值改成了 false）
- `src/ui.js`、`src/screens.js`：沿用原版的组件与编辑器/弹窗；被替换的渲染函数已删掉
- `src/screens_v2.js`：①上下文条、③主从布局（每行带原话片段）、④跳转行、⑤「去补样本 → ①」
- `src/shell.js`：94px 顶栏（会话下拉 / 场景 / 种子）、可自由点击的步骤 tab（状态由真实数据推导）、56px 契约栏、停靠面板（右侧或底部、可拖拽调整大小、5 个 tab、Esc 关闭）
- `src/main.js`：动作分发；新增 `b-rule`、`jump-rule`、`go-back`、`back-dismiss`、`fill-clear`、`cp-tab`、`cp-close`、`cp-dock`
- `src/style.css` + `src/v2.css`：原样式，加上去杂层（5 级字号、无边框卡片、纯文本标记、浅色矩阵填充、动效 token）

## 设计决策
| 决策 | 依据 |
|---|---|
| 步骤条做成可自由点击的 tab，不要上一步/下一步；每步显示 ✓ / 进行中 n / 分歧 n / 未聊到 n | Carbon Progress indicator：提供 completed/current/not started/error 四种状态；规范写明"流程可以按任意顺序完成时不要用线性步骤条"，所以不画表示先后顺序的连接线 |
| ③ 主从布局，列表和详情各自滚动 | GitHub Primer Layout（split page：list + detail pane） |
| 契约：默认**右侧停靠面板**（会挤开主内容、不遮挡，宽度可拖拽 320–720px）；也可切到**底部停靠**（高度 ≤50vh） | VS Code 的 Panel（编辑器下方的 tab 面板 + 状态栏，并说明"Panel 可移到左/右侧以获得更多纵向空间"）；Primer 允许把 pane 做成 bottom sheet。768px 高度只有 618px 可用（减去 94 顶栏和 56 底栏），如果是 50% 底部抽屉，③/④ 只剩约 230px，基本没法读，所以默认放右侧 |
| 蓝色强调色、只有可交互的东西才做成卡片、侧边色条只用来表达语义、有 focus-visible、遵循 reduced-motion、动效时长 120/200/320ms | refero-design skill（craft-details / anti-ai-slop / motion / color） |

**Refero 说明**：`user-Refero` 的所有调用（search_screens ×4、search_styles、search_flows）都返回 `NO_SUBSCRIPTION`，所以没有任何真实的 Refero 截图参考。上表用的是公开设计系统文档，没有编造 Refero 引用。

## 已知问题
见交付报告；主要几条：底部停靠在 1366×768 下主区较矮；右侧面板打开时 ④ 的案例条会折到两行；⑤ 的格子详情在矩阵下方，需要往下滚才能看到。
