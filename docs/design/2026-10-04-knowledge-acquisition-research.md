# 符号 AI / 专家系统时代怎样把“说不出的经验”变成规则：案例、技术与对 Crucible 专家知识层的启示

> 调研日期：2026-10-04（UTC+8）｜ 用途：给“访谈 → 契约 → 评分”产品层（见 `2026-10-04-interview-to-contract-design-v0.2.md`）提供历史依据
> 写法约定：每条事实都标了来源编号 [Sx]（文末附 URL）；引号里的英文是原文摘录；规则数等数字只在来源里查得到时才写。标“【推断】”的是我自己的推论，不是文献结论。

---

## 0. 结论先行

1. **成功的系统几乎都不是靠“问专家规则”建成的，靠的是“让专家看程序在具体案例上犯错”。** DENDRAL 的第一个问题是“你知道而程序不知道的是什么？”[S1]；MYCIN 团队发现让专家“tell us all that you know”完全没用，转而讨论具体疑难病例 [S2]；TEIRESIAS 把这种做法做成了工具 [S3]；XCON 的规则则来自生产中“导师”对每张订单的纠错 [S4]。
2. **你担心的“题目限定答案”，文献里是有对应方案的：** 把“问什么”从**领域内容**中剥离出来，改成**与内容无关的程序**，例如三元比较（repertory grid）、阶梯追问（laddering）、关键决策回溯（CDM）、有限信息任务、失败驱动的区分提问（TEIRESIAS / MOLE / Ripple-Down Rules）。这样设计者只需要懂“怎么问”，内容全部来自专家自己的案例、区分和判断。
3. **但这些技术也有各自的偏差。** 案例由谁挑、元素由谁选、归纳用哪些属性，都会把偏差带回来。这个问题绕不开，能做的是：**多种技术并用、多位专家取并集，并用专家判过的真实案例做回归测试**。Nottingham 的对照实验里，单个受试者一次会话只覆盖约 30% 的领域知识 [S17]。
4. **一个对你特别有用的老发现是：** 完全不懂领域的人仅凭常识就能拼出“看起来合理”的知识库 [S16]。今天的 LLM 正是这样一个“常识新手”。【推断】所以产品要抽取的价值是**专家和 LLM 默认判断之间的差**，不是“看起来合理的规则”。

---

## 1. 经典案例（7 个 + 2 个补充）

