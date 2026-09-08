# 审查执行记录

## 本地核验

- 确认 source `workflow.db` 存在 `editorial_work_items_artifacts_no_overwrite`；演练 scenario_d 数据库缺失该 trigger。
- 确认 scenario D 直接插入非 UUID work_id 和非 16-hex article_id，绕开 `EditorialWorkflowStore` 的 ID/事件/去重行为。
- 确认草案 migration 的 generation_key 为 NOT NULL，而当前 enqueue INSERT 未提供 generation_key 且仍按旧键查询。
- 确认 baseline 盘点关于 writer/reviewer 收窄 receipt 的关键代码路径；确认 Psyche golden 仍显式为未签署 DRAFT。
- 仅对审查记录运行 Markdown/JSON/敏感模式和 Git whitespace 检查。没有生产源码变更，产品测试不适用。

## 外部分析限制

按 M 级要求并行启动 Codex、Claude 只读审查，日志位于根目录非 Git 的 `reports/review-editorial-v2-first-wave/`。二者均在 150 秒超时前未返回最终结论；Claude 通道未形成可验证的独立审阅结果。因此没有宣称双模型审查通过，也未为了获得批准无限重试。

主代理独立源码/演练核验是 findings.md 的依据。该结论应先阻断 production migration 和 G1–G10 实施切分，直至 P0/P1 修复及真实工作流重演。
