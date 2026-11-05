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

## 工作台型产品（2026-11-04 补充）

这一类不是开源项目，而是把待办、项目、日历、时间记录放进同一个界面的商业 app。

### 3x3

独立开发者 KIDSTYO 做的 iOS 和 Mac app，[App Store](https://apps.apple.com/us/app/id1603963061?l=en-us) 67 个评分，4.8 分，免费加 Pro 订阅。作者在[少数派](https://sspai.com/post/75386)介绍过设计思路。

- **三样东西互相链接。** 时间线记录每天实际干了什么、花了多久；待办分日、周、月、年、人生五层，下层挂到上层；标签串起所有东西。三者双向链接，点一个能跳到相关的所有记录。
- **出发点是回看。** 作者觉得清单类 app "用完即走"，做完就没了。他想知道每件事花了多久、事情之间怎么连起来、大目标是怎么一步步完成的。思路来自柳比歇夫时间统计法和双链笔记。
- **报表。** 日、周、月、年报表展示时间分布和目标进度。
- **最大的问题是上手难。** 作者自己承认引导很差、新用户容易卸载。App Store 的差评也集中在"看不懂、教程得跳出 app 去读"。

### 其他同类

| 产品 | 核心做法 | 和 Runway 重叠的地方 |
| --- | --- | --- |
| Sunsama | 每天早上的计划仪式和晚上的收工仪式；计划超过平时的工作量会提醒 | Runway 的"可投入、已投入、还可安排" |
| Motion | AI 自动把任务排进日历空档，项目按截止日倒排 | 最接近 Runway 的倒推，但它排到小时，Runway 只排到天 |
| Akiflow | 把各处的任务收进一个收件箱，再手动拖进时间块 | Runway 的任务池 |
| Morgen | 多个日历合并，AI 帮排 | Runway 读 Google 日历 |
| Structured、Tiimo | 时间轴优先，把时间画出来，专为 ADHD 的"时间盲"设计 | Runway 的时间线和浮窗整块计时 |
| Lunatask | 一次只看一个生活领域；按紧急、费力、是否已开始排优先级 | 浮窗的考前模式 |
| 点滴时间、奇特的一生 | 柳比歇夫式时间记录和统计 | 3x3 的时间线那一半 |

来源：[Motion、Akiflow、Sunsama 对比](https://dev.to/pickuma/motion-vs-akiflow-vs-sunsama-ai-calendar-planners-compared-in-2026-525h)、[Sunsama vs Akiflow](https://blog.saner.ai/sunsama-vs-akiflow)、[ADHD 任务 app 2026](https://super-productivity.com/blog/best-adhd-task-management-apps-2026/)、[Tiimo vs Structured](https://www.usecarly.com/blog/tiimo-vs-structured/)、[少数派时间记录文章](https://sspai.com/post/94606)。多数对比文章是厂商或带货博客，只能看定性结论。

### 对照 Runway

Runway 其实已经是一个工作台：任务池像 Akiflow，倒推像 Motion，负荷提醒像 Sunsama，时间线和整块计时像 Structured。它缺的和多余的都很清楚：

- **缺"计划 vs 实际"的回看。** Runway 记了预估和实际时长，但没有像 3x3 那样一条时间线把"计划做什么、实际做了什么、挂在哪个目标下"连起来看。对备考来说，这就是"这周 FSA 计划 10 小时，实际 6 小时，错题集中在哪一章"。
- **缺收工仪式。** Sunsama 每天结束时逼你处理没做完的事。Runway 浮窗有"多出来的挪到明天"，但主界面没有一个固定的收工流程。
- **层级够用，不要再加。** 3x3 的日周月年人生五层是为"记录一生"设计的。备考只需要三层：考试、科目、今天这一块。Runway 的项目、模块、任务正好对应。
- **不要变成全能 app。** 3x3 往阅读、影音、日记扩展，Lunatask 往习惯、心情扩展。Runway 的定位应该是"考试工作台"，只做备考相关的事。
  （2026-11-04 更新：用户决定范围扩到学习和生活，并以 ADHD 友好为核心，见 PRODUCT.md。边界改为：生活里"要做的事"进来，日记、心情、影音这类纯记录先不做。）
- **3x3 的教训和 Runway 一样。** 两者都是功能多、概念自创、上手难。Runway 的"航速、落地、PAPI 灯"和 3x3 的"三层链接"是同一种问题：作者自己懂，新人看不懂。

## ADHD 友好设计（2026-11-04 补充）

能找到的几乎都是从业者文章和产品宣传，没有系统研究，只能当设计假设。反复出现的几点：

- **时间盲：** 感觉不到过了多久、估不准要多久。对策是把时间画出来、计时一直可见、用固定长度的时段减少决定。爱沙尼亚的 [Dual Timer](https://evalab.artun.ee/dual-timer/) 设计文档引用了 Turjeman-Levi 等人 2021 年的研究，用 5 到 45 分钟的固定时段。
- **卡在开头：** 难的是开始，不是知道做什么。对策是把模糊任务变成第一步、给一个"状态差"的单任务模式。
- **逾期和连续天数会让人弃用：** 一天没做，看到红字或断掉的记录，就开始回避 app，越回避越多逾期。对策是没做完的安静地往后挪、不做打卡。见 [anti-streak todo apps](https://noodl-blog.pages.dev/blog/anti-streak-todo-apps)、[Best to-do apps for ADHD](https://focusdose.pages.dev/blog/best-to-do-list-apps-for-adhd)。
- **选择太多：** 根据当下的时间和精力只推荐一件。见 [How ADHD brains actually plan](https://staycomposed.pages.dev/method/how-adhd-brains-actually-plan/)。

Runway 自己的数据就是证据：10 月攒下 75 件没做完的旧任务，最后只能整批隐藏。

## 韩国学习手帐（2026-11-04 补充）

用户想要韩国手帐设计师的那种风格。查了品牌页、产品图和 YouTube 上的写法视频。

- **모트모트（Mottmott）텐미닛플래너：** 10 分钟格子计划本的原创，设计者金权峰是首尔大学视觉设计出身，2016 年创业，两年卖出一百万本（[시대 기사](https://www.sidae.com/article/2018040910128018030)）。内页左边是 TASKS 清单，右边是竖排时间表，每小时一行、6 格各 10 分钟；页眉有 YEAR / MONTH / DAY、D-DAY、COMMENT、TOTAL TIME，用蓝色小号英文标签。
- **리훈（Rihoon）오늘공부：** 一页里放 D-day、待办勾选（V 和空框）、时间表、学习时长，格子宽 4mm 按荧光笔宽度设计（[产品页](https://rihoon.co.kr/product/%EA%B3%B0%EB%B6%80-%EC%8A%A4%ED%84%B0%EB%94%94%ED%94%8C%EB%9E%98%EB%84%88-10%EB%B6%84-%ED%83%80%EC%9E%84%ED%85%8C%EC%9D%B4%EB%B8%94-%EC%9C%84%ED%81%B4%EB%A6%AC/312/)）。
- **ICONIC：** 2004 年创立的极简文具品牌，淡薄荷和奶白底、复古的番茄红和芥末黄点缀、粗体小号英文标题（[Fallindesign](https://www.fallindesign.com/brands/ICONIC.html)）。
- **用法（YouTube 写法视频，最高 470 万播放）：** 按科目给时间格涂荧光笔；一天结束数每种颜色的格子算各科时间；任务右边画 O、△、X；记"순공시간"（纯学习时间）和专注度；用过去的数据排以后的计划。

**采纳了：** 纸页加细线分区和蓝色英文标签、大写星期、手写体的 D-day 和总时间、10 分钟格子时间表和荧光笔涂法、按科目分组的 TASKS、O 和 △、每天一句 COMMENT。
**没采纳：** X（不惩罚）、贴纸和吉祥物（不服务备考，以后可以作为可选装饰）、起床和睡觉时间、专注度打分（以后再考虑）。

## 아날로그키퍼 Analogue Keeper（2026-11-04 补充）

用户说最喜欢 #analogue 的风格，对应的是韩国文具品牌아날로그키퍼。2018 年由문경연的求职作品集项目起步，在 SNS 上卖火后成了品牌，口号是 keep your own way（[heypop](https://heypop.kr/?p=465)，[Nagi Lifestyle](https://nagilifestyle.com/products/analogue-keeper-monthly-memopad)）。产品是各种便签和计划本：月计划、周计划长条便签、清单便签、分步便签、Logue Book。

设计语言：纸本身是灰调柔和色（鼠尾草绿、雾蓝、奶油黄、浅粉、淡紫、沙色），格子和横线用同色系深一点的线，顶上一条深一档的标题条写着小号英文，几何感粗体标题配小写品牌名，很多本不同颜色的便签拼在一起。

**采纳了：** 每个区块是一本不同颜色的便签纸、同色系的线、标题条、纸本下缘的几层纸边、Jost 几何字体和小写标签。内容组织沿用前面的韩国学习手帐。
**没采纳：** 实物照片里的贴纸和夹子。

## 对 Runway 的取舍

**保留并加强（别人没有的）**

1. 倒推分配引擎：多个 deadline 共享每天的可用时间，算出今天每个项目该做多少、会不会来不及。
2. 螺旋起步：开不了头时先 10 分钟。这正对准"问题在开始"。

**新增（真正利于备考的）**

3. 错题和薄弱点闭环：模考后按科目记错题，用 ts-fsrs 排复习日，复习任务自动进当天计划。
4. 按考试权重和模考得分分配复习时间：CFA 各科权重不同，得分低、权重高的科目自动多分时间。
5. 计划 vs 实际的回看：按科目对比计划时长、实际时长和错题，借 3x3 的时间线思路。
6. 每天的收工仪式：没做完的逐个决定挪到明天、退回任务池还是砍掉，借 Sunsama。

**不自己造（交给成熟工具或砍掉）**

7. 通用日历、看板、时间块拖拽：已有成熟实现，Runway 只保留能服务于倒推和当天执行的那部分。
8. 名画、多套配色、翻页书等装饰：不服务于备考。

**架构**

9. 本地优先：数据存在本机（IndexedDB 或文件），不依赖 claude.ai 登录。
10. 给 Claude 开一个 MCP 接口：像 open-sunsama 一样，让 Claude 能直接读计划、改计划，而不是靠重写整个页面。
