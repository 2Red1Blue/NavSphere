# 独立编辑稿发布

本模块需要 schema10。本文描述实现与上线前置条件，具体部署状态以对应验收记录为准；代码上线不代表已批准或发布真实稿件。写入开关 `FEED_EDITORIAL_ENABLED` 默认关闭。

## 为什么单独存储

本站整理的短稿不等于来源文章全文。`article_editorials` 只保存一份当前稿件及有限的审阅摘要；原 `articles.content`、原文全文许可、评分、来源链接与文章 ID 均不改变。阅读页单独标注“本站整理 · 独立新闻短稿”，事实、分析、局限和来源均按固定结构渲染，不执行模型生成的 HTML/Markdown。

借鉴 [Wagtail 的草稿/已发布版本分离](https://docs.wagtail.org/en/stable/topics/snippets/features.html#saving-draft-changes-of-snippets)，而不引入整套 CMS。结构化内容与渲染分离延续 BettaFish 的报告 IR 思路；逐节核对证据参考 Ragas 的 claim-level faithfulness，但校验摘要和证据编号不能证明事实、授权或独立复核。

## 私有审核流程

在父项目目录运行 `python3 scripts/publish_editorial.py --help` 查看完整参数。

1. 准备证据包和最终结构化短稿。`brief` 使用 `news_brief` 的标题、导语、事实、分析和局限结构；原生成预览和 receipt 保留，不直接改变为已批准。
2. `prepare --packet <文件> --brief <文件> --action publish --expected-state absent --expected-revision 0` 创建新的私有待审目录；已有稿件必须先显式 `inspect --article-id <16位ID>` 确认真实状态，不能套用 absent/0。
3. 人工阅读 `review-preview.md`，逐条核对文本内所有数字、日期、归因、推断、转述和权利；将 `review-template.json` 另存为完成版。任何 pending、缺失、错序、未知引用或不匹配的文本摘要都不能提交。qualified 表示限定语已经写入最终文本，不是允许以后再补。
4. 只有操作人明确批准具体版本后，运行 `approve --candidate <待审目录> --review <完成的审核文件> --reviewer <操作人标签> --confirm-candidate-sha256 <已核对摘要>`。生成全新的已声明目录，不覆盖待审或原始生成文件。AI 助手不能把自己的审阅冒充用户批准。
5. `publish --bundle <已声明目录>` 默认仅本地验证，不读凭证、不联网。只有显式附加 `--execute` 才发出一次 POST。恢复撤回稿件需要重新 prepare，action 使用 restore，绑定当前 withdrawn 状态和 revision，并完成新审批。

审批摘要覆盖全部可见字段、证据顺序与内容摘要、来源快照、渲染版本、逐节审阅记录和操作目标版本。任何修改都需要重新确认。操作人标签不是经过认证的人类身份；摘要不是数字签名或事实真实性证明。服务端权限来自既有 `CONTENT_OS_API_KEY`。

新目录 `editorial-publications/` 位于父项目，不在 publisher 自动选稿目录。目录0700、文件0600、只创建新文件；失败的部分目录保留为排障证据，不应手工拼凑为成功包。不得上传到公开 Git、Pages 静态资源或飞书。

## API 与并发规则

`/api/feed/<article_id>/editorial` 只处理一个既有16位文章ID，要求 Bearer 认证。GET 返回当前状态、revision、来源和有限摘要，不返回私有审阅文本。POST 写入还要求开关严格为字符串 `true`。

调用方使用无查询参数的规范路径。当前 next-on-pages1.13.16 / Next15.5.21 会把动态路径 ID 规范化为内部 `?id=<article_id>`；处理器只接受空查询或唯一、解码后同名同值的 `id`，并要求真实 pathname、框架 params 与该 ID 一致。额外参数、重复条目、模板路径和不一致 ID 均在处理器边界拒绝，查询参数不能选择另一篇文章。框架可能覆盖调用方的 `id`/`nxtPid` 或删除 `_rsc`，因此不能声称这里能识别并拒绝所有原始客户端查询。URL 检查不读取或重写请求体，正文中的文章 ID、审批摘要和 CAS 仍独立校验。

| 操作 | 允许的旧状态 | 新状态 |
|---|---|---|
| publish | absent/0 或 published/N | published，版本加1 |
| revoke | absent/0、published/N、withdrawn/N | withdrawn，版本加1 |
| restore | withdrawn/N，且重新审批 | published，版本加1 |

撤回不存在的稿件也会留下墓碑，阻止正在途中的首次发布。重复同秒撤回仍增加版本。所有写操作原子检查旧状态与版本；publish/restore 同时检查文章全局批准状态及来源快照。不通过普通 Feed UPSERT 修改稿件，不清除原文撤回状态。

正文快照在发布后若与当前来源不一致，公开阅读隐藏该短稿，等待重新核对。文章全局撤回隐藏整篇；短稿撤回不影响独立许可的原文读取。原文被禁止展示时，也不会用短稿权限开放原文。详情响应保持 no-store，读取冷正文后再次读取当前联合状态。

阅读页把有效的已发布短稿作为正文区域的首选内容；只有没有短稿时才展示获准公开的原文 Markdown，两者都不可用时才显示来源状态。这样不会在短稿下方继续出现“本站暂不展示完整原文”，也不会把短稿与原文拼接成一篇内容。若冷归档正文临时不可用，详情端会重新读取 D1：当前文章仍公开且短稿仍严格有效时返回短稿与 `content:null`；否则保持原来的 404/503 失败语义。短稿回退不读取、不恢复也不授权原文。

接口单请求最多48KiB、manifest最多32KiB、公开短稿记录最多24KiB，证据最多4项、正文最多1400 Unicode码点；超限拒绝而不截断。D1 不保存全部历史稿件或原始证据正文。

## 凭证、失败和恢复

显式网络操作仅从父项目 `.env` 读取 `FEED_API_URL` 和 `CONTENT_OS_API_KEY`，不创建子项目凭证文件。地址须为 HTTPS `/api/feed`；不跟随重定向、不尝试备用主机、不自动重试。响应大小与请求等待有上限，错误不输出原始响应、密钥或凭证 URL。

服务端读取请求体最多等待10秒。Python 客户端使用20秒 socket 操作超时，并在分块读取间检查总时限；这不是可强制中断 DNS 或阻塞系统调用的20秒总墙钟保证。发生超时即停止，不重复提交。

URL 字节保持原样。编辑协议额外按 UTF-16 单元限制长度，与浏览器侧上限一致；合法 Unicode 域名不一律禁止。现有 Python/浏览器 IDNA 校验仍有少数 fail-closed 差异，例如部分 A-label 在 Python 辅助函数中会被拒绝；不要为绕过校验而静默重写已批准链接。跨语言测试证明合成样例及列明的 Unicode/JSON 边界具有一致字节和摘要，不宣称穷尽所有 IDNA 输入。

旧生成预览使用 NFKC+casefold 的事实去重；编辑协议统一使用 NFKC+upper+lower。两种 Unicode 映射并不完全等价。进入编辑包仍须重新验证，不把“生成预览通过”当作编辑审批通过。

遇到409或不确定的 POST 结果，停止并运行 inspect。对照 article_id、revision、state、manifest_sha256、approval_digest 判断是否已提交。收到回执只证明条件写入提交，不等于已完成匿名阅读端验收，更不等于发送过飞书。

POST 收到400/401/413时分别报告固定的 HTTP 拒绝类别，不泄露响应正文，也不自动重试。这个类别仅说明观察到的 HTTP 拒绝，不是对所有中间代理或远程副作用的绝对证明；网络故障、5xx和无效回执仍按结果不确定处理。

撤回预演：`revoke --article-id <ID> --expected-state published --expected-revision <N> --reason <原因>`，默认不联网。显式 `--execute` 才写入，不删除文章或审核包。

## 上线门禁

- 代码回归、schema三路径、Python/TypeScript摘要一致性、类型、lint、构建和双路独立审查全部完成。
- 实际编译后的 Cloudflare Worker 必须通过本地隔离 D1 的认证、默认关闭、发布/撤回/恢复、原文权限及动态路由参数 smoke；不能只用直接调用处理器的单元测试替代。缺少产物或本地运行环境是验收失败，不跳过后上线；框架版本变更也须重新验证。
- 创建覆盖最新原文回填的私有数据库备份并验证恢复；只执行迁移010，不覆盖远程库或重复旧回填。核对 Wrangler 的迁移账本和实际表结构。
- 迁移010发现同名表时明确失败，不静默跳过建表后补账。先检查表定义、约束和现有数据，不删表或手动补账绕过；重复执行由 Wrangler 账本避免。健康/部署门禁的列名检查不是完整约束审计。
- 部署前保留当前远程变量/secret/binding；仓库 wrangler 配置不是远端配置的完整副本，不得盲目覆盖。
- 先部署读写默认关闭的版本，核验匿名详情、原文权限及旧 ID；再按明确操作决定启用写入。启用功能开关不等于批准任意稿件。
- 阅读端仅在明确缺少 `article_editorials` 表时回退旧文章查询，短稿为空，原文权限仍照常检查；其他数据库异常继续503。此兼容保护不取代迁移门禁：缺表时 health 仍不健康，必须先迁移再部署正式版本。
- 具体稿件需要独立审批与发布后匿名读取核验。没有这一步，不得声称已经发布或给用户发送消息。

当前归档策略仍未选定；本模块不创建 KV/R2、不启动归档/清理、不新增付费依赖、不写阅读计数，也不自动发飞书。

在 NavSphere 目录中，对已经按固定依赖生成的真实产物运行：

```bash
EDITORIAL_WORKER_ARTIFACT="$PWD/.vercel/output/static" \
  pnpm exec tsx --test --test-concurrency=1 tests/worker-smoke/feed-editorial-worker.test.ts
```

此测试只使用合成文章和审批 fixture，在独立临时目录运行现有 Wrangler 的本地数据库及 Worker；不部署、不读取项目凭证、不连接远程 D1。构建本身仍遵循项目构建配置，不能把本地测试的凭证隔离承诺扩大到构建过程。
