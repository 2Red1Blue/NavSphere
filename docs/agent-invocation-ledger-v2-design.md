# Agent Invocation Ledger V2 重构方案

日期：2026-09-09。状态：架构设计，未实施、未迁移、未发起模型调用。它是 [Editorial v2 主设计](editorial-v2-design.md) 与 [EGP-1](editorial-v2-acceptance-protocol.md) 的执行观测基础，不改变公开文章或前端 Reader 协议。

## 1. 决策

不在 `agent_bus.py` 中直接写 SQLite，不把调用记录塞回 writer/reviewer 的业务 envelope，也不继续扩展只有四个字段的 `LLMCallResult`。重构为三层：

```text
Editorial execution service
  ├─ InvocationBudget：调用前原子预留，调用后结算
  ├─ InvocationJournal：append-only 生命周期事件
  └─ AgentBus：纯路由/传输，报告每个尝试的受限结果
                              ↓
                      ACP / HTTP transport
```

`AgentBus` 仍不知道工作流数据库、文章正文、发布权限、Feishu 或凭证。它只接受不可写的调用上下文和事件 sink；工作流服务拥有 budget、持久化、恢复与放行判断。这样其他 Agent 角色可复用 bus，而 Editorial 能获得强审计边界。

现有实现的问题是：`AgentResult` 已有部分 token/adapter 字段，但 `editorial_flow.py` 在 writer/reviewer 调用时把它缩成 `LLMCallResult(text, provider, model, chain_index, attempt)`；`editorial_writer.py` 又只持久化四项路由字段。HTTP fallback 不回传 usage，失败路由也没有记录。因此“最终成功的一次”不能代表“一个任务的真实消耗”。

## 2. 真实性模型：不再把配置值称为实际模型

一条调用同时保存三种身份，名称必须不同：

| 字段 | 来源 | 能说明什么 |
|---|---|---|
| `declared_identity` | 代码路由配置 | 系统请求调用哪个 provider/model |
| `reported_identity` | provider HTTP 响应或 ACP adapter 结果 | 对方声称处理请求的身份 |
| `identity_assurance` | 代码判断来源可信度 | `attested`、`provider_reported`、`route_declared`、`unknown` |

`attested` 只用于能通过受信任、不可由本地配置伪造的机制确认上游身份的 transport。普通 HTTP `model` 字段通常最多是 `provider_reported`；ACP 仅回显请求 model 时是 `route_declared`，不是“实际模型”。缺失时为 `unknown`。

自动发布对身份的要求由 EGP policy 决定，但基础规则固定：writer/reviewer 的独立性只比较合格的 `reported/attested` 身份；任何一方 `route_declared` 或 `unknown` 时，模型独立性为 `unproven`，不能把自动审稿写成独立双模型通过。历史 v1 回执一律是 `legacy_unverified`，不回填伪造实际身份。

## 3. 不可变调用账本

新增私有 SQLite 表 `editorial_invocation_events`，用事件而不是可变“状态行”记录一次调用。避免崩溃时把已发生调用变成不存在。

| 列 | 必要性 | 用途 |
|---|---|---|
| `invocation_id`, `sequence` | 必需 | UUID + 单调用内单调序号，主键，支持 append-only 生命周期 |
| `work_id`, `operation`, `role` | 必需 | 关联工作项并区分 writer/reviewer/reader/research/revision |
| `event_type`, `created_at` | 必需 | `reserved`、`started`、`succeeded`、`failed`、`timed_out`、`abandoned`、`reconciled` |
| `route_id`, `attempt_no`, `chain_index` | 必需 | 记录每次 retry/fallback，不能只存最终成功路由 |
| `payload_json`, `payload_sha256` | 必需 | 规范化、无密钥的事件详情和防篡改摘要 |
| `policy_hash`, `prompt_hash`, `source/evidence hash` | 必需 | 关联冻结政策及输入版本；不保存 prompt、来源正文或响应全文 |
| `reservation` / `usage` / `identity` / `timing` | 必需但放入 payload | 结构随 transport 演进；查询由投影函数生成 |
| 原始响应、Authorization、prompt、消息正文、本地路径 | 禁止 | 避免泄露和重复存储 |

事件 payload 的共同字段：

```json
{
  "schema_version": 2,
  "declared_identity": {"provider":"openai","model":"gpt-5.6-sol"},
  "reported_identity": {"provider":"openai","model":"gpt-5.6-sol","source":"response.model"},
  "identity_assurance": "provider_reported",
  "reservation": {"input_tokens_max":12000,"output_tokens_max":3000,"cost_usd_max":null},
  "usage": {"input_tokens":null,"output_tokens":null,"cache_read_tokens":null,"reasoning_tokens":null,"cost_usd":null},
  "timing": {"started_at":"...Z","finished_at":"...Z","elapsed_ms":1234},
  "terminal": {"outcome":"succeeded","error_code":null}
}
```

`null` 表示未知，不表示零。金额只在可验证计费口径下保存；套餐模式不发明 token 到剩余额度或美元的换算。所有 JSON 采用现有 canonical JSON、哈希、大小和深度限制。

### 生命周期和崩溃语义

