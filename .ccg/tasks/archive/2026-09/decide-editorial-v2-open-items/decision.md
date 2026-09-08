# 六项裁决

日期：2026-09-09。当前根目录不是 Git；NavSphere 有其他并行前端改动。本记录不修改这些实现。

## 1. OQ-14：拒绝同盘 JSONL 作为权威兜底，采用 durable-before-call

裁决为“方案 C”：预算检查与 `reserved` 事件在同一个 `BEGIN IMMEDIATE` 事务中原子提交；`started` 单独提交成功后才能外呼。主库在调用前不可写则不调用。provider 返回后 terminal 写失败时，主库已有 durable `started`，恢复器追加 `abandoned/reconciled`，自动发布保持关闭；不得重调模型补账。

同盘 JSONL 会同时受磁盘满、权限、文件系统损坏影响，并引入双账本顺序、去重、权限和回灌问题，不能保证“调用必有记录”。可以将系统日志作为 best-effort 运维线索，但不得作为发布或预算的权威事实。若未来要求跨磁盘灾备，应采用独立耐久存储和明确一致性协议，不是临时 JSONL。

当前实现尚未满足裁决：`InvocationBudget.reserve()` 先提交只读余额检查，随后 sink 才写 `reserved`，存在并发双重预留窗口；`InvocationJournal` 也未强制事件在网络调用前提交，默认非 autocommit connection 上可能因崩溃回滚 reserved/started。需合并为 `reserve_and_record()` 并强制提交/验证后才调用。

`reserved` 已提交但进程在 `started` 前死亡时，不能永久占用预算。每个 reservation 带冻结的 `lease_expires_at` 和 owner/fencing token；初版 reserve-to-start 租期为 60 秒。`start` 在 `BEGIN IMMEDIATE` 中校验同一 token、未过期且无 terminal，再追加 started 并提交；恢复器对过期且从未 started 的 reservation 原子追加 `abandoned`。原进程恢复后因已存在 terminal/租约过期而不能 started，也不得发出网络请求。这个回收只适用于“没有 started”的调用；started 之后永不按 TTL 推断没调用过。

## 2. OQ-15：接受 attested 当前为空集，但补 endpoint trust policy

立即签署：当前所有 transport 都不得生成 `attested`；route_declared/unknown 一律 `unproven`。解锁必须新建契约版本、新的 proof source 枚举和负面 fixture，并由人类评审确认其证明独立于本地 route 配置（如 provider 签名证明或受信任身份端点），不能只改映射函数。

`provider_reported` 可以用于模型不同性比较，但仅限冻结 policy 中标为 direct/受信任域的 transport 且响应明确返回 model；自定义 OpenAI-compatible 网关、代理或 adapter echo 仍为 route_declared/unknown。当前代码把任意 HTTP `response.model` 都升级为 provider_reported，需要补 route trust 分类，否则代理可以自报身份获得自动门禁资格。

## 3. OQ-08：接受 micro-USD 整数，但改名后再冻结

计量使用整数是正确方向；字段必须改为 `cost_microusd` / `cost_microusd_max`，不能让名为 `cost_usd` 的字段实际保存百万分之一美元。`1_000_000 cost_microusd = USD 1`。

transport 若返回十进制 USD，先取得原始十进制字符串；Python 用 `Decimal(value) × 1_000_000`，对非负值采用 `ROUND_CEILING` 向上取整到一个 micro-USD，确保预算不会因舍入而少算。负数、指数/非有限值、超出 canonical 安全整数范围或无法无歧义解析时为 null/unknown 并阻断货币预算放行；不得先转二进制 float 再计算。当前 ACP `raw.cost_usd` 和 HTTP `_contract_usage()` 仍可能把 float 直接传入只接受整数的契约，是实际不一致，必须修正 fixture、contract 和 projection 后关闭 OQ-08。套餐模式货币成本保持 null，不伪造价格。

## 4. 协议回灌：选择 b，但不是无审查机械转写

授权一条文档线在 OQ-14/15/08 实现与测试稳定后统一修改：主设计、EGP-1、CONTRACT/FREEZE、迁移报告和 `.ccg/spec/frontend/index.md`。要求一份 source-of-truth 映射表和单一 diff；用户/主代理审阅后才标冻结。并行实现期间不边写代码边多处改文档，避免口径再次漂移。

回灌内容包括备份水位/摘要准入、v1 dry-run 最小集、前向修复对账、registry 权威/user_version 镜像、OQ 裁决、original_title 仅 legacy/v1 和 Reader 三态。已落地事实与计划必须分栏，不能把 mock 写成生产已部署。

## 5. PyYAML：不全局安装，统一使用项目 venv

`requirements.txt` 已固定 `PyYAML==6.0.3`，项目 `.venv` 实测可导入 yaml；系统 python3 缺 yaml。裁决是增加/统一测试入口，强制 `.venv/bin/python -m unittest ...`，必要时启动前检查依赖，不执行全局 `pip install pyyaml`。

本轮用 `.venv` 运行六个既有套件：84 tests，OK。新增链路不是全绿：migration 单套件 26 tests OK；invocation contract 14 tests 有 4 errors，editorial execution 22 tests 有 18 errors，主要是新加 `source_evidence_sha256` 后构造器/ExecutionPlan/测试未同步。因此当前阻断已从“缺 yaml”变为真实契约不一致。

同时追认 explainer/full 的 A/B 计量模式为 `absolute-only`：历史 v1 没有完整 usage、失败调用和可信身份，不能计算同源 4 倍倍率。以后只有完成逐调用计量并冻结受控 v1 重跑，才能用新实验恢复倍率比较；不得追溯修改本批次口径。

## 6. 生产迁移：现在不执行，D 阶段条件满足后再开窗口

B 影子实验使用隔离/测试数据库，不需要先动生产库。生产迁移只有以下条件全部满足才允许安排：契约双端冻结；OQ-14/15/08 关闭；invocation/workflow/legacy 全套测试通过；迁移对象 manifest 与 trigger 行为验证通过；真实 store 恢复演练通过；一致备份和停写者清单准备完成；无未对账 publish/delivery unknown；人类明确批准目标、窗口和确认短语。

届时顺序为：停止所有写入者 → 等待/处理在途工作 → 在线一致备份和水位/摘要验证 → 隔离副本 dry-run → 执行迁移 → registry/user_version、trigger/index/FK、真实 store v1/v2 dry-run → 恢复调度。任一门禁失败保持 v1，不把“迁移脚本 26 tests OK”当成生产放行。

## 总体顺序

1. 修 OQ-14 事务边界、OQ-15 trust policy、OQ-08 单位命名及当前测试不一致。
2. 全量测试通过后完成 Python/TS 对拍并冻结契约。
3. 单线回灌文档和 spec，审阅 diff。
4. B 影子实验；生产库仍为 v1。
5. D 阶段再单独批准生产迁移。
