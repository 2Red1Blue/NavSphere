# 审阅与验证记录

## Think 方法

使用第一性原理区分硬约束与建议机制，并用最小实验定义每项解锁条件。核心不变量是：未耐久记录就不外呼；未知不算零；配置身份不等于上游事实；生产迁移与影子实验分离。

## 当前测试证据

- 项目 `.venv` 可导入 PyYAML 6.0.3，requirements.txt 已固定；系统 python3 缺 yaml。
- `.venv` 六个既有套件：84 tests，OK。
- workflow v2 migration：26 tests，OK。
- invocation contract：14 tests，4 errors；editorial execution：22 tests，18 errors。当前主要报错为新增 source_evidence_sha256 后构造器、ExecutionPlan 和测试未同步。因此不能声称 ledger 新链全绿。

## 持久化双路审阅

run_id `39760535-94b8-4b06-962b-42d0d1d3483d`。Codex REQUEST_CHANGES；第二通道返回 APPROVE，但 actual model 为 `glm-5-3-flash`，不是 Claude，不能算 Claude 审查通过。

采纳与本决策有关的两点：补充 reserved-only 的租约、fencing 与原子 abandoned；明确 micro-USD 使用非负十进制向上取整。Codex 要求的相应可执行测试已列为 OQ 关闭条件，本轮只做裁决，不伪造实现通过。

审阅还发现并行前端实现的生产 mock query 参数未受非生产开关保护，以及 README 链接风险。两者不属于六项裁决，未修改或回滚；必须由其文件所有者在合并/部署前处理。

## 状态边界

本轮没有签署 golden、修改根目录实现、安装依赖、迁移数据库、推送、部署或发送消息。裁决完成不等于 OQ 实现完成或契约冻结。
