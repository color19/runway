# 同类项目调研（2026-11-04）

目的：Runway 要长成一个"真正利于备考"的 app，先看 GitHub 上别人做到了哪一步，哪些轮子可以直接用，哪些坑别人已经踩过。

## 一句话结论

直接以"备考计划"为名的开源项目几乎都是零星的课程作业，没有一个成熟到能参考。成熟的东西都在相邻领域：时间块和专注计时、自动排程、间隔重复。Runway 真正独有的是"从 deadline 倒推、多个项目抢同一份每日时间"的分配引擎，这块别人要么闭源（Motion），要么还很不稳定（FluidCalendar）。

## 看过的项目

| 项目 | 星数 | 做什么 | 对 Runway 的意义 |
| --- | --- | --- | --- |
| [super-productivity](https://github.com/super-productivity/super-productivity) | 2.3 万 | 待办、时间块、计时、专注模式，本地优先，全平台，有插件 | 时间块和专注计时已经做到很好，Runway 不必重造；它没有 deadline 倒推 |
| [Anki](https://github.com/ankitects/anki) | 3.3 万 | 间隔重复卡片 | 错题和公式记忆的标准做法 |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | 850 | FSRS 间隔重复算法的 TypeScript 包 | 可以直接引入，给错题排复习日 |
| [fluid-calendar](https://github.com/dotnetfactory/fluid-calendar) | 1000 | 开源 Motion 替代，自动把任务塞进空档 | 方向最接近，但 README 自称"非常不稳定，不建议生产使用" |
| [open-sunsama](https://github.com/ShadowWalker2014/open-sunsama) | 140 | 每日计划、时间块、专注，带 MCP 接口让 Claude 直接读写 | "让 AI 直接操作计划"这一点值得学 |
| [obsidian-time-ruler](https://github.com/j-palindrome/obsidian-time-ruler) | 350 | 任务列表和日历时间轴合一，拖拽排时间 | 交互参考：Runway 的时间线已经做到类似程度 |
| [obsidian-day-planner](https://github.com/ivan-lednev/obsidian-day-planner) | 2700 | 用纯文本格式写每日计划 | 数据格式简单可读，便于手改和 AI 改 |
| [Synapse](https://github.com/vincenzo-afk/Synapse) | 40 | 本地优先 PWA，React + Dexie(IndexedDB) | 技术栈参考：本地优先、离线可用 |
| [cram-engine](https://github.com/liuliu667/cram-engine) | 180 | 中文"期末速成"AI skill，拆解、讲授、检题、补漏 | 说明"学什么、怎么学"比"排什么时间"更缺；对概念类科目有用，对 CFA 计算题帮助有限 |
| [OpenPrep-AI](https://github.com/Jivan-Patel/OpenPrep-AI)、[studykit](https://github.com/btgaskin/studykit) | 0 | 按考试日期和大纲生成学习日历，加 SM-2 卡片 | 想法对，但都是早期，功能多半还停在 README |
| [TaskJuggler](https://github.com/taskjuggler/TaskJuggler) | 800 | 项目管理里的经典倒排排程 | 倒推算法的老祖宗，思路可借鉴，产品形态不适合个人 |

## 别人踩过的坑

- **问题在开始，不在计划。** GoodPlans 的创始人说，大多数下载用户从来没建过第一个任务。这和螺旋工作法的出发点一致：先降低开头的门槛。
- **空白计划表本身就是阻力。** 对 ADHD 人群尤其明显，"先把这周排好"恰恰是做不到的那一步。
- **计划只告诉你做什么，不告诉你怎么做。** 学生最后不看计划表，是因为它跟"今天这一小时具体干嘛"脱节。
- **布局复杂、改计划麻烦，就会弃用。** 一个小型学生实验里，退出的人说的都是"不知道怎么改""看不懂布局"。

来源：[GoodPlans 2.0](https://www.producthunt.com/p/goodplans/goodplans-2-0)、[Why most study planners fail](https://dev.to/cryptic_melancholy/why-most-study-planners-fail-a-student-led-experiment-on-real-behavior-3h7i)、[Planner usage at Uni](https://gargoyle.uni.illinois.edu/2048/uncategorized/planner-usage-at-uni)、[homework planner](https://thinkassist-nextapp.pages.dev/blog/homework-planner)。这些多是个人观察或产品宣传，样本都很小。

## 对 Runway 的取舍

**保留并加强（别人没有的）**

1. 倒推分配引擎：多个 deadline 共享每天的可用时间，算出今天每个项目该做多少、会不会来不及。
2. 螺旋起步：开不了头时先 10 分钟。这正对准"问题在开始"。

**新增（真正利于备考的）**

3. 错题和薄弱点闭环：模考后按科目记错题，用 ts-fsrs 排复习日，复习任务自动进当天计划。
4. 按考试权重和模考得分分配复习时间：CFA 各科权重不同，得分低、权重高的科目自动多分时间。

**不自己造（交给成熟工具或砍掉）**

5. 通用日历、看板、时间块拖拽：已有成熟实现，Runway 只保留能服务于倒推和当天执行的那部分。
6. 名画、多套配色、翻页书等装饰：不服务于备考。

**架构**

7. 本地优先：数据存在本机（IndexedDB 或文件），不依赖 claude.ai 登录。
8. 给 Claude 开一个 MCP 接口：像 open-sunsama 一样，让 Claude 能直接读计划、改计划，而不是靠重写整个页面。
