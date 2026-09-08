# Editorial v2 第一波实现审查

日期：2026-09-09。范围是 `/Users/liuzx/personal-content-os` 下第一波报告、草稿、隔离演练和现有 Python 实现。没有修改任何生产脚本、数据库、凭证、远端部署或 Feishu 配置。

## 结论

第一波没有接入可运行的 Editorial v2；当前产出是高价值的诊断和演练材料。绝对成本模式、完整阅读缺口和 golden 草稿方向正确，但**不能进入“契约冻结已完成”或第二波并行实现**，直到 P0/P1 被修复并重新演练。

## P0：迁移草案丢失 append-only 防护触发器

证据：现有 `sources/workflow.db` 有 `editorial_work_items_artifacts_no_overwrite` trigger；演练后的 `reports/editorial-v2-migration-drill/sandbox/scenario_d.db` 没有该 trigger。`run_drill.py:253-268` 关闭外键、删除并重命名父表，只重建 `editorial_work_items_ready` 索引；`migration_drill.sql` 也没有该 trigger。现有定义在 `scripts/editorial_workflow.py:436-494`。

影响：该 trigger 阻止已保存 evidence/draft/review/approval/publication/delivery artifact 被覆盖。迁移后在进程重启之前这一完整性保护消失；`foreign_key_check` 不会发现 trigger 缺失。因此“场景 c/d PASS”不能作为生产表重建放行证据。

修复门槛：正式 migration 以现有 schema 为单一来源，显式保留/重建所有 parent index、trigger 和 child FK；迁移测试逐项比对 `sqlite_master` 对象清单和 trigger 行为（包括一次非法 artifact 覆盖必须被拒绝），不能只做 integrity/foreign_key_check。

## P1：场景 D 绕过真实工作流，不能证明 generation key 路径

`run_drill.py:331-345` 直接 SQL 插入 `work_id="drill-wi-0001"` 与 `article_id="drill-article-0001"`。现有真实工作流要求 UUID work_id（`scripts/editorial_workflow.py:145-154`）和 16 位小写 hex article_id（:139-142），并通过 `enqueue_if_new` 追加 enqueued event（:542-565）。场景 D 没有 append event，也没有调用 scheduler/store。

影响：报告中“经新 generation_key 唯一路径新增工作项”不成立；它只验证了宽松 SQLite 列约束。它无法发现真实 API/调度器的验证、事件、并发或状态机回归。

修复门槛：迁移后以真实 `EditorialWorkflowStore` 和有效 ID 建立首发、同源重复、同源显式 rewrite、并发 enqueue、发布后无通知修订的 fixture；验证 child events/history、唯一性、CAS 前提与触发器。新增 generation_key 必须有 code-owned constructor/validator，不能由外部 SQL 拼字符串。

## P1：当前运行代码与草案 schema 不兼容

迁移草案将 `generation_key` 设为 `NOT NULL`（`migration_drill.sql`），但当前 `enqueue_if_new` 的 INSERT 没有该列（`scripts/editorial_workflow.py:562-565`），查询仍按旧 `(article_id, source_snapshot_sha256)`（:555-560）。即使 v1 store 在下一次初始化时偶然重建 trigger，新的创建任务仍因 NOT NULL 失败，并且不能建立同源 rewrite。

影响：不能先跑 schema migration 再写第二波代码；这会使恢复调度时的新任务创建失败。

修复门槛：把 schema、generation key 策略、enqueue/find、rewrite 构造、状态/通知语义和迁移作为同一可测试变更交付。用单独 schema migration version/log 记录，不依赖目前 `PRAGMA user_version=0` 或“进程能打开数据库”判断成功。

## P1：演练恢复的静态检查不覆盖行为兼容

`v1_dry_run` 仅用原生 SELECT 查询（`run_drill.py:140-165`），没有构造 `EditorialWorkflowStore`、恢复 in-flight item、执行真实 `enqueue`/transition，且未核验远端 publication/delivery receipt 的 reconcile 语义。场景 c 的“v1 兼容”只能说明部分表仍可读。

修复门槛：将 `v1 dry-run` 固化为只读 store 初始化、ready queue、历史 event/revision 读取、unknown reconciliation candidate 查询；迁移后单独做无网络的有效创建/去重/状态 transition fixture。远端不在演练中时，报告要明确“本地侧恢复演练”，不能泛称完整恢复。

## P2：无副作用证据强度被高估

演练以主 DB SHA-256 与 WAL/SHM **大小**判定 `prod_untouched`（`run_drill.py:486-490,515-520`），且没有阻止其他本地调度器在两次采样之间写入。在线备份和 `mode=ro` 是正确的，但“生产库未修改/无外部副作用”只能证明演练代码没有显式写路径，不能严格排除并发写入、同尺寸 WAL/SHM 变化或本地读打开的副作用。

修复门槛：报告改为“演练进程未执行写操作的证据”；如需强不变性证明，先维护窗口停写或记录开始/结束的 source consistent snapshot、WAL/SHM 哈希和水位，并声明比较窗口。

## P2：golden 仍是正确标识为不可签的 AI 草稿

`drafts/editorial-v2/psyche-golden-draft.md:3-4` 明确 DRAFT/未经人类签署，且 :138 要求人类决定 Robinson Crusoe 锚点在 PSY-03/PSY-04/PSY-06 的归属。字节范围脚本和报告可复现，但机器定位不能替代覆盖标准、英文转中文语义和证据归属的人类判断。

结论：不要签署当前文件为有效 golden。可签署的下一版必须由人类确认：冻结文本、每项至少一个回读锚点、Robinson Crusoe 归属或跨项复用规则、中文判定语义、签署人/时间/源哈希。该项不是实现 bug，而是尚未完成的人工 gate。

## P2：absolute-only 建议成立，但模型身份结论需精确表述

`reports/editorial-v2-v1-baseline-report.md` 对 usage/耗时/失败尝试没有持久化的结论有代码依据：`editorial_flow.py:391-396,414-421` 将完整 AgentResult 收窄为 LLMCallResult；`editorial_writer.py:22` 只保留四个 receipt 字段；HTTP 路径没有透传 usage。故 v1 不能形成可靠同源用量基线，按 EGP-1 登记 absolute-only 是正确的。

但“Claude 上游实际为 GLM”不是当前 workflow.db 的观测事实；该数据库目前没有 anthropic/glm 回执。它是外部 CLI 运行的既有证据。报告应写为“当前代码只记录配置身份；若代理重路由，无法发现”，并将实际 GLM 例子标为外部运行证据，不写成数据库统计。

## 第二波建议顺序

1. 先完成迁移/工作流垂直切片：schema version、generation_key、显式 rewrite、trigger/index/FK preservation、v1/v2 fixture 和恢复重演。
2. 随后将 G1/G3/G4/G5/G6 一起落地：完整 receipt、失败调用 append-only 事件、任务 deadline、实际身份 unknown/fail-closed、reviewer 实际身份隔离。
3. HTTP fallback 要么完成 G2，要么在自动放行路径禁用该无计量 transport；G7 用 explicit unknown，G8 为 A 阶段 policy，G9 在有可持久化计量后做预留。
4. 前端 v2 mock、Python/TS fixture 对拍可在第 1 步契约固定后并行；不能先接生产发布。

README.md 是工作区中已有的无关修改，未检查、未暂存、未纳入本审查。