| 系统 | 领域 / 年代 | 专家与知识工程师 | 知识怎么来的 | 规则怎么修正 | 规模（有来源才写） | 结局 / 局限 |
|---|---|---|---|---|---|---|
| **DENDRAL / Meta-DENDRAL** | 质谱推断有机分子结构；1965 起，Stanford [S1] | Lederberg 先用自己的知识做出原型，再演示给质谱权威 Carl Djerassi；Djerassi 派 Alan Duffield 等人与 Buchanan **几乎每天**一起工作 [S1] | Djerassi 看了一个“很笨但能跑”的程序之后，团队问出了后来成为知识工程基石的问题：“**What do you know about this problem that the program does not know?**” [S1]；1970 年已经发表过一段知识工程会话的重构转写 [S1] | 让程序在已知谱图上出错，再补知识。Meta-DENDRAL 从“谱图–结构”配对样本里**自动归纳**质谱规则 [S1] | — | 证明了“系统的力量在知识，不在推理方法”[S14]；Feigenbaum 因此把知识获取称为“critical bottleneck”[S14] |
| **MYCIN** | 菌血症/脑膜炎抗生素选择；1970 年代，Stanford [S2] | 传染病专家 Stanley Cohen、Stanton Axline（另有传染病 fellow 参与），Shortliffe 担任知识工程师 [S2] | 原话：专家“not used to dissecting their clinical reasoning”，让他们“tell us all that you know”是“totally useless”；改为**讨论具体疑难病人，并让专家为自己的提问和决定说理由**，从中一块块挖出规则 [S2 ch.3]。每次会议后，Shortliffe 马上用原型把专家前一次说的规则跑出结果给他们看 [S2 ch.1] | 六步循环：专家提出要改的规则 → 工程师修改 → **重跑旧病例库**查一致性 → 有问题就和专家讨论 → 专家用新病例试 → 重复。配套工具：可索引的**测试病例库**、夜间批量回归、记录每次修改造成的输出差异 [S2 ch.7] | 约 450 条规则 + 约 1000 条表格事实 [S2 ch.36]（Michie 1990 的对比表给的是 400 条 [S13]） | 盲评：10 例脑膜炎、8 位传染病专家评分，MYCIN 方案 65% 被评为可接受，5 位教员平均 55.5% [S2 ch.31]；但从未进入常规使用，原因是成本、知识覆盖窄、界面 [S2 ch.36] |
| **TEIRESIAS**（Randall Davis） | MYCIN 类系统的知识获取助手；IJCAI-77 发表，1979 年博士论文 [S3] | 目标是**把程序员从“专家 ↔ 程序”的链条中拿掉** [S3] | 专家先看程序跑一个案例，再对**错误结论**发起挑战；TEIRESIAS 带专家沿推理链回溯，定位“哪条规则错了 / 缺了” [S3]。Davis 的对比：与其问“关于股市我该知道什么？”，不如说“这是你认为程序犯错的例子，这是它用到的全部知识、案例事实和推理过程；你知道而系统不知道的是什么，让你不会犯同样的错？”——后一种问题“much more focussed… much easier to answer” [S3] | 内置“**规则模型**”（对已有规则的统计概括）：专家输入新规则后，系统会提示“同类规则大多还提到 X，要补一个条件吗？”；专家可以否决。最后要求专家写下“为什么加这条规则”，作为溯源记录 [S3] | 演示中，补一条规则同时消除了 3 个错误 [S3] | 思想被并入 EMYCIN [S2 ch.7]。局限：只能修补已有词汇和结构之内的知识 |
| **R1 / XCON**（McDermott, DEC） | VAX 订单配置；1978 年 12 月开工，1980 年 1 月投产 [S4] | CMU 开发，之后交给 DEC 内部小组。DEC 小组最初 5 人，都没有 AI 背景，其中一名工程师兼任领域专家和对外接口 [S4] | 原先由“technical editor”人工配置订单。R1 上线后，部分老 technical editor 留下来当 **“mentors”，逐单检查 R1 的配置，发现问题就报给开发组** [S4] | 持续维护，约每年 4 人·年 [S4]。作者原话：“It is difficult now to believe R1 will ever be done” [S4]；“taken 80,000 orders to uncover some of the inadequacies” [S4]；并建议“从一开始就要有完善的问题报告机制” [S4] | 1979 年 4 月 250 条 → 1980 年底 850 条 → 1983 年 11 月约 3300 条，另有约 5500 个部件描述 [S4]；Michie 1990 年表格记为约 8000 条 [S13] | 商业上最成功的早期专家系统之一；教训是**知识获取 = 永久维护**，领域越易变越是如此 [S4] |
| **PROSPECTOR**（SRI：Duda、Hart 等） | 矿产勘探；1970 年代末，1982 年报道成果 [S5] | 斑岩钼矿模型的规则“obtained from a porphyry molybdenum exploration specialist”；1982 年 Science 论文的合著者里有 Hollister [S5] | 把专家知识表示为“**矿床模型 = 推理规则网络**” [S5] | — | — | 用勘探前数据，在 Mt. Tolman 指出了此前未知的矿化位置 [S5]；局限：一个模型只覆盖一类矿床 |
| **INTERNIST-1 / CADUCEUS / QMR**（Myers、Pople、Miller） | 普通内科诊断；1971 起，Pittsburgh [S6] | Jack Myers（内科“Sherlock Holmes”）；Pople 是 Simon / Newell 的学生 [S6] | 起步时 Pople 用 Simon 的**出声思维（protocol analysis）**分析 Myers 解疑难病例的过程。第一版“深层病理因果”方法因计算爆炸，做了一年就放弃 [S6]。之后 **Myers 做了一个关键决定：不靠“工程师访谈专家”，改以同行评审文献为金标准**——至少两个独立组报告过的表现才能写进疾病档案 [S6]。频率（1–5）按文献算；诱发强度（0–5）由 Myers 等资深临床医生给出 [S6] | 几乎每天维护：先用一个“教科书式经典病例”测新档案，再用 NEJM 的 CPC 难例测；漏诊就对系统做“autopsy”；所有测试病例命名存档，约 2000 例；每 2–3 年整批回归 [S6]。后来的 QMR-KAT 工具为每个条目记录出处和证据强度；7 个中心用同一批 109 篇文献独立建档，结果显著一致 [S6] | 1982 年约 500 种疾病、3550 个表现 [S6 引 NEJM 1982]；知识库累计约 **50 人·年** [S6] | 局限：不表示严重度、时间进程、解剖推理 [S6]。CADUCEUS 想补这些，Myers 说自己“没有再一个人·世纪”来建新的知识库 [S6] |
| **CYC**（Lenat, MCC） | 常识知识库；约 1984 年起（1990 年论文回顾了“过去五年”）[S7] | 专职“knowledge enterers”（后称本体工程师）[S7] | 流程：先用英文写出一个“微理论”（如金钱、购物、容器）→ 找出需要的概念并精确化 → 公理化 → **用故事测试：把故事表示进 Cyc，再问“读完故事的人都该答得上的问题”** [S7] | 夜间机器学习模块寻找知识库中“意外的对称/不对称”，这些多半是遗漏 [S7] | 1990 年已有 100–200 万条断言 [S7] | 说明了手工本体工程的极限成本；也说明**“用题目测知识”**是可行的验收方式 |
| **补充：SALT（→VT）、MOLE、ETS/AQUINAS** | 1980 年代中后期的**方法驱动型知识获取工具**（CMU / Boeing）[S8][S9][S10] | 专家直接使用工具，不需要知识工程师居中 | **SALT** 只收集三类知识角色：提出设计值的程序、约束、违反约束时的修复 [S10]；**MOLE** 只问能区分候选假设的知识，目标是“asks less and infers more”，遇到歧义时挑**信息量最大的问题**问 [S9]；**ETS** 用 Kelly 的三元比较让专家自己生成维度（见 §2）[S8] | MOLE 的“动态分析”：专家对测试诊断给反馈，MOLE 推断错误可能的原因并提出修补建议 [S9] | VT：SALT 生成 2191 条领域规则（占全部规则的 70.2%）[S10]；ETS：60 多个原型，工程师估计每个项目省 2–5 个月（作者自述，非正式评估）[S8] | 共同点：**工具懂“问题求解方法”，于是知道该问什么，但不预设答案** |
| **补充：Ripple-Down Rules / PEIRS**（Compton） | 化验报告解读；1990 年代初，悉尼 [S12] | 病理医生本人，**没有知识工程师** [S12] | 规则只在系统**给某个病例下错结论时**添加；新规则必须把当前病例和已存的“**cornerstone cases**”（以前判对的病例）区分开 [S12] | 每次加规则都自动做回归：不允许改变任何 cornerstone case 的结论 [S12]；在多分类版（MCRDR）的评估中，专家看过两三个对比病例就能写出足够精确的规则 [S12] | 9 个月 950 多条规则，由一名病理医生在日常工作中顺带维护 [S12] | 模拟研究显示，“出错再补”得到的知识库不比归纳得到的差 [S12]。局限：需要事先有好的数据模型和界面 [S12] |
| **补充：GASOIL / BMT（归纳）** | BP 油气分离配置；建筑消防设备配置 [S13] | 专家**只给例子和分类**，不写规则 | 用 ExpertEase/Extran、1st Class/RuleMaster 等归纳工具，从专家分好类的例子生成规则 [S13] | 加例子、重跑归纳 | GASOIL 约 2800 条规则、开发 1 人·年、维护 0.1 人·年/年；BMT 超过 30,000 条、9 人·年；对照 XCON 180 人·年（均为 Michie 1990 的表）[S13] | Michie 把文章题为 *Machine Executable Skills from "Silent" Brains* [S13]。局限：属性要事先定义（TDIDT 的前提）[S13]，所以属性表本身就是设计者偏差的来源 |

