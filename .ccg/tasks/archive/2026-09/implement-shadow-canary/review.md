# 用户澄清后的架构裁决

用户澄清：问题不是如何给 canary 设置更准确预算，而是逐调用预算估算是否属于过渡设计。结论为是：预测 token/美元并在每次调用前拒绝，不应成为默认 harness 行为。

长期边界：Agent 不设置预算；harness 只控制 max turns/calls、timeout、concurrency、context/output provider limits 和显式 retry policy。UsageLedger 在调用后记录真实 usage/cost/identity；项目级 SpendPolicy 是管理员可选熔断器，不进入 agent prompt，也不因单次费用估算不准令正常生成失败。

当前 `InvocationBudget`/Reservation 的 token/cost 预估应从 shadow 主路径移除；durable-before-call 只保留最小调用意图、identity/route/attempt 与 lease/fencing，用于崩溃恢复，不作为费用预扣。usage/cost unknown 不让 canary 内容生成失败，但禁止据此声称成本已验证或自动放大并发。

其他 harness 证据：OpenAI Agents SDK 在 run context 自动汇总请求数与每请求 usage，硬停止为 max_turns/model/tool timeout；AutoGen 使用 runtime termination condition；本地 DSH 将 timeout、maxOutputTokens、并发/重试作为 host/plugin 配置，真实 E2E 用 DSH_E2E_MAX_WORKERS 控制共享 quota，模型工具不承担金钱估算。

因此原“实现 canary”任务被用户澄清后的架构讨论取代，本轮未修改 root 实现、未调用模型、未产生费用。后续若实施，应先改成 ExecutionLimits + UsageLedger + 可选 SpendPolicy，再运行两调用真实 canary。
