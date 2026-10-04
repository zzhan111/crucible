# Crucible 偏好挖掘原型 · v0.3：两个场景（数据驱动）

在 v0.2（方向 B 重设计）之上新增第二个场景 **「药点ERP 采购规则」**（药房补货）。便利店场景「小小云雀选品」（599 个包装）保持不变。
两个场景都在顶栏的场景下拉里切换。单文件 `index.html` 共 0.83 MB，离线可用。

## v0.3 变化
- **场景注册表**（`src/scenarios.js`）：每个场景是一份配置，包括被评对象、字段、判定三档的名字、可用判定类型、适用范围维度（scope chips）、矩阵两轴、抽样方式、相似判定、展示和文案。引擎（求值 / 回归 / 五个屏 / 契约面板 / 导出）只读 `SC()`，以及由 `useScenario()` 切换的 `ITEMS / ITEM / FIELDS / VERDICT`。便利店配置 = v0.2 行为，原有 91 项检查不改断言，全部通过。
- **新判定类型**：
  - `confirm`：列为「待确认」，判定上限是中间档。
  - `flag`：只做标记。
  - `round`：数量凑整。
  - `flag` 和 `round` 不改判定，在 trace 里显示为「不改判定的标记」。
- **③ 行内改阈值**（药点场景）：数值条件可以直接改。改的时候实时预览命中数 N → M 和回归翻转；点「应用阈值」走 `applyRuleChange`，会翻转判对案例时转进编辑器，保存被拦。
- **新会话**仍然是空占位。

## 药点场景：数据
- `data/build_yaodian.py`（只用标准库，可复现）：
  - 输入：只读克隆 `zzhan111/ysbang-data` 的 `new_normalized`（as_of 2026-09-06）。
  - 输出：`data/yaodian_skus.json`。
  - 运行：`python3 data/build_yaodian.py --src /path/to/ysbang-data`（或设环境变量 `YSBANG_DATA`）。脚本里没有默认路径，不给就报错退出。
  - **源数据是私有仓库**（`zzhan111/ysbang-data`），不随本仓库发布；本仓库只提交派生出的 `data/yaodian_skus.json`（商品级聚合）。没有源数据也能直接构建 / 打开 `index.html`，只是不能重新生成 `yaodian_skus.json`。
- **保留规则**：1,735 个商品里保留 1,272 个，去掉 463 个无销售、无库存、也无补货建议的。其中 351 个有补货建议，704 个近 90 天有销。
- **聚合来源**：销售 9,864 行、库存流水 15,215 行、批次 2,267 行，只聚合到 SKU 级。
- **每 SKU 字段**：
  - 名称、规格、厂家、品类（二级）、处方/OTC、ABC（累计占比）、补货分层。
  - 库存、7/30/90 天销量、加权日均、覆盖天数（7 日均口径和加权口径）、距上次销售天数。
  - 在库最近效期、上次进货剩余效期、上次进价、主供应商、D7 价差。
  - 同通用名族库存、断货天数、信号灯、P0–P3。
  - **现有补货建议**（`sug / sugQty / sugWhy`）。
- 「现有补货建议」按 ysbang-adapters suggestion-engine 的逻辑（`packages/core/suggestion-engine.js:210-222`），加上临期禁补 90 天算出。原逻辑按「通用名 × 剂型」计算，这里按 SKU 近似。
- 测试会核对：只用代码规则 C1–C6 得到的判定，和这个建议对 1,272 个 SKU 全部一致。

## 药点场景：隐私（crucible 是公开仓库）
- **不进产物的字段**：
  - 构建脚本只读白名单字段：商品编码、业务类型、日期、数量、价格、批次、供应商名。
  - 不读 contact / saleMan / staffName / orgName / billCode。
  - 产物里没有任何单据行。
- **改名**：药房法定名称在 UI 里统一写作「药点ERP 示例药房」。
- **扫描**：`YSBANG_DATA=/path/to/ysbang-data python3 data/privacy_scan.py [文件…]`，测试里也会自动跑（测试同样需要 `YSBANG_DATA`，否则这一项失败）。
  - 正则：手机号、打码手机号、18 位身份证号、邮箱。
  - 药房法定名称及字号：运行时从私有源数据的 orgName 取，脚本里不写死。
  - 姓名比对：运行时从私有源数据里取出 contact / saleMan / staffName / orgName 的姓名和数字串，只在内存里比对，只打印计数和打码结果。脚本本身不含任何姓名、号码。
  - 2 字姓名如果只出现在厂家 / 供应商 / 商品名称里（例如「××药业」），算作误报。
  - 当前结果：**CLEAN**。另有 3 个误报：两个是厂家名里的 2 字子串，一个是通用词「未知」。