**方法论框架：KADS / CommonKADS。** 1980–90 年代欧洲把以上经验整理成建模方法：领域 / 推理 / 任务 / 策略四层知识模型，加一个可复用的**任务模板库** [S11]。它的 **Assessment（评估）模板**几乎就是 Crucible 的形状：abstract case → specify norms → select norm → evaluate → match → decision [S11 §6.4]。CommonKADS 还建议把任务模板当作“**overlay**”套在专家出声思维的转写上：专家的每一步推理都应能对应到模板里的某个推理步，对应不上的地方就是缺口 [S11 ch.7]。还有一个反直觉的单次实验：给知识工程师现成模型，结果比不给模型的组更差（识别病种 55%/50% vs 75%）[S17]。所以模板应该作为**后台检查表**，不要拿来约束专家怎么说话。

另一个实践补充：GTE 的 COMPASS 把专家知识先写成约 200 页、用领域行话写的英文 **“knowledge document”**，既作为实现规格，又发给其他专家做核验 [S25]。这和你的“契约 + 回译卡”是同一思路。

---

## 2. 诱出技术目录：怎样暴露隐性知识，以及各自的已知偏差

| 技术 | 怎样暴露隐性知识 | 已知偏差 / 代价 | 是否依赖设计者的领域知识 |
|---|---|---|---|
| 非结构化访谈 | 建立关系，摸清领域边界 [S15][S18] | 效率很低：Hoffman 的项目中 10 小时访谈对应 100 小时总任务时间，产出 753 个命题，约 0.13 命题/任务分钟，后几小时急剧衰减 [S15]；专家容易讲成教科书版 [S18] | 低，但提问的质量依赖设计者 |
| 结构化访谈 | 在初版知识库之上逐项追问；Hoffman 认为它比非结构化访谈“many times more efficient” [S15] | **问题清单就是设计者的知识边界**（这正是你担心的） | **高** |
| 出声思维 / 协议分析（Ericsson & Simon） | 记录专家**做任务时**的推理顺序 [S22]；INTERNIST 早期就是这样分析 Myers 的 [S6] | 只有“报告当下注意内容”（Level 1/2）才基本不改变思考过程；要求解释、推断（Level 3）会改变过程 [S22]；人常常报告**合理但不真实**的原因 [S22: Nisbett & Wilson]；在对照实验中最费资源 [S16]，但能抓到别的方法抓不到的知识 [S17]；边说边做会改变任务本身 [S18] | **低**：任务由专家完成，设计者只管录 |
| 案例法 / 关键事件 / **CDM**（Klein） | 回忆一件**非常规、难以抉择、专家觉得自己的经验起了作用**的真实事件 → 画时间线 → 标出决策点 → 用认知探针追问线索、备选方案、新手会怎么做 [S18][S20] | 回忆偏差和事后合理化；样本偏向“戏剧性”事件 | **低**：事件由专家挑，探针是通用的 |
| **ACTA**（Militello & Hutton） | 任务图、**知识审计**（问“新手会漏掉什么”）、情景模拟访谈，最后汇成认知需求表 [S21] | 依赖访谈员的追问技巧 | 低到中 |
| **方格法 repertory grid**（Kelly 个人建构理论；ETS / AQUINAS / WebGrid） | 每次拿三个元素，问“哪两个更像、和第三个差在哪？”，得到的维度（construct）**完全是专家自己的词**；再让专家用这些维度给所有元素打分，做聚类 / 蕴含分析 [S8][S18]。Boose 观察到专家常对分析出的关系“感到惊讶” [S8] | 元素选择决定了能挖到什么；生成的规则往往冗长；专家可能在不同抽象层次之间混用，需要“重新开始” [S8] | **很低**（只需要元素清单，元素也可以由专家给） |
| 卡片分类 / 概念分类 | 专家按自己的标准反复分堆，暴露他给领域强加的隐性结构 [S18] | 规则冗长；适合分类型任务，用在设计型任务上未必好 [S17] | 低 |
| **阶梯追问 laddering** | 一套**与内容无关的追问模板**：往下问“能举例吗”，横向问“同类还有什么”，往上问“它们共同点是什么”，问“怎么认出它是 X”“X1 和 X2 的关键区别是什么” [S18] | 依赖访谈员维护层级图；空间认知风格会影响效率 [S17] | **低**：模板通用，内容来自专家 |
| Teach-back | 专家讲 → 访谈员复述讲回去 → 专家纠正 [S18] | 复述本身会带入访谈员的框架 | 中 |
| 20 问 / 有限信息任务 | 只给专家很少的信息，看他**按什么顺序要哪些信息**，由此看出线索的重要性排序和策略 [S15][S18] | 访谈员需要备好答案表（要懂领域）；专家会觉得不自然 [S15][S18] | 中 |
| 刻意设计的任务 / 难例法 | 用限时、限信息让常规案例变难；遇到**真正的难例**时让专家自己录音 [S15] | 难例天然稀少 [S15] | 低 |
| 观察 | 观察真实工作 | 看不到“为什么”；同一个动作意图可能不同 [S18] | 低 |
| **从专家判例归纳**（ID3 / Michie；GASOIL、BMT；Meta-DENDRAL） | 专家只需要**判**（分类、排序），不需要说规则 [S13][S1] | **属性集合是预先定义的** [S13]，偏差藏在特征表里；需要足够多的判例 | 中：取决于属性表由谁定 |
| **失败驱动修补**（TEIRESIAS、MOLE、RDR） | 只在系统**犯错的那个案例上**问“你知道而系统不知道的是什么”，并要求新知识能把这个案例和以前判对的案例区分开 [S3][S9][S12] | 只能补出“错误会触发到”的知识；词汇和结构受限于已有表示 [S3] | **很低**：问题由错误生成 |

