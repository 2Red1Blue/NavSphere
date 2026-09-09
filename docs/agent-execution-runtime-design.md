# Content OS：Agent 执行内核与用量观测重构方案

日期：2026-09-09。状态：设计提案，尚未实施。范围：Python 内容流水线、HTTP/ACP 接入、调用记录与私有实验；不迁移 Hermes/DSH runtime，不修改公开文章协议或直接开放发布。

## 1. 决策摘要

**删除默认的逐调用预测费用和累计 token 预留门禁，保留上下文适配、宿主生命周期控制、事后用量记录及独立发布检查。**

正常使用应是“处理这篇文章”，不是“先估计这篇文章多少钱、多少 token，再申请运行”。宿主从项目配置解析一次执行配置，写手只接收材料、任务和内容质量要求。

不采用两个极端：既不保留模拟计费系统，也不把无限循环、重复请求、取消失效当作无需处理的问题。预测价格不是防止失控的可靠代理指标。

本方案取代旧设计中这些默认前提：固定 `Reservation`、`usage_unknown` 导致下一次调用失败、影子运行必须先完成成本预算签署。**不追溯修改旧事件、已冻结实验结果或用户明确设定的费用硬约束**；若未来用户明确要求严格支出上限，需要另行说明供应商配额及计费保证边界，不能靠估价宣称保证。

## 2. 源码依据与边界

### 2.1 Codex：有上下文预算，不等于每次调用必须财务预留

核对的是 `openai/codex` 源码，固定到 commit `20f109eadb9b45360e6ca4f1dee2e82c83a48f7a`，不是 OpenAI Agents SDK，也不是当前对话暴露的工具 schema。

