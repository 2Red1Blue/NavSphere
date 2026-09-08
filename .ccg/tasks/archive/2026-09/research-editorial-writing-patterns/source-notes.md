# 官方资料与源码核对（2026-09-08）

## STORM

仓库：https://github.com/stanford-oval/storm ，当前 main `fb951af7744dab086e34962e9bc6fe878e145f83`（最近提交 2025-09-30）。
论文：https://aclanthology.org/2024.naacl-long.347/
源码：https://github.com/stanford-oval/storm/blob/fb951af7744dab086e34962e9bc6fe878e145f83/knowledge_storm/storm_wiki/modules/article_generation.py

官方说明分研究／大纲、文章生成与润色。源码 generate_section 按当前章节查询 information_table；generate_article 遍历章节并通过线程池生成；ConvToSection 仍将检索所得材料限制为 1500 词。这证明其采用按章节取证，不能据此宣称所有资料完整无遗漏。README 明确声明成稿通常仍需显著编辑，不保证可直接发布。

## GPT Researcher

仓库：https://github.com/assafelovic/gpt-researcher ，当前 master `5cdad9cb434754188b78bd998df18dd8d502cf7e`（最近提交 2026-06-23）。
文档：https://docs.gptr.dev/docs/examples/detailed_report
限定来源：https://docs.gptr.dev/docs/gpt-researcher/context/tailored-research
源码：https://github.com/assafelovic/gpt-researcher/blob/5cdad9cb434754188b78bd998df18dd8d502cf7e/backend/report_type/detailed_report/detailed_report.py

DetailedReport 先研究和分子题，再逐子题检索、生成段落、提取既有小标题、检索已写相似内容避免重复，最后组装引言、目录、正文、结论与参考来源。当前 _generate_subtopic_reports 用 for + await 顺序处理，不能笼统宣称分节写作全部并行。官方支持 source_urls 和本地 documents，complement_source_urls=False 可限制研究范围。

## LangChain Open Deep Research

仓库：https://github.com/langchain-ai/open_deep_research ，当前 main `1b7d2e80db9faa586165c60e09096dbbfd483a64`（最近提交 2026-08-10）。
源码：https://github.com/langchain-ai/open_deep_research/blob/1b7d2e80db9faa586165c60e09096dbbfd483a64/src/open_deep_research/deep_researcher.py
提示词：https://github.com/langchain-ai/open_deep_research/blob/1b7d2e80db9faa586165c60e09096dbbfd483a64/src/open_deep_research/prompts.py
工具：https://github.com/langchain-ai/open_deep_research/blob/1b7d2e80db9faa586165c60e09096dbbfd483a64/src/open_deep_research/utils.py

有 research_brief、supervisor、researcher、compress_research、final_report_generation。think_tool 明确用于研究进度、证据缺口、是否继续检索等决策；工具实现只回传已记录的输入，不做额外验证、检索或独立模型调用。主管提示词倾向简单任务使用单个研究员，配置限制并发与轮数。compression 提示要求保留相关发现和来源、消除无关与重复材料；这是提示要求，不是不会丢信息的保证。写报告单独调用生成模型，并允许自然段与任务适配的章节结构。

## DeerFlow 2

仓库：https://github.com/bytedance/deer-flow ，当前 main `062273f850902ee4072626cad2dc0f614a386aad`（最近提交 2026-09-08）。
研究 Skill：https://github.com/bytedance/deer-flow/blob/062273f850902ee4072626cad2dc0f614a386aad/skills/public/deep-research/SKILL.md
Newsletter Skill：https://github.com/bytedance/deer-flow/blob/062273f850902ee4072626cad2dc0f614a386aad/skills/public/newsletter-generation/SKILL.md

README 明确 2.0 是通用 agent harness，旧 1.x deep-research 框架在独立分支。当前 deep-research Skill 要求多角度研究、阅读重要全文、检查数据／案例／限制；newsletter Skill 区分 daily digest、weekly roundup、deep-dive、industry briefing。重点条目包含多段事实和背景、读者意义与来源，简讯则为短标题和数句摘要。这些是 Skill 工作流指导，不能当成已自动执行的强制发布质量门禁。

## 对本项目的初步判断

补充生产经验：https://www.anthropic.com/engineering/multi-agent-research-system （2025-06-13）。作者报告研究主管按任务复杂度安排并行子任务，另做引用定位；评价包含事实、引用、完整性、来源质量和工具效率。文中强调多 Agent 会增加 token 使用，并报告其内部评测中单次多维 rubric 的一致性；这些是该系统经验，不能当作本项目的成本或效果预测。

已复查本地源文：source_evidence 仍固定取前 4000 字符，news_brief 仍是 300–600 字目标、最多四个 facts 和 240 字 analysis。先完整阅读可容纳的单篇原文；超预算文档再做全局分段覆盖和按节检索。原文解读、新闻短讯、多源研究应有不同结构与工具预算。HTML 文章正文采用动态语义章节，固定 facts/analysis/caveats 留在审稿结构。经审定正文再派生 Feishu 摘要。

前述 300 字规划、6–12 篇样本、覆盖翻倍、1.3 倍成本均是本项目提出的实验参数，不是本轮所查项目通用标准。需要控制输入覆盖、模型、长度和规划等变量后才能评估规划增益。本文档是源码调研，没有运行这些项目的端到端生成对比。