**横向发现（对比实验）。**
- Burton et al. 1990 比较了结构化访谈、协议分析、卡片分类、阶梯方格，两个领域各 8 名专家：**协议分析效率最低**；**完全不懂领域的人仅凭常识就能构建“看起来合理”的知识库** [S16]。
- 同一系列实验的综述：**“人为设计的”(contrived) 技术通常胜过“自然”技术**，而且能补上自然技术漏掉的知识 [S17]；软件版并没有稳定胜过纸笔版 [S17]；单个受试者一次会话约覆盖 30%，多人的并集覆盖良好 [S17]。
- **专家自己对某种技术的评价，不能用来判断它的实际价值** [S18 引 Schweickert et al. 1987]。
- Hoffman 1987 给出了经验阈值：每任务分钟约 2 条新命题说明方向对了，接近 1 条说明哪里低效 [S15]。

---

## 3. 知识获取瓶颈：为什么失败，什么起了作用

- **瓶颈的提出。** Feigenbaum 认为，专家知识“private”，原话是：“not because the expert is unwilling to share publicly what he knows, but because he is often unable to”；只能由第二方“在大量具体问题的情境中”细致挖掘；他称之为 “the critical bottleneck problem” [S14]。
- **理论根源。** Polanyi：“we can know more than we can tell” [S23]。Johnson 1983：人“not… able to reliably express what they know”，专家给出的往往是**事后重构的推理**，而不是真实用到的推理 [S24]（KA 文献常把“paradox of expertise”这一说法归到他名下，本报告没有核到原文页码）。Nisbett & Wilson：人常常报告合理但不真实的理由 [S22]。
- **失败的原因。**
  1. 访谈产出率低，而且越来越低 [S15]。
  2. 规则并不像设想的那样相互独立：专家需要看到相似规则、理解推理控制，才能写好一条规则 [S2 ch.7]。
  3. 领域在变，“永远做不完” [S4]。
  4. 想表达更深层的知识（时间、严重度）时，成本呈数量级上升 [S6]。
  5. 系统本身之外的因素：硬件成本、工作流整合、用户培训 [S2 ch.36][S6]。