## 药点场景：五个屏
| 屏 | 内容 |
|---|---|
| ① 三元比较 | 真实 SKU 带现有建议。抽样模式：随机 / 同品类 / 同二级类 / 同二级类·有补有不补 / 未聊到格子。种子是三个「感冒灵颗粒」（补2 / 补1 / 不补） |
| ② 分堆排序 | 补货建议拖进 该买 / 待确认 / 不该买。不一致检测：同二级类、同分层、建议数量相差 ≤1，却分进了不同堆 |
| ③ 规则卡片 | 代码规则 14 条（每条标 文件:行）+ 访谈规则 5 条（纪要原文 + 行号，未确认阈值标「待确认」）。范围维度：ABC / 分层 / 处方·OTC / 品类 / 主供应商。行内改阈值，实时显示命中。写不成规则的偏好（起购量 / 药中缘 / 权限边界等）放在折叠面板里 |
| ④ 纠错循环 | 9 个【示例】标注，依据纪要行号，有 2 个种子分歧。例：停用 I4 会翻转「感冒灵颗粒｜新峰」，被拦；给 I4 加例外「必备流量品=是」（L106）可以保存 |
| ⑤ 覆盖矩阵 | ABC × 处方药/OTC/其它，「去补样本 → ①」。附数据来源与抽样说明 |

AI 追问仍然是模板，标「模拟」。预置标注标「示例」。所有数字都来自数据。

## 规则出处（已对照只读克隆核对；★ = 对最初给出的规则出处的更正）
- 目标覆盖天数 A=7 / B=8 / C=30 / NEW=7 ★：
  - 位置：`ysbang-adapters data/strategy/purchase-strategy.json:5-10`（feat/drug-stem-enrich@84f70d7），不在 ysbang-data。
  - 分支差异：B=8 来自提交 60c1360，默认分支 feat/pi-production-ui 上仍是 15。
  - A/B/C 指的是销售天数分层（`suggestion-engine.js:52-73`），不是销售额 ABC。
- 临期禁补 90 天 ★：`purchase-strategy.json:12`。仓库里没有代码读取它，设计文档在 `docs/plan/2026-04-24-design-v1.0-frozen.md:567`。
- 补货候选 / 优先级：`ysbang-data analysis/dimension_c/c4_replenish.py:38-79`，正确。
- 信号灯：`analysis/signals/run_cluster_signals.py:296-319`，正确（完整代码块是 295-321）。
- P0–P3：`ysbang-adapters packages/platform-intelligence/compute-product-intelligence.js:274-315`，正确。按「通用名 × 剂型」计算；断货 <7 天算 P1。
- D7 换供应商：`analysis/dimension_d/d7_supplier_price.py:25-32`，正确。
- ABC 80/95% ★：`ysbang-data build_new_normalized.py:733-746`（另见 `analysis/dimension_b/b5_abc.py:2`）。
- 处方药硬拦截 ★：`ysbang-adapters packages/cashier-hub/lib/compliance.js:77-84`。这是收银合规规则，不是采购规则，只作标记。
- 滞销（有库存且 60 天无销）★：`ysbang-data build_frontend.py:299-304`。这是看板标签，只作标记。
- 老板访谈：`ysbang-data` 分支 `origin/docs/procurement-ai-owner-interview`，`docs/procurement-ai-owner-interview.md`（2026-09-28）。纪要第 5 行注明它是结构化记录、不是逐字转录，所以卡片标「访谈纪要」，逐字摘录纪要原文并带行号，没有编造原话。

## 药点场景：已知问题
- 纪要不是逐字转录，引用的是纪要原文，不是老板原话。
- 停补 / 必备流量品 / 「效期未知」/「能承接需求的库存」都是人工映射或近似。
  - 必备品牌 → SKU 按「通用名 + 厂家」映射，属推断。
  - 30 元 / 1 年 / 5% 都标了待确认。
- 按 SKU 近似原本按剂型计算的逻辑（P0–P3、补货分层）。NEW 层很大（561 个），因为销售记录少于 3 条也算 NEW。
- 中药饮片按克计量，建议数量很大（例如补 1428）。已过期批次仍有结存，在库效期为负，会触发临期禁补。
- ERP 供应商字段里没有「药中缘」，主供应商最多的是「一分」（疑似自采占位），所以集中采购偏好暂时落不到 SKU。
- rx_mode 在源数据里缺失 641 个，已用库存流水的 recipeType 补齐（保留的 1,272 个全部有值：OTC 825 / 处方药 368 / 其它 79）。

---

# （以下为 v0.2 说明）Crucible 偏好挖掘原型 · v0.2 完整重设计（方向 B 为底）

单文件离线版：`index.html`（双击即可打开，内嵌 599 个 SKU；也会拷贝一份到 `dist/index.html`）。

## 构建 / 测试 / 截图
```bash
python3 build.py                 # src/ + data/sparrow_599.csv + data/yaodian_skus.json -> index.html, dist/index.html
cd test && npm install           # 首次：安装 playwright-core（test/node_modules 不入库）
cd test && YSBANG_DATA=/path/to/ysbang-data node run.js   # 核心流程 + 新结构 + 55 个 data-act 可达性 -> last-result.json, ../shots/flow-*.png
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
