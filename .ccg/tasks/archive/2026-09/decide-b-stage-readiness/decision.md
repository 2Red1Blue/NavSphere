# B 阶段启动裁决

日期：2026-09-09。用户已授权主代理决定技术方向；本裁决不伪造人类逐字节签署，也不授权尚不满足预检条件的付费调用。

## 决定

**NO-LAUNCH：不执行当前的一篇付费 full shadow run。** 接受其目标和预算方向，但拒绝当前 runner/lock 作为执行授权。修复以下调用前预检后，可在不再另行讨论架构的前提下执行一篇 Psyche shadow，私有产物、无发布、无推送。

## 四项签署包的解释与裁决

### 1. Psyche golden

技术裁决：Robinson Crusoe 场景的 canonical anchor 归入 **PSY-03（研究方法/孤立个体情境）**；PSY-06 可将同一 anchor 作为共享证据引用其“受访者判断”结果，不复制文本、不把它改写成 PSY-04 的样本结果。golden 保留英文原文和中文判定规则，不新增中文逐句翻译，避免翻译成为新的未核对事实源。

这只是 AI 的技术预核验，不标记为“人类签署”。用户可将此次授权记录为 delegated editorial approval；最终 signoff 文件应明确 `signer_kind=delegated_ai_review`，而不是伪造 `human_editor`。B shadow 可以在 delegated mode 下运行，但任何 E/D/F 发布或自动开放仍需要 EGP-1 指定的人类签署。

### 2. 三篇留出样本

不现在选择。留出样本必须在看到候选稿前冻结，但 runner 当前不能安全执行；此时提前从大量 inbox 中挑三篇只会制造无效的锁定批次。修复预检后，由独立的 `select-holdouts` 只读步骤按冻结风险类别、完整原文可得性和 source snapshot hash 选定，立刻写入 lock；不得基于模型输出更换。

### 3. absolute-only 预算

接受政策但尚不消费：full/explainer 每任务上限为 240 秒、6 次模型调用、64,000 input+output token、1,000,000 micro-USD（US$1）。当前一篇 Psyche full run 应预先保留两次调用的预算；若 retry/fallback 发生，也从同一上限扣除。usage/费用/身份 unknown 记 INCONCLUSIVE，不能把它们算零或以“shadow”豁免。

该政策不等于当前 runner 已强制：它尚未读取 lock、执行 wall-clock deadline、处理 cost_microusd 上限或把总量绑定到 run manifest。

### 4. experiment.lock

拒绝当前 `experiment.lock.draft.json` 的冻结：它标记为 DRAFT，但更重要的是 runner CLI 根本不读取它。policy_hash_basis 声称绑定 EGP-1 全文 + policy 段，而 runner 实际只 hash policy 文件；lock 的 source/golden/budget/seed/experiment total 都没有成为输入强制条件。

冻结后必须产生不可变 `experiment.lock.json`，并由 runner 在任何外呼前校验：

- lock schema/version、状态、experiment_id、canonical SHA；
- policy 文件内容/哈希、冻结全文 SHA、SourceDocument/packet SHA；
- delegated/human signer kind 与允许的运行阶段；
- 任务清单、全局预算、单任务预算、deadline、输出路径；
- golden/holdout source snapshot hashes 与不可替换的 selection seed。

## 当前阻断项

1. **路由预检缺失**：agents.yaml 的 writer/reviewer 都先走 ACP。ACP 在 OQ-15 下只能是 route_declared；runner 在写手和审稿均已调用后才 independence_check，必然以 unproven 失败。新增私有 `direct_http_only` shadow route policy：调用前解析候选 route，拒绝 ACP/代理/unknown，要求 writer/reviewer 为冻结可信直连 host 的 provider_reported 且 model 字符串不同。不能全局改 YAML，也不能跑后再判断。
2. **budget 未完整强制**：CLI 未读取 lock，budget_limits 默认为空；InvocationBudget 仅限制调用数和 token，未强制 240 秒墙钟、cost_microusd 或 experiment total。外呼前必须安装 deadline/cost/global budget guard。
3. **直接 CLI 有事后失败路径**：`editorial_shadow.py` 在 `run_shadow`/`main` 内有相对 import；以 `python scripts/editorial_shadow.py ...` 运行时会在模型调用后触发 ImportError。统一只支持 `python -m scripts.editorial_shadow`，或移除函数内相对 import；加一个无网络 CLI integration test。
4. **产物可覆盖**：`os.makedirs(out_dir, exist_ok=True)` 后以 wb 写入固定文件名。要求 out_dir 不存在并原子创建，或有 lock/run_id 子目录且拒绝任何已有文件；journal 与 artifacts 作为同一 immutable run unit。
5. **输出证据绑定不足**：writer draft sources 没有与 packet E1/允许 URL 映射做代码校验；review evidence_refs 主要校验 regex。runner 必须预分配 allowed sources、验证每个 block source_id 至少一个且每个 URL/evidence_id 来源于 packet，并验证 review refs 指向实际 draft/doc。
6. **契约门禁未全绿**：当前 Python root discover 可通过，但 NavSphere `pnpm test` 当前为 195 pass / 1 fail，`tsc --noEmit` 曾出现 fixture 类型错误；Reader/权威 validator 的空 source_ids 和规则漂移问题也尚未被当前 B runner 解决。影子产物不能进入 public route 前，这些门禁必须修复。

## 最小可逆实验

修复后先执行零付费 `shadow-preflight`：固定 Psyche source、lock、policy 和 direct HTTP route plan，输出预检 manifest，证明没有网络请求、没有 journal/out artifact、两个模型 identity 可被预期为 provider_reported 且 model 不同、预算足够、输出目录不存在。

只有预检通过才执行一次 writer/reviewer shadow。结果分三类：

| 结果 | 后续 |
|---|---|
| 账本、预算、身份、结构全合格；文章质量待人工判断 | 保存私有 artifacts，进入人工盲评，不发布 |
| writer needs_evidence / reviewer needs_evidence / unknown usage 或身份 | INCONCLUSIVE，保留账本和成本，修预检或资料，不重跑同一任务掩盖失败 |
| 预算/lock/持久化/完整性失败 | NOT_READY，零发布；停止后续 holdout 消费 |

## 测试观察

- Python：新增 shadow/execution/invocation/migration 组合 77 tests 通过；root discover exit 0。
- 当前 NavSphere：此前审计的 v2 fixture TS gate 仍需作为 B public-contract 前置；最新 pnpm test 输出包含 reader fixture timeout，不能用“738 全绿”概括整个系统。
- 两个外部只读分析均在 120 秒超时前未形成最终结论，因此不称为 Codex+Claude 双模型分析通过。本裁决以直接源码、配置和离线测试核验为依据。