- **起了作用的做法。**
  1. **具体案例 + 立刻可运行的原型** [S1][S2]。
  2. **失败驱动 + 回归病例库** [S2][S3][S6][S12]。
  3. 让用户**在日常工作中顺带纠错** [S4][S12]。
  4. **外部金标准和溯源**：INTERNIST 以文献为准，每个条目都有出处 [S6]。
  5. **方法驱动的工具**：知道该问哪类知识，但不预设内容 [S9][S10]。
  6. **能归纳的地方就归纳** [S13]。

---

## 4. 直接回答你的担心：哪些技术不依赖题目设计者的专业水平

**核心区分是“元层”和“内容层”。** 设计者负责的是**提问的程序**（元层），内容必须来自专家的四种产物：**① 专家挑的案例，② 专家自己做的区分，③ 专家对案例的判断，④ 专家的信息索取行为**。前面那些成功技术都是这样设计的。

| 历史技术 | 内容来源 | 设计者只提供 | 映射到 LLM 中介的诱出【推断】 |
|---|---|---|---|
| Repertory grid（ETS） | ② 专家对三元组的区分词 | “两像一不像”的程序 + 元素池 | LLM 从真实工件中抽三个给专家，追问“哪两个更像、差在哪”；把专家的原话收进维度库，再让专家按这些维度给工件打分。LLM **只做聚类和蕴含提示**（“你说‘稳’的工件几乎都‘不赶工期’，这两个是同一回事吗？”），不替专家命名维度 |
| 协议分析 / 出声思维 | ④ 专家边做边说 | 任务和录音 | 让专家边评一个工件边说（语音），LLM 只做转写和切分；然后用 CommonKADS 模板当 overlay，标出**哪类推理步没有对应**（例如专家从没提过“何时例外”）[S11] |
| CDM / 难例录音 | ① 专家挑的事件 | 五步程序 + 通用探针 | “说一个你判断和别人不一样、而且你是对的的例子” → 时间线 → 决策点 → 探针。异步“难例语音备忘”入口，对应 Hoffman 的录音机 [S15] |
| 从判例归纳（GASOIL） | ③ 专家的判断 | 属性表（**这就是偏差所在**） | 专家只做排序 / 分档；属性**不要由设计者写死**，用方格法得到的专家维度加上可观察的数据列作为特征，再做归纳 / 权重拟合（你的 v0.2 已经把拟合结果定位为“冲突提示”，方向正确） |
| TEIRESIAS / RDR 失败驱动 | ③ + 错误 | “你知道而系统不知道的是什么”+ 必须区分 cornerstone cases | 当前契约给出的分 ≠ 专家判断时，展示：工件 + 命中的条款 + 推理链 → 问一个问题。新条款必须让这个工件和已存的对照工件分开，否则拒绝安装。这是**最不依赖设计者**的一环，也天然生成回归集 |
| MOLE 区分提问 | ② 专家对“为什么是 A 不是 B”的回答 | 候选集 + “挑信息量最大的问题” | 只在两个候选判断（如“合格 / 不合格”或两个工件的先后）之间分不开时才问，问的是**能把两者分开的观察**，不问“还有什么重要的？” |
| Laddering | ② 专家的上下位和例子 | 6 类通用探针 | Interviewer 的提问语法限定为这几类通用探针，槽位只能填专家说过的词；Verifier 统计**新内容由访谈员引入的比率**（诱导率的加强版） |

