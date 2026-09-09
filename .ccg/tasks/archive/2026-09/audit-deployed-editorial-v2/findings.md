# Editorial v2 部署后审计

日期：2026-09-09。审计目标：`https://a720272b.navsphere-4se.pages.dev` 与 `https://navsphere-4se.pages.dev`。只读检查；生产没有修改。

## 审计健康度

| 维度 | 分数 | 依据 |
|---|---:|---|
| 可访问性 | 3/4 | 标题层级、目录/来源 aria、focus ring、details 原生交互均存在；小型分享/目录触点未证明达到 44px |
| 性能 | 3/4 | v2 mock 生产编译期剔除、目录用 IntersectionObserver、存储写入 rAF；详情页仍在每次 scroll setState 更新全页进度 |
| 主题与视觉 | 3/4 | Feed token、dark/reduced-motion 和不接收点击的效果层延续；赛博特效与阅读正文仍需持续检验对比度 |
| 响应式 | 3/4 | 真实 390px 页面 scrollWidth=390，无横向溢出；未覆盖文字缩放、键盘全流程和真实 v2 长文 |
| 反模式 | 3/4 | v2 阅读器结构克制、无卡片堆砌；mock 预览/正文解析器仍有运行时与契约分离 |
| **总分** | **15/20** | **Good，当前 v1 可用；v2 自动开放前需处理 P1** |

## 已独立验证

- 部署 URL 与生产 alias 的 `/api/health` 均为 200；health 返回 `database/schema=ok`、approvedArticles=538。
- 两端 `/api/feed/5c35ffca30a49a9a` 均为 200。Psyche 当前是 schema 1 / editorial-v1 / revision 1，因此 `?reader_v2=1` 正确走 v1 双读，不把 v1 数据伪装成 v2。
- `/api/feed/5c35ffca30a49a9a/editorial` 为 401；未知 Feed API id 为 404。
- 生产真实浏览器打开 `?reader_v2=1&mock_v2=explainer`：无 `【占位】`、无 v2 article、仍显示真实 v1 标题/正文；390×844 无横向溢出。生产 bundle 的 mock 门禁成立。
- 未知详情页 UI 显示“文章未找到”；但路由 HTTP 为 200，API 为 404。
- `pnpm test`：196 unit + D1 schema 验证通过；`pnpm lint` exit 0，但有 140 个既有 warning； scoped lint 使用项目 legacy ESLint 环境无新增错误。

## P1

### v2 fixture 对拍未通过 TypeScript

位置：`tests/editorial-contract-v2-fixtures.test.ts:30-33,51,66-69,106,114`。

`Manifest.fixtures` 缺 `sha256` 字段；fixture `expected` 被宽泛声明为 `Record<string, unknown>` 后直接作为 string/array 使用；可选 raw_cases 未收窄。`pnpm exec tsc --noEmit` 报 6 个错误。Next-on-Pages 产物能构建不等于 TypeScript 门禁已通过。

影响：FREEZE.md 所称 Python/TS fixture 对拍没有可信类型门禁，v2 契约不能称为冻结完成。修复类型后需重跑 Python/TS fixtures，才允许新增 v2 publication 进入自动路径。

### Reader 与权威 v2 validator 分裂，且允许未标来源正文

位置：`src/components/feed/editorial-article.tsx:91-98,169-177,186-250`；`src/lib/editorial-contract-v2.ts:126-130,319-405`；`drafts/editorial-v2/contracts/CONTRACT.md:217`。

Reader 使用 `boundedProse` 的结构子集，未执行权威 validator 的 URL/Markdown/placeholder 规则；两者以后会漂移。两端都允许 `source_ids` 数组 0..8，意味着一个 paragraph/list/quote 可无来源仍被渲染。对“可追溯文章”产品，这不能只靠未来审稿提示词保证。

影响：当前线上无 v2 文章，故不影响既有 v1；但阻断 v2 自动发布。应抽取 browser-safe 的共享 schema validator，Reader 与服务端用同一拒绝规则；或者为无来源的受审核解释块引入明确 `claim_kind`，不能让无引用默认为合规。

权威 validator 本身还在 `validateArticleStructure()` 中先对未经确认的 `sources` 调用 `.map()`，后续才调用 `validateSources()`。恶意/畸形 wire 可能产生原生 TypeError 而非稳定 `ContractViolationV2` 错误码，破坏负面 fixture 的确定性。应先校验 sources 是数组及结构，再构造 source ID 集合。

## P2

### 详情页软 404 与无意义重试

位置：`src/app/feed/[id]/page.tsx:408-414,500-513`。

未知 article 的 API 已正确 404，但客户端 route 返回 200，再显示带“重试”的错误卡。对不存在 ID 重试无意义，且 HTTP 200 不利于链接、缓存和搜索语义。建议区分 404，显示无重试的 not-found UI；后续将详情路由改为可在服务端返回真实 404。

### favicon.ico 缺失

线上 `/favicon.ico` 404，真实浏览器 console 出现资源错误；`src/app/layout.tsx` 仍引用该路径，而 public 只提供 png/webp。建议增加 favicon.ico 或改 metadata 指向存在的图标。

### 质量门禁命令不够直观

`pnpm lint` 必须通过 `ESLINT_USE_FLAT_CONFIG=false` 才能使用现有 eslintrc；直接 `pnpm exec eslint` 会失败。当前全仓 lint 有 140 warning，虽非本次 v2 引入，但 `typecheck` 未注册为 package script，易导致“test+build 成功”被误解为类型全绿。建议先加入明确的 `typecheck` 和 scoped v2 gate，flat-config 迁移另开维护任务。

## P3

- `.vercel/output.stale-20260909` 约 79MB，当前 output 约 86MB。部署命令明确指向当前 `.vercel/output/static`，旧目录不参与此次部署；保留可恢复，不应在本审计中删除。
- v2 目录与来源链接有可见 focus ring、details 使用原生键盘行为；仍应在真实 v2 长文可用后补 200% zoom、键盘顺序和屏幕阅读器回归。
- mock 门禁已有 resolver/unit 和真实浏览器证据；仍建议把生产 build artifact 中不含 `__fixtures__` / `【占位】` 的检查加入部署 gate，避免未来重构破坏 compile-time dead-branch elimination。

## 非问题/正向发现

- mock 生产门禁的旧审阅问题已被当前代码和真实浏览器证据推翻：`NODE_ENV !== production` 包住动态 fixture import 与 stub article，生产不显示占位内容。
- 内容页移动端没有横向滚动；来源外链带 `rel=noopener noreferrer` 与新标签页提示；未知 API 路由是正确 404。
- 当前线上真实文章仍为 v1，因此“v2 尚未自动开放”的状态表达是准确的；不能反过来宣称已经有真实 v2 内容质量证明。
