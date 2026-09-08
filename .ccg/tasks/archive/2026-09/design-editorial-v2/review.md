# 设计核对与限制

## 并行架构分析

- Codex 通道完成只读分析，session 01a0812e-dd69-74c2-a6b1-241d34dee1d3。建议保留 v1、完整来源与分段覆盖、受限自然正文、24 KiB 上限、Reader 失败状态和显式修订/默认不重推，已与源码核对并纳入方案。
- Claude 通道 session ac3da34e-fc8c-4a02-813a-885178aa46c0 在 150 秒限制内未产出最终结论，wrapper 报 execution timeout。持久化 assistant message 的 model 字段出现 glm-5-3-flash / glm-5.3-flash，并非期望的 Claude 身份。
- 因此不能称为 Codex + Claude 双模型分析通过，更不构成实施代码的双模型审查。没有修改全局路由或凭证；未将原始日志/思考记录纳入 Git。

## 主代理独立核对

- 确认前 4,000 字符截取、固定短摘要限制与 v1 prompt 重建绑定。
- 确认 D1 publication_json 24 KiB 约束，以及 Python 32 KiB manifest / 48 KiB request 限制。
- 补充当前 capture receipt 已为 v2，新完整阅读回执必须用新版本，不能复用历史 v2。
- 补充 SQLite 现有 UNIQUE(article_id, source_snapshot_sha256) 会阻挡同源重写，设计已要求受控表迁移和 enqueue 兼容。
- 补充禁推修订持久化 skipped 状态，不能伪造 notified，或让 published 调度器重新排队。
- 当前前端规范保留不动；v2 标题分流需在实现阶段更新规范。

## 验证范围

仅文档。校验任务 JSON、Markdown 标题顺序、文内现有模块路径、Git 差异/空白和密钥泄漏模式。未运行产品测试、写作 A/B、生产发布或飞书推送；这些列为实施验收条件，不声称已通过。

文档-only 不另行启动代码 review；本次没有新增值得替换当前实现规范的已验证代码模式。