```text
reserve ──→ started ──→ succeeded / failed / timed_out
                    └─ 进程中断 ──→ abandoned ──→ reconciled（人工或安全恢复）
```

1. 调用前，在同一工作流事务中写 `reserved`，预留上限并检查全任务余额。
2. transport 即将请求前写 `started`；失败、HTTP 非 2xx、解析失败、超时、fallback 都必须有 terminal 事件。
3. 进程崩溃时存在 `started` 无 terminal；恢复器只追加 `abandoned`，消耗保持 unknown/reserved，自动放行失败关闭，不能免费“释放并重试”。
4. 每条 fallback 是新的 invocation_id；一个逻辑 writer action 可以有多个 invocation。最终 envelope 引用成功 invocation 与同一 action 的完整 invocation set digest。

若 provider 已返回内容但 terminal event 无法持久化，不能再次请求模型来“补账”。调用方标记 `persistence_unknown`，写入可持久化的工作流 failure/unknown 状态；该 action 的自动发布关闭，等待人工对账。调用前 reserve 无法持久化时则根本不允许发出网络请求。

`editorial_invocation_events` 追加 INSERT/UPDATE/DELETE 拒绝 trigger，索引 `(work_id, created_at, invocation_id, sequence)`。预算统计从事件投影获得，预留检查在 `BEGIN IMMEDIATE` 内完成，避免并发双花。不要用普通 `attempt_count` 代替账本。

## 4. 执行接口

### 4.1 transport 返回统一的受限结果

新增根目录模块 `scripts/invocation_contract.py`：

- `InvocationRequest`：role、operation、route、prompt hash、policy hash、已预留额度、不可写 trace ID；
- `TransportOutcome`：text、reported identity、usage、timing、terminal outcome、标准化 error；
- `InvocationSink` protocol：`reserved/started/terminal`，由 Editorial service 实现；
- 校验器：禁止 prompt 内容、URL、token、异常响应正文进入 receipt。

`scripts/agent_bus.py` 只将每次 ACP 或 HTTP 尝试转换为 `TransportOutcome`，并调用 sink。无 sink 的旧调用保持 v1 行为和现有小 receipt；有 sink 的调用必须完整事件化。禁止由 YAML 指定 sink、数据库、URL、模型或费用规则。

HTTP 不可只在 `call_with_fallback_result()` 返回最终成功结果后记账：该函数当前已在内部吞掉 provider retry 与路由 fallback。重构为两个明确层次：

- `call_http_attempt()`：只执行一个 provider 的一次网络请求，返回结构化 `TransportOutcome`，负责从响应解析 `model` 和 `usage`，字段缺失为 unknown；
- `run_http_fallback()`：保留现有 fallback 选择顺序和退避语义，但在**每次** attempt 的 reserve/start/terminal 都调用 sink，再决定是否继续下一路。

`AgentBus._invoke_http()` 传递受限 sink 给 `run_http_fallback()`，而不是对最终 `LLMCallResult` 补写一条成功事件。这样 HTTP 非 2xx、空文本、解析错误、超时、重试和降级调用都会进入账本。`llm_client` 仍负责安全 transport、红脱敏和 fallback，不负责发布门禁或把响应 model 当作已认证事实。

### 4.2 Editorial service 组装，而不是 bus 组装

`scripts/editorial_execution.py` 是 v2 唯一编排入口：

1. 从工作项和 EGP policy 创建不可变 invocation plan；
2. 调用 `InvocationBudget.reserve`；
3. 以 sink 调用 bus；
4. 把 terminal 事件持久化；
5. 根据完整 action digest 构建 writer/reviewer v2 envelope；
6. 由 release policy 校验 usage、身份、deadline、独立性和审稿结果。

这替换 `editorial_flow.py` 中把 `AgentResult` 手工缩成 `LLMCallResult` 的三段 wrapper。v1 流程保留原函数与 envelope 验证；v2 显式走新入口。不能让一个 `if v2` 分支散落在 writer、reviewer、bus 和 HTTP client 中。

## 5. v2 envelope 与 release gate

writer/reviewer envelope 升为独立 schema v2，而非修改 v1 必填字段：

```json
{
  "schema_version": 2,
  "writer_action": {
    "action_id":"...",
    "successful_invocation_id":"...",
    "invocation_set_sha256":"...",
    "terminal_receipt_sha256":"..."
  },
  "brief":"<existing structured brief>",
  "prompt_version":"editorial-explainer-v2"
}
```

工作流验证时同时验证：event 存在、工作项一致、policy/prompt/source digest 一致、成功事件唯一、没有未结算调用、预算未超、身份 assurance 满足 policy。v2 reviewer 的独立性比较 terminal receipt，非配置路由名。

旧 v1 `validate_writer_envelope`、`validate_review_envelope` 不改语义；分派由 schema/prompt version 完成。历史记录继续可读，但属于 `legacy_unverified`，不可补发成 v2 自动批准。

## 6. schema 与迁移：先修 P0/P1，再引入账本

这不是一条 `ALTER TABLE`。迁移分为同一发布单元的三个受控变更：

