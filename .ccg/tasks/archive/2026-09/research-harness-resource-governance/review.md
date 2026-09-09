# 验证记录

依据 OpenAI 官方 Agents SDK usage/running-agents 文档、本地 DSH 源码和当前 Codex subagent 调用 schema。没有修改当前实现、执行真实模型调用、迁移、推送或部署。

结论区分了四类经常混称为 budget 的概念：provider 输出/推理配置、harness 执行终止、调后 usage 观测、组织级 spend policy。只有逐调用预测费用硬门禁被判定为过渡设计。
