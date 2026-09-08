# 设计核对

## 本地核验

- 当前 `editorial_flow.py` 三处 writer/reviewer/revision wrapper 将 `AgentResult` 收窄为五字段 `LLMCallResult`；设计以独立 execution service 替代该边界。
- 当前 HTTP fallback 在 `llm_client.call_with_fallback_result` 内部循环，因此初稿“由 AgentBus 对每次 HTTP 尝试记账”的表述不足。已补充 `call_http_attempt` + `run_http_fallback(sink)` 的分层，确保失败/retry/fallback 不会在返回前丢失。
- 当前迁移演练会丢失 work-items artifact trigger，设计已把 schema object manifest、真实 store fixture 和 migration registry 列为 Foundation 前置条件。
- 未触碰工作区已有 `README.md`、详情页、`editorial-article.tsx`、fixture 与测试改动。

## 外部分析限制

并行启动 Codex session `01a081ea-30c4-71a2-8f5a-45e9bffb8579` 与 Claude session `ecfa3bcc-5bc8-45ac-b6c8-d31097a13dd2` 的只读架构分析。两者均超时，未返回最终建议；Claude 通道也未形成可验证的 Claude 独立结果。Codex 的中间观察确认 HTTP fallback 会在 client 内收敛多次真实请求，已由主代理直接复核并补入设计。未宣称双模型审查通过或无限重试。

## 验证范围

完成 Markdown 节号、代码围栏、任务 JSON、引用本地文档、敏感 token 模式检查。此次为设计，不运行模型调用、迁移、产品测试、发布或推送。