**关于拖拽、比较、选择题这类 UI 是否有同样问题。** 结论是要分开看：
- **选择题**：选项由设计者写，和结构化访谈一样受设计者限定。只适合在专家自己的话已经出现之后，用来**确认**（回译卡）。
- **拖拽排序 / 分档**：采集的是**判断**（③），本身不受设计者限定。偏差来自两处：拿哪些工件给专家排；用设计者预设的维度去解释排序结果。解决办法：工件取自真实分布并加入边界例；解释时用专家自己的维度。
- **两两 / 三元比较**：如果问的是“哪个更好”，得到的是判断；如果问的是“哪两个更像、差在哪”，得到的是**专家自己的维度**。后者正是方格法，最不受设计者限定。

---

## 5. 对中间层与 UI/UX 的 8 条设计启示

1. **把“失败驱动修补”作为主循环，访谈只是冷启动。** 契约在专家判过的工件上跑分，只在分歧处提问，问法固定为 TEIRESIAS 式：“这是契约的判断和依据，你知道而它不知道的是什么？”[S3]。新条款必须区分当前工件和 cornerstone 工件，否则不让安装（RDR）[S12]；每次修改自动整批回归（MYCIN 的夜间批量、INTERNIST 每 2–3 年整批重跑）[S2][S6]。这部分可以直接落在已有的 Compiler / 回归测试上。
2. **维度发现阶段用三元比较取代设计者写的维度清单。** 产出专家原话的维度 → 专家按维度打分 → 中间层做聚类 / 蕴含，把“惊讶点”反馈给专家确认 [S8][S18]。设计者的维度只能作为**隐藏的覆盖检查**，不出现在问题里。
3. **把 LLM 当作“常识新手基线”，只追专家与它的差。** 先让 LLM 不访谈直接生成默认契约，Burton 等人的实验表明这种东西会“看起来合理” [S16]；然后访谈只追两类内容：专家的判断与默认契约不一致的工件；ACTA 式的“新手 / AI 会漏掉什么”[S21]。核心指标从“条目数”改为“**专家独有条目数**”，以及默认契约在专家判例上的误判率。
4. **问题模板和内容分离，并加以审计。** Interviewer 只能使用通用探针（laddering 的 6 类、CDM 探针、MOLE 式区分问）[S18][S20][S9]，槽位只能引用专家说过的词或真实工件；Verifier 标出所有“访谈员先提出的实质内容”。这是对 v0.2 诱导率指标的扩展。
5. **用 CommonKADS 的 Assessment 模板作为契约骨架和缺口检查。** 契约里的每个条款都要落到 abstract / norm / evaluate / match / decision 中的某个角色 [S11]；把模板 overlay 到转写上，找出空着的角色，据此生成追问。但**不要把模板术语展示给专家**，因为“给模型反而更差”的那次实验还没有被推翻 [S17]。
6. **把难例收集当作一等公民。** 提供异步的“难例 / 分歧事件”语音入口（CDM 五步，带时间线 UI）[S20][S15]。这些案例自动成为 cornerstone cases 和 holdout 的候选，它们比合成样本更能代表专家判断的边界。
7. **规划上，假设单个专家、单次会话、单一技术只能覆盖约三成。** 每个场景至少两种技术（一种自然技术，加一种方格 / 分类之类的人为技术）[S17]，尽量两位专家；完备度清单里加一项“技术多样性”，并把单专家结果标为“单源”。
8. **度量和溯源：** 访谈员 KPI 用“**每专家分钟的新增可执行条目**”（Hoffman 的命题率）[S15]，不用专家满意度（专家对技术的主观评价不可靠）[S18]。每个条目像 QMR-KAT 一样记录来源类型（访谈原话 / 判例 / 失败修补 / 文档）和证据强度 [S6]；契约导出成可供第二位专家审阅的 “knowledge document” [S25]。上线后留一个 XCON 式的 “mentor” 纠错入口，按“永远做不完”来做预算 [S4]。

