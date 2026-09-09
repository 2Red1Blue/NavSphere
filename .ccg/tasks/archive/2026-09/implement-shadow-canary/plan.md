# 实施计划

1. 将 shadow runner 改为显式 canary profile：预检 source/policy/hash、原子新输出目录、2 次最大外呼、全程 deadline、private run manifest。
2. 基于现有可信 host 与 llm chain 构建 writer/reviewer 直连 HTTP 路由计划，排除 ACP 和全部 fallback，调用前验证两个 provider-reported model 不同。
3. 固定 E1→src_01 映射，校验写手 sources/block refs 与审稿 evidence refs，不允许输出伪造来源。
4. 修复 direct CLI/module import，增加离线 preflight/route/source/overwrite/deadline 测试；不使用 per-call monetary reservation。
5. 运行 Python 相关与完整回归、NavSphere 当前独立门禁；双模型审查后执行一次真实 canary，读回私有账本和产物，不发布。
