# 目标

用户要求用真实调用发现问题，并指出每次模型调用的预算预估过重。实现一个 B-preflight canary：一篇冻结 Psyche 全文，当前配置的可信直连 HTTP writer/reviewer 各一次，无自动 retry/fallback、无发布、无推送、私有输出。

调度器拥有调用次数、wall deadline、路由和输出 token 上限；Agent 不接受预算字段，不因货币估算未知拒绝生成。账本仍记录实际 usage/identity/cost；unknown 使 canary 结果 INCONCLUSIVE，不会自动扩容。

正式 B 的 golden、holdout 和 experiment.lock 继续独立，canary 不声称评价质量通过。修改范围仅 root Python shadow/路由辅助/测试与相应设计记录；不改前端/数据库/生产部署/全局 YAML/凭证。