---

## 6. 局限与待核

- INTERNIST 的历史部分出自 Miller 2010 全文，Thieme 原站超时，我是通过 exa.ai 的全文镜像核对的 [S6]。
- MYCIN、XCON 的规则数不同来源有出入：450 vs 400，3300（1983）vs 8000（Michie 1990 表），两种都列出了。
- Burton 1990 只读到摘要；更细的结果是通过 Shadbolt, O'Hara & Crow 1999 的综述转述的 [S16][S17]。
- Ericsson & Simon 的“Level 1/2/3”是常见概括，原文没有逐页核对 [S22]。
- 未覆盖：Gaines & Shaw 的 KSS0 / WebGrid 实证、ID3 原始论文（Quinlan 1979/1986）。
- 现代 LLM 主动诱出方面有 GATE（LM 主动提问或生成边界例让用户标注，可作为第 3、4 条的对照基线）[S26]。第 4、5 节里所有“映射到 LLM”的内容都是我的推断，没有经过实证。

---

## 参考来源

- [S1] Lindsay, Buchanan, Feigenbaum, Lederberg (1993). DENDRAL: a case study of the first expert system for scientific hypothesis formation. *Artificial Intelligence* 61. https://web.mit.edu/6.034/www/6.s966/dendral-history.pdf ｜ https://doi.org/10.1016/0004-3702(93)90068-M
- [S2] Buchanan & Shortliffe (eds., 1984). *Rule-Based Expert Systems: The MYCIN Experiments*（ch.1, 3, 7, 31, 36）. https://www.shortliffe.net/Buchanan-Shortliffe-1984/MYCIN%20Book.htm
- [S3] Davis, R. (1977). Interactive Transfer of Expertise: Acquisition of New Inference Rules. IJCAI-77. https://www.ijcai.org/Proceedings/77-1/Papers/052.pdf ｜ 期刊版 *AI* 12(2), 1979: https://doi.org/10.1016/0004-3702(79)90014-6
- [S4] Bachant & McDermott (1984). R1 Revisited: Four Years in the Trenches. *AI Magazine* 5(3). https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/445
- [S5] Campbell, Hollister, Duda, Hart (1982). Recognition of a hidden mineral deposit by an AI program. *Science* 217. https://www.science.org/doi/10.1126/science.217.4563.927 ｜ SRI: https://www.sri.com/publication/artificial-intelligence-pubs/prospector-a-computer-based-consultation-system-for-mineral-exploration/
- [S6] Miller, R.A. (2010). A history of the INTERNIST-1 and QMR projects, with lessons learned. *Yearb Med Inform*. http://www.thieme-connect.de/products/ejournals/html/10.1055/s-0038-1638702 （全文经 https://exa.ai/library/publication/vb4y7tccwl8 核对；PubMed 20938584）
- [S7] Lenat, Guha, Pittman, Pratt, Shepherd (1990). Cyc: Toward Programs with Common Sense. *CACM* 33(8). http://www.cs.toronto.edu/~jm/2507S/Readings/8.Cyc.pdf
- [S8] Boose, J. (1984). Personal Construct Theory and the Transfer of Human Expertise. AAAI-84. https://cdn.aaai.org/AAAI/1984/AAAI84-030.pdf ｜ Boose (1985) *IJMMS* 23: https://www.sciencedirect.com/science/article/abs/pii/S0020737385800559 ｜ Boose & Bradshaw (1987) AQUINAS, *IJMMS* 26: https://dl.acm.org/doi/10.1006/ijhc.1987.0319
- [S9] Eshelman & McDermott (1986). MOLE: A Knowledge Acquisition Tool that Uses its Head. AAAI-86. https://cdn.aaai.org/AAAI/1986/AAAI86-157.pdf
- [S10] Marcus, Stout, McDermott (1988). VT: An Expert Elevator Designer That Uses Knowledge-Based Backtracking. *AI Magazine* 9(1). https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/622 ｜ Marcus & McDermott (1989) SALT, *AI* 39: https://researchr.org/publication/MarcusM89%3A0
- [S11] Schreiber et al. (2000). *Knowledge Engineering and Management: The CommonKADS Methodology*. MIT Press（§6.4 Assessment；ch.7）. https://nixis.de/~nikku/uni/ws201011/knowledge-engineering/CommonKADS_methodology.pdf ｜ Wielinga, Schreiber, Breuker (1992) KADS: https://www.cs.vu.nl/~guus/papers/Schreiber92a.pdf
- [S12] Edwards, Compton et al. (1993). PEIRS. *Pathology* 25. https://pubmed.ncbi.nlm.nih.gov/8316495/ ｜ Preston, Compton, Edwards, Kang (1996). An Implementation of Multiple Classification Ripple Down Rules. KAW-96. https://ksi.cpsc.ucalgary.ca/KAW/KAW96/preston/MCRDR_Tut.html
- [S13] Bramer, M.A. Induction of Classification Rules from Examples: A Critical Review（转引 Michie 1990, *Machine Executable Skills from 'Silent' Brains* 中的对比表）. http://maxbramer.org.uk/papers/induction_review.pdf
- [S14] Feigenbaum, E.A. Knowledge Engineering: The Applied Side of Artificial Intelligence（Stanford HPP）. https://stacks.stanford.edu/file/druid:gx753nb0607/gx753nb0607.pdf
- [S15] Hoffman, R.R. (1987). The Problem of Extracting the Knowledge of Experts from the Perspective of Experimental Psychology. *AI Magazine* 8(2). https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/583
- [S16] Burton, Shadbolt, Rugg, Hedgecock (1990). The efficacy of knowledge elicitation techniques. *Knowledge Acquisition* 2(2). https://eprints.soton.ac.uk/252310/
- [S17] Shadbolt, O'Hara, Crow (1999). The experimental evaluation of knowledge acquisition techniques and methods. *IJHCS* 51. https://eprints.soton.ac.uk/252281/ ｜ 全文：https://exa.ai/library/publication/f18v84r2km1
- [S18] Shadbolt & Smart (2015). Knowledge Elicitation: Methods, Tools and Techniques. In *Evaluation of Human Work* (4th ed.). http://paulsmart.cognosys.co.uk/pubs/2015/Knowledge%20Elicitation.pdf
- [S19] Hoffman, Shadbolt, Burton, Klein (1995). Eliciting Knowledge from Experts: A Methodological Analysis. *OBHDP* 62(2). https://ideas.repec.org/a/eee/jobhdp/v62y1995i2p129-158.html
- [S20] Klein, Calderwood, MacGregor (1989). Critical decision method for eliciting knowledge. *IEEE SMC* 19(3). https://ieeexplore.ieee.org/document/31053/
- [S21] Militello & Hutton (1998). Applied Cognitive Task Analysis (ACTA). *Ergonomics* 41(11). https://www.tandfonline.com/doi/abs/10.1080/001401398186108
- [S22] Ericsson & Simon (1980). Verbal reports as data. *Psych. Review* 87. https://exa.ai/library/publication/mbdgrq3mx2g ｜ Nisbett & Wilson (1977). Telling more than we can know. https://home.csulb.edu/~cwallis/382/readings/482/nisbett%20saying%20more.pdf
- [S23] Polanyi, M. (1966). *The Tacit Dimension*. https://press.uchicago.edu/ucp/books/book/chicago/T/bo6035368.html
- [S24] Johnson, P.E. (1983). What kind of expert should a system be? *J Med Philos* 8. https://pubmed.ncbi.nlm.nih.gov/6339662/
- [S25] Prerau, D.S. (1987). Knowledge Acquisition in the Development of a Large Expert System (COMPASS). *AI Magazine* 8(2). https://ojs.aaai.org/aimagazine/index.php/aimagazine/article/view/582
- [S26] Li, Tamkin, Goodman, Andreas (2023/ICLR 2025). Eliciting Human Preferences with Language Models (GATE). https://arxiv.org/abs/2310.11589