- [`session/token_budget.rs`](https://github.com/openai/codex/blob/20f109eadb9b45360e6ca4f1dee2e82c83a48f7a/codex-rs/core/src/session/token_budget.rs)：处理模型默认设置、上下文剩余 token 提醒和压缩回退；部分激活条件与模型能力及认证类型有关。
- [`context/token_budget_context.rs`](https://github.com/openai/codex/blob/20f109eadb9b45360e6ca4f1dee2e82c83a48f7a/codex-rs/core/src/context/token_budget_context.rs)：可以把上下文剩余量和管理指导注入模型消息。因此“Codex 从不向模型传预算”也不成立。
- [`config/token_budget_startup.rs`](https://github.com/openai/codex/blob/20f109eadb9b45360e6ca4f1dee2e82c83a48f7a/codex-rs/core/src/config/token_budget_startup.rs)：新子会话恢复配置后应用其模型默认值，完整历史 fork 保留父会话有效激活状态。
- [`multi_agents/spawn.rs`](https://github.com/openai/codex/blob/20f109eadb9b45360e6ca4f1dee2e82c83a48f7a/codex-rs/core/src/tools/handlers/multi_agents/spawn.rs)：已核对的 v1 子代理入口校验深度、解析模型/推理配置、创建并跟踪子会话；参数不要求美元估价或预留 token。

可借鉴的是配置继承、上下文管理、会话生命周期。**不能由这些文件推断 Codex 所有版本、私有服务端或账户层都不存在资源/费用限制。** 也不将公开源码等同于本机桌面应用的完整实现。

### 2.2 DSH：任务参数与运行配置分离

本地 `/Users/liuzx/Code/kaiyuan/deepseek-harness`，HEAD `682151187e46cfd8c44c457a491f08ff68c8d2fb`；本次核对的 subagent 与 token-meter 路径没有本地改动。

- `packages/subagent/tool-subagent/src/index.ts`：模型提供 description/prompt，可选路由配置；宿主构造请求并执行能力校验。
- `packages/subagent/subagent/src/types.ts`：`SubagentStartRequest` 有 `signal`、`agentOptions`、`outputSchema`、`maxDepth`、`toolFilter` 等。不能支持的能力在启动时明确拒绝，不静默忽略。
- `packages/subagent/subagent-dsh-sdk/src/run.ts`：输出 token 配置是可选 `maxTokens`，取消贯穿启动和执行；进程收尾等待与任务执行时限不是一回事。
- `packages/subagent/subagent-codex/src/run.ts`：包装 Codex app-server 的子运行，不是把 Codex 当成一条普通 HTTP completion。
- `packages/llm/token-meter/src/usage-projection.ts`、`turn-usage.ts`：从持久事件聚合 provider usage，处理替换/重试，另行描述上下文占用；缺失分项不应被解释成完整精确用量。

结论限定于这些子智能体执行路径：**没有逐调用要求模型填财务预算的证据**。不把测试超时、辅助标题生成器的参数当作主运行链的限制。

## 3. 当前代码中需要改变的耦合

| 已核对位置 | 当前行为 | 设计变更 |
|---|---|---|
| `scripts/editorial_execution.py / InvocationBudget.check` | 即使没有上限，也会因 `usage_unknown` 抛错 | 删除默认预算对象；未知 usage 不参与生成准入 |
| `scripts/editorial_shadow.py / run_shadow` | 写手固定预留 24000/6000，审稿固定预留 30000/4000 token | 删除这些运行参数；按真实材料与后端能力做上下文适配 |
| 同上 | 写手、审稿、身份检查都通过后才落盘产物 | 每个阶段返回后立即保存，失败也有结果和诊断 |
| `editorial_execution.py / _request_for` | 计算了 effective prompt 哈希，但未使用该局部值绑定请求 | 由最后一次宿主可见序列化生成摘要，实际发送同一不可变对象 |
| `editorial_execution.py / action_set_digest` | 按 work_id/operation 收集终态 | 增加明确 run/action 作用域，避免另一轮同类操作混入 |
| `scripts/agent_bus.py / _ROUTE_CATALOG` | 存在 Claude 路由的 `max_cost_usd`，HTTP 写手映射旧 `news_brief` | 新默认执行配置不继承隐含财务上限；深度解读使用专属内容配置 |
| `scripts/invocation_contract.py` | closed enums 绑定少数编辑角色及 reserved 生命周期 | 新内核契约与历史回执隔离，不能假装只改 JSON 就兼容旧 CHECK |

这是代码结构检查，不是这轮重新执行生产验证；已有测试总数或以前部署成功不构成以上行为正确的证明。

## 4. 最小架构

```text
编辑工作流：材料准备 → 写作 → 审稿 → 必要修订 → 发布候选
                       │       │       │
                       └── AgentExecutor ──┐
                           │               │
                    HTTP / ACP Adapter   Journal + 私有产物
                           │               │
                    外部模型/原生 harness  用量和运行状态视图

发布候选 → 确定性校验 → 已有 CAS / 发布 / 飞书投递
```

只设四个职责边界，不建设新的通用 Agent 平台：

1. **工作流**决定要做哪些内容任务、哪次修订对应哪个版本。
2. **Executor**管理一次逻辑任务的执行、取消、尝试记录和结果接受。
3. **Adapter**处理 HTTP 或 ACP/native harness 的协议差异、能力与错误语义。现有 AgentBus 收缩为路由解析/兼容入口，不与 Executor 各自拥有一套重试和执行状态机。
4. **Journal/Artifact Store**保存可恢复事实；报表从事实生成，不控制模型是否有资格写文章。

Hermes 保留现有宿主地位。DSH/Codex 的原生工具循环、上下文压缩由它们自己管理，不在 Content OS 外面再套一层模仿同样行为的循环。未来 DSH 插件只能调用同一内核，不复制一套编辑状态机。

## 5. 调用接口与配置所有权

### 5.1 业务调用只描述任务

概念接口，名称以实施时与现有模块对齐为准：

```python
result = await executor.execute(
    AgentTask(
        run_id=run.id,
        action_id=action.id,
        stage="writer",
        input_artifact=source.ref,
        prompt_version="editorial-explainer-v3",
        output_schema="editorial-draft-v2",
    ),
    cancel=run.cancel,
)
```

没有 `estimated_cost`、`reserved_tokens`、`budget_limits`。每次调用也不要求模型选择一个执行配置名。工作流创建 run 时由宿主解析配置并冻结其摘要。

`AgentResult` 至少包含：结果状态、输出引用、`stop_reason`、attempt/会话引用、usage 完整度及模型身份来源。**正文成功、运行终止、用量完整、发布资格是不同事实。**

### 5.2 项目配置一次，角色按需覆盖

沿用 `sources/agents.yaml` 的角色路由入口，`sources/llm.yaml` 保留 HTTP 模型参数；新执行设置集中到一个清晰的项目级配置段，不同时保留三处互相覆盖的超时和输出限制。

解析优先级：宿主安全约束 → 项目默认 → 角色覆盖 → 后端能力校验。普通文章任务不能改权限、取消保护或模型凭证来源；已有 `.env` 仍只由宿主读取，不进入 prompt、公共 API、模型工作目录或日志。

首轮运行配置建议（**工程起点，不是已验证最优值**）：

| 配置 | 起点及语义 |
|---|---|
| 并发执行槽 | 单 worker 两个活动任务；跨进程由同一个持久化协调点管理，不能每个进程各自算两个 |
| 内容修订 | 每篇最多两轮修订，每轮之后重审；不是“所有模型总共只能调用两次” |
| 阶段耗时 | 首轮长文阶段以 10 分钟为外层安全时限，记录真实耗时后调整；原有更短适配器限制必须一并消除冲突 |
| 连接/空闲 | HTTP 连接可先用 30 秒；长推理无 token 不等于挂死，空闲诊断按适配器有效进展和原生状态，不直接通用硬杀 |
| HTTP 输出容量 | 写手先用 8192、审稿先用 4096 token，校验 provider 对输出/推理 token 的实际语义；不是文章必须达到的长度 |
| ACP 输出容量 | 能力未暴露时使用原生配置并标注 provider-managed，不伪称外层已强制 token 上限；保留输出字节和进程资源保护 |
| 嵌套委派 | 普通写手/审稿没有创建子任务的需求，默认不开放；研究任务需要时才给相应能力 |
| 金额/累计 token 预留 | 默认不存在；不实现一个“关闭状态”的大而全预算服务 |

时限/并发/修订轮数由宿主执行，不塞入 prompt 让模型做算术。数据应能说明“排队慢、首字慢、审稿慢、修订多”，避免总超时把原因全部抹掉。排队时间与执行时间分开计量。

## 6. 上下文与文章质量：该保留的 token 计算

删除的是预测消费门禁，不是模型上下文容量检查。

HTTP 路径在宿主组装 messages 后计算/估算：系统指令、冻结全文、证据包、草稿、工具描述和输出空间。输入估算用于判断能否装下，不换算价格；输出与推理是否共享空间按 provider 能力解释。

1. 能完整容纳：写手与审稿员都接收全文。审稿员不是只看写手提炼的摘要。
2. 不能容纳：先选已配置且适合的更大上下文路由；不能静默更换用户指定模型。
3. 仍不能容纳：进入显式分段路径，保留全段覆盖、关键原文摘录、条件限定与原文定位。写手和审稿分别有遍历全部材料的路径，不能宣称一份二次摘要等于全文复核。
4. 分段也无法保证关键论证完整：输出 `needs_evidence` 或私有待处理稿，不用填充文字掩盖漏读。

ACP 的会话上下文由原生 harness 管理。宿主记录送入的全文/文件和边界、能力与终止原因，不声称能观察全部内部系统 prompt 或每次 compaction。若后端不能在规定权限下读取全文，则选择其他可用路由或明确失败。

写作目标是解释原文核心问题、论证链、例子、反方与局限，不是字数竞赛。`think` 中有用的“区分观点与证据、检查反例与限定条件”可以变成短的文体规则；**不把整个技能执行流程、预算讨论、任务归档要求注入写手，也不要求输出隐藏思维链**。保存正文、编辑说明、引用定位及审稿意见就足以检查质量。

## 7. 所有阶段都能用 ACP，但外部副作用仍由代码执行

| 阶段 | Agent 可负责 | 确定性代码必须负责 |
|---|---|---|
| 阅读/研究 | 解释材料、提出检索方向、识别缺口 | 抓取权限、全文冻结、URL/来源归属 |
| 写作/修订 | 组织论证、自然中文标题与正文、回应审稿意见 | 结构校验、引用存在性、版本绑定 |
| 审稿 | 事实支持、遗漏、解释质量、表达审查 | 验证审稿绑定的就是当前稿件 |
| 发布审计 | 建议是否满足编辑政策 | CAS、发布权限、目标路径与字节上限 |
| 飞书文案 | 提炼摘要与推荐理由 | webhook 签名、发送、重试与投递状态 |
| 归档建议 | 解释数据质量异常、建议保留策略 | 删除权限、已归档完整性验证、实际数据迁移 |

角色不是协议：writer/reviewer/research 都可配置 ACP 或 HTTP。不能以 ACP 缺 usage 为由禁用它，也不能因为它叫 Claude/Codex 就免除产物校验。抓取全文等简单工作默认用代码，不必每一步增加一次模型调用。

## 8. 生命周期、取消和重试

### 8.1 三层身份

- `run_id`：一次处理尝试，冻结来源版本、政策、配置与初始稿版本。
- `action_id`：一次具体阶段任务；新修订产生新的 action，与前稿显式关联。
- `attempt_id`：一次外部 dispatch；同一 action 的可重试请求产生新的 attempt。

这些 ID 不是 prompt 哈希。相同 prompt 可以合法重跑，但不能与另一次业务运行混账。发布幂等键也不能直接使用 attempt_id。

### 8.2 状态机

```text
queued → claimed → dispatch_intent → running → completed / failed
                              │          └→ cancel_requested → cancelled / outcome_unknown
                              └→ 进程崩溃或连接状态不明 → outcome_unknown
```

`dispatch_intent` 在发出请求前持久化。它只证明宿主准备发送，不能证明 provider 收到请求。完成分两步：先持久化输出，再记录结果引用和终态；均可重复登记而不重复生成。

协调租约只管理所有权，不代表预付费用。续租失败停止新的 dispatch；迟到 worker 的结果保留为私有产物，只有当前有效所有者通过 CAS 接受。**fencing 无法撤销已送达 provider 的请求**；已 dispatch 的 action 不因租约过期就自动交给另一进程重新调用。

### 8.3 重试归属

- 请求确认未送达、启动能力校验失败：可依据错误类型使用已配置候选路由。
- provider 明确拒绝的限流：遵守 retry-after；按后端政策退避。没有授权余额/额度时保留任务状态，不高频重试。
- ACP/native 内部有工具循环或自动重试：外层不再重复该循环；其内部调用不可见时显式标记观测范围。
- 请求已发出但结果未知：先查询/恢复原会话；无查询能力则保留 unknown，禁止自动换模型补跑。
- 输出格式错误：先确定性解析/校验，不能把所有错误都当网络失败。确需重新生成时记为明确修订 action，计入同一修订轮数，不另开无限“格式修复”循环。
- 真正取消：传播到协议取消通道，并等待进程/会话确认；发出取消请求不等于远端停止工作或停止计费。

取消意图是粘性的：用户取消后即使收到完整迟到结果，也只保留私有产物，不自动继续审稿或发布。心跳只能证明通道/进程活着，不能无限延长外层时限；安全时限触发也不代表文章质量不合格，而是独立运行状态。

去重能力必须说清楚：本地能保证同一 action 不被并发接受两份结果；不能在供应商没有幂等协议时保证全链路调用/扣费 exactly-once。未知远端占用要隔离并告警，不能直接释放后不断补位制造隐性并发。

## 9. 结果与用量：两类事实，不共用一个成功开关

### 9.1 先保存产物

私有目录：`state/runs/<run_id>/`。源文、写手原始结果、解析后稿件、审稿结果、失败诊断、manifest 分开保存。目录 0700，文件 0600；创建 run 目录时拒绝复用已有路径，避免覆盖旧实验。

写入采用同目录临时文件、flush/fsync、原子重命名及必要的目录同步。每阶段结束立即登记引用与哈希，后续阶段失败不丢前稿。失败不必有“全部成功”的 manifest 才能排查。

摘要分层：`source_sha256` 绑定冻结材料；`task_input_sha256` 绑定宿主构造的业务输入；`dispatch_payload_sha256` 绑定宿主实际交给 adapter 的非敏感任务载荷。最终格式转换发生后才能计算相应摘要；headers/密钥不进入摘要输入快照。ACP 只能证明交给 harness 的内容，不冒充全部上游模型 messages 的哈希。

### 9.2 用量按真实观测记录

| 字段 | 必要性 | 语义 |
|---|---|---|
| attempt_id、事件唯一键、观测来源 | 必需 | 去重与追溯 |
| input/output/cache/reasoning tokens | 条件 | 未提供为 null；不同 provider 计数包含关系由 adapter 归一化 |
| coverage、aggregation_scope | 必需 | partial/complete/unavailable；单次模型请求还是整个原生会话 |
| provider_reported_cost_microusd | 条件 | 仅 USD 且上游提供时记录整数；并非已核验账单扣款 |
| priced_estimate | 首版不实现 | 需要时由离线报表结合版本化价目生成，不混进事实账本或执行门禁 |
| reservation、predicted_balance | 删除 | 不属于正常调用契约 |

同一 attempt 的流式累计快照取最终值/替换值，不把每次累计通知相加。每次可见的真实重试独立计入；父任务汇总与子调用明细不可再相加。只有原生会话总数时按会话记账，不能伪造内部逐请求计数或“精确调用次数”。暴露内部请求时使用嵌套 request_id 归属该 dispatch，不为了计数再创建新的业务 action。

报表显示“已知 token 合计 + 观测覆盖范围”，未知不是零。套餐模式不发明 token→美元换算。usage 迟到用追加记录修正投影，不修改旧事件。

### 9.3 两种 unknown 必须分开

- `usage_unavailable`：正文及结果引用已可靠保存，仅用量不完整。继续审稿；不因统计缺失否定内容。
- `persistence_unknown`：结果接收与终态登记不完整。尽量保存私有产物，暂停自动发布并恢复登记；**不为补账重调模型**。

主库不可写时允许最小旁路记录（ID、哈希、时间、状态、私有产物引用），恢复器幂等回灌。旁路与主库在同一磁盘时无法覆盖磁盘满/整盘损坏；不能承诺“任何已发生调用永不丢失”。启动前已无法持久化 intent 就不发新请求；故障发生在响应之后则保留所有可保存的信息并明确未知。

## 10. 模型身份与审稿独立性

继续区分 requested/declared 与 reported identity；回显配置不算验证模型，更不能升级为 attested。当前没有独立上游证明时，attested 仍为空集。

但身份信息不应把整条私有生产实验锁死：

- 私有调试允许 unknown/route-declared，完整保存输出，并明确“独立性未证明”。
- 常规编辑默认安排隔离的审稿上下文，尽可能配置不同模型/供应商；比较已报告身份，同时记录未知情况，不仅比较路由名称。
- 内容质量评价和“不同模型已证实”分别给出结果，不能用模型不同来代替内容审查。
- **现有自动发布的严格身份规则不在底层执行重构中偷偷放宽**。若改为允许“配置上独立但缺上游证明”，作为独立、显式版本化的发布政策评估；未改变前依然保留发布隔离，不妨碍查看私有成稿。

这样不会为了实验能运行而强制所有阶段切 HTTP，也不会为了保留 ACP 而虚构可信身份。

## 11. 存储与协议迁移

不修改 v2 历史事件里的 `reserved` 含义，不批量改旧哈希，不把新结果强制伪装成旧 envelope。

当前旧表的 role/operation/event_type 有 SQL CHECK 且禁止更新/删除。为支持通用阶段并真正去掉财务语义，建议**新增本地运行表，由新内核单写；旧表只用于历史读和已有 v2 回执验证**：

1. `agent_action_state`：action 所有权、当前 attempt、租约/fencing、已接受结果引用。可变协调状态；业务文章阶段状态仍归已有 workflow，不能另造一个相互竞争的编辑工作流。
2. `agent_attempt_events`：append-only 执行和观测事件。核心列为 schema_version、run_id、action_id、attempt_id、sequence、event_type、created_at、payload_json、payload_sha256。`(attempt_id, sequence)` 唯一，另建 run/action 索引；结果/usage/身份和必要来源哈希放规范化 payload。

这是两个不同职责的表，不是计费预留/扣款/退款表组；不增加通用消息队列、分布式事件总线或财务结算服务。时间测量同时保留 UTC 审计时间与本进程单调时钟耗时，不能跨重启直接比较单调值。

公开文章 schema v2 与新的 runtime receipt 版本独立。发布适配层显式支持新回执版本后才能进入 v2 自动发布链；此前仅私有影子运行。旧 Python/TS 校验器不得静默接受陌生版本。

迁移采用加表和 reader/version 分派；新 run 只写新内核，旧 run 按旧路径完成或明确停用后重建 run，不双写两套执行账本。先支持私有独立 SQLite 实验，再在生产数据库做备份、准入验证及增量迁移。迁移失败回滚新代码启用状态，不删除新产物，也不让旧程序消费新运行。

新运行事件与原始输出都在本地私有层，不上传 Cloudflare D1。D1 仍只承载必要的公开文章投影和索引；当前 24 KiB publication 限额是项目协议约束，不冒充 Cloudflare 官方单行限制。输出过大不得直接截断已审正文；先按当前协议做结构化编辑并重审，若真实样本持续证明容量不足，再单独版本化调整存储协议。

## 12. 代码实施顺序

| 顺序 | 主要文件/职责 | 完成条件 |
|---|---|---|
| 1 | `invocation_contract.py` 保留 legacy；新增 `agent_runtime_types.py`、`agent_runtime_store.py` | 新 task/result/事件契约、两张本地表；旧 fixtures 不变；新版本不可被旧验证器冒认 |
| 2 | 新 `agent_executor.py`；重构 `agent_bus.py`、`llm_client.py`、`acp_agent.py` 的接入边界 | 统一取消、typed errors、能力描述、输出引用；清除默认隐含费用帽；每层重试归属可测试 |
| 3 | `editorial_shadow.py`、`editorial_prompts.py`、项目模型配置 | 用同一个 executor；删固定预留；提前落盘；全文输入、哈希与 action 作用域正确 |
| 4 | 新内核离线测试 + 私有真实运行 | HTTP/ACP 各自能完成适用路径；usage 缺失不阻断；错误结果可恢复；真实正文可读 |
| 5 | `editorial_workflow.py` 和发布回执适配 | 私有结果合格后接正式 workflow；新版本、CAS、发布质量与旧读路径回归通过 |
| 6 | 文档和旧执行入口清理 | 更新主设计/EGP-1/G9 等预算前提；旧预算实现不在新 run 可达路径，仅保留历史契约读取所需代码 |

文件名为实施目标，禁止为了“职责清晰”把每个数据类都拆成模块。先采用新 executor 接通真实成稿，不同时迁移宿主、重做前端、切换云存储或重建所有 Agent。

## 13. 测试与放行：先拿到真实内容，再做正式质量验收

### 13.1 必须自动覆盖的失败路径

1. 没有预算参数也能执行；writer usage 全空时 reviewer 仍被调用，统计显示 unavailable。
2. writer 成功、reviewer 失败：writer 的原始和解析产物仍存在，重试只针对允许恢复的阶段。
3. dispatch 之前取消不发请求；dispatch 后取消/断连不误判为“没有消费”。
4. 两个 worker 争抢同一 action，仅一方能获得有效 dispatch 权；旧 worker 迟到不能替换已接受结果。
5. 主库在响应后故障：不重调 provider；旁路回灌幂等；主库和旁路同时不可写时如实报告无法保证持久化。
6. 累计 usage 快照、内部重试和父子汇总不重复计数；未知价格不计为零费用。
7. 模型达到输出上限而截断：结果标记 incomplete，不能因 HTTP 200 或 JSON 可解析就判为成稿。
8. 两次 run 使用同一篇文章：prompt/结果/action 集合不串；修改宿主发送载荷会改变对应哈希。
9. ACP 不支持某项必需权限/输出能力时明确拒绝或使用事先声明的适配路径，不静默降级。
10. 输入全文覆盖、来源 URL 绑定、审稿当前版本绑定、旧 v1/v2 读端与公开发布隔离全部回归。

### 13.2 真实运行安排

先用 Psyche 这篇已讨论文章跑私有完整流程，保存可直接阅读的正文和审稿反馈；这属于开发验证，不以 golden 签署、留出样本选定或美元估算为启动前提。使用用户已配置且可用的路线，不凭路由标签声称实际模型身份。

随后用一篇短新闻、一篇长论文/长文验证文体与上下文差异。HTTP 与 ACP 的测试按各自实际能力进行，不用 fake bus 的成功替代真实 transport 证据。需要有权限的真实执行，但不必每一篇重新审批相同项目设置。

每篇检查：核心论证是否完整、限定条件是否保留、是否只有摘要、是否有无依据扩写、标题是否自然、是否达到可读的成稿质量。六项 golden 等正式对照继续用于质量校准，不再承担“允许开发调用模型”的职责。

耗时与用量先记录事实，不把“每篇两次调用、固定金额、固定字数”当质量保证。初始目标是正常全文路径 writer+reviewer；发现具体问题才修订，并保留失败样本。长期自动发布仍须经过版本化的质量验证与现有发布授权链。

## 14. 不做的事情与最终效果

- 不实现预测账单、虚拟余额、逐调用资金冻结、套餐 token 兑美元模型。
- 不为这次重构迁移到 DSH、换掉 Hermes、搭建队列服务或把每个普通函数 Agent 化。
- 不把所有错误统一为超预算/生成失败；不因未知用量丢弃有效文章。
- 不把取消、fencing、文件溢写或“模型说自己是 Claude”包装成更强保证。
- 不让写手持有飞书 webhook、生产数据库或部署凭证。研究如需网络由受控工具提供；作者/审稿只接触材料和私有输出目录。仅设置 cwd 不是沙箱；所需工具/文件隔离必须由后端权限或系统沙箱实际执行，无法提供时不能悄悄放行全权限子进程。

用户看到的是：提交文章 → 看到阶段进度 → 读到完整草稿 → 看到具体审稿问题和修订稿 → 满足发布条件后发布。运行配置只在项目级维护；未知用量有提示，失败产物可检查，文章质量问题能够通过真实结果定位。