1. 给 workflow schema 引入可查询的 migration registry（不再只依赖 `PRAGMA user_version=0`）。
2. 重建 `editorial_work_items` 时保留所有列、CHECK、index、child FK 与 `editorial_work_items_artifacts_no_overwrite` trigger；迁移测试对比 `sqlite_master` 对象清单并测试非法 artifact 覆盖会失败。
3. 加入 `generation_key`、`supersedes_work_id`、`target_revision` 与 `editorial_invocation_events`；更新 `enqueue_if_new` 为明确首发/重写 API，所有生成 key 由代码验证和构造。

迁移后必须用真实 `EditorialWorkflowStore` 运行：有效 UUID/16-hex 首发、同源去重、显式 rewrite、child history、并发 enqueue、CAS、撤回、通知跳过。不能再用裸 SQL 插入虚构 work_id 作为恢复证明。

提交前/后恢复沿用 EGP-1 §6，但新增对象检查：迁移前后的 trigger/index/FK manifest、账本 append-only trigger、schema migration version、v1/v2 读路径。迁移后已重新开放写入时，旧备份不得覆盖，必须前向修复或增量对账。

## 7. G1–G10 的正确切分

| 阶段 | 组成 | 原因 |
|---|---|---|
| Foundation | P0/P1、generation key/rewrite、migration registry、G10 | 先有可回滚的 v2 schema、版本化 prompt/envelope 才能存新事实 |
| Execution ledger | G1、G3、G4、G5、G6、G7 | 完整 receipt、失败/重试、耗时、身份、独立性和 unknown 必须原子上线 |
| HTTP parity | G2 | 若保留 HTTP fallback，它不能绕过账本；未完成前只可人工路径 |
| Budget gate | G8、G9 | 冻结计费/套餐政策，调用前预留、调用后结算与 crash 处理 |
| Editorial v2 | full/segmented writer/reviewer、coverage review、publication v2 | 消费已可靠的账本和身份门禁 |

G7 不等待每家 provider 支持缓存 token：schema 先允许 explicit unknown。G8 主要是 policy/运维数据而非 `agent_bus.py` 特性。G9 依赖 G1/G3/G4，不能提前实现一个没有真实消耗的“预算器”。

## 8. 测试策略

**无网络单测**：canonical payload、密钥/URL/prompt 排除、unknown 不等于零、实际/声明身份状态、预算边界、fallback/retry、开始后崩溃、重复 terminal、并发 reservation。

**workflow 集成测试**：真实 store + 有效 ID，所有迁移对象保留，v1 可读、v2 可写、同源 rewrite、发布 unknown、delivery skipped、触发器拒绝覆盖。

**transport fixture**：ACP reported/declared/unknown，HTTP 含/不含 model/usage，非 2xx，malformed JSON，响应后持久化失败。每个失败调用都必须进入账本且阻断 v2 auto release。

**跨语言只做需要跨语言的部分**：Python/TypeScript 对拍 v2 public publication、canonical JSON、字节限制和 Reader；调用账本只在 Python 私有工作流，不为了“对拍”在前端复制一份账本逻辑。

**迁移演练**：沿用四个 EGP-1 故障点，但改用真实 store；另加 trigger/index manifest 丢失、有效新 work 创建、进程在 `started` 后崩溃、账本 terminal 缺失、已开写后前向修复。

## 9. 上线顺序与回滚

| 步骤 | 写入策略 | 放行条件 |
|---|---|---|
| 0 契约冻结 | 无生产写入 | fixtures、migration manifest、policy hash 与样本冻结 |
| 1 schema/ledger dark | 新表与 v2 代码可读，v1 仍默认 | 迁移演练和 v1 regression 通过；v2 release=false |
| 2 shadow accounting | 对受控影子任务记账，绝不发布 | 每次调用都有 terminal 或明确 abandoned；不出现配置身份冒充真实身份 |
| 3 full explainer v2 | 人工批准、notify=false | EGP-1 full 路径、预算和人工 golden 通过 |
| 4 controlled release | 按文体×路径逐层 | EGP-1 留出/十篇/持续抽样通过 |

回滚先关闭 v2 生成和自动发布，保留 Reader 与账本读取；不删除 v2 事件或把它们改回 v1。已发生的 unknown 或 delivery 事件走 reconciliation，不能因为回滚自动重试或重复推送。

## 10. 不做的事

- 不把 raw prompt、模型完整响应、网页正文或密钥写进调用账本。
- 不把 AgentBus 变成工作流/发布/Feishu 的总控。
- 不把 adapter 回显的配置 model 叫作“实际模型”。
- 不为账本引入消息队列、向量库、独立数据库或前端仪表盘。
- 不回填历史 v1 usage/身份，不用历史统计伪造基线。
- 不先做前端视觉，再把不可验证的模型输出接入生产。

## 11. 完成定义

设计完成不代表重构完成。重构完成要求：P0/P1 修复、真实工作流迁移演练通过、每条 v2 调用有完整或明确 unknown 的账本记录、失败/重试不丢失、身份门禁 fail-closed、v1 回归通过。只有随后通过 EGP-1 的人工 golden、影子和分层验收，才允许说文章质量链已上线。
