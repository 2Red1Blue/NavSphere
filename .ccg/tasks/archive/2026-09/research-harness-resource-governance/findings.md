# Harness 资源治理结论

## 结论

Content OS 当前逐调用 input/output/cost 预估硬门禁属于过渡设计，应从默认运行路径删除。长期设计只保留可直接执行的 host limits，以及调用后的 UsageLedger；经济策略是项目/账户级可选熔断，不进入子 Agent 输入。

## 源码与官方模式

- 当前 Codex `spawn_agent` 调用面由 host 传 task/model/reasoning/fork context，没有 token/美元 budget；子 Agent 不自行估价。
- OpenAI Agents SDK 按 run 自动聚合 requests/input/output/total 和 per-request usage，允许 hooks 观测/外部限流；runner 硬停止为 max_turns、model timeout、tool timeout。
- DSH `packages/web/tool-web/src/fetch.ts` 明确 timeout 是 deployment policy、不是 model argument；session-title 插件由 host 配置 maxInputBytes/maxOutputTokens/timeoutMs；真实 E2E 由 Vitest 配置 timeout/retry/maxWorkers，`DSH_E2E_MAX_WORKERS` 处理共享 quota。
- DSH `thinking_token_budget` 是 provider 推理参数能力，不是子 Agent 的美元预算。

## 推荐边界

1. `ExecutionLimits`：host profile 管理 max_turns/calls、deadline、concurrency、retry/fallback、context/input bytes、provider max output。子 Agent 不可修改，且不进入 prompt。
2. `UsageLedger`：调用后记录实际 usage、reported identity、耗时、失败和 fallback；unknown 不算零，也不使已生成内容失败。
3. `SpendPolicy`：可选的项目/日/月累计告警或 provider quota 熔断，只基于真实累计和账户信号；不用估算单次成本拒绝请求。
4. `EstimatedUsageAdvisory`：如保留，只做 report-only A/B，比较估算与真实 usage；不影响调度。观察结束后可删除，不能转回默认硬门禁。

## Canary

真实 canary 使用固定运行形状而非逐调用预算：一篇全文、writer/reviewer 各一次、无 retry/fallback、provider 级 max output、run deadline、无发布/推送。usage/cost unknown 只令成本结论 inconclusive，不令文章生成失败；只有身份/内容/持久化安全门禁失败才阻断后续自动发布。

## 外部分析

Codex session `01a08607-3b04-7eb0-bff0-008d2b38a604` 与第二通道 session `e8b46498-bf9b-434a-917f-9d9f04d28618` 均返回相同方向；第二通道实际模型为 glm-5-3-flash，不计为 Claude 独立分析。
