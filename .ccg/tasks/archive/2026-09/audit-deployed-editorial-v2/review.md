# 审阅和验证记录

## 技术核验

- 线上：部署 URL/alias health 200；Psyche detail API 200 且当前 editorial 为 v1；管理 endpoint 401；未知 API id 404；真实浏览器生产 mock 参数无占位内容；390px 无横向溢出。
- 本地：`pnpm test` 196 unit + schema pass；`pnpm lint` exit 0（140 legacy warnings）；`pnpm exec tsc --noEmit` 失败，fixture test 6 个类型错误。
- 额外：线上 favicon.ico 404；未知 detail UI 为软 404；当前 output 与可恢复 stale output 分别约 86MB/79MB。

## 持久化双路审阅

第一次 snapshot 因未跟踪 `.next-dev-gate/.next-prod-gate` 超过 5MB 而未进入 leaf。第二次使用只含源码/测试/审计记录的 109,803-byte patch：run_id `dbccd84c-a653-4e6f-a683-22bdcd8fc63f`。

- Codex leaf：REQUEST_CHANGES，确认 fixture 类型、空 source_ids、Reader/权威 validator 分裂，并新增 sources 先 map 后验证的异常路径问题。
- Claude leaf：upstream_result_error，报告为空且没有 actual model，不能算有效审阅。

因此双模型审阅未通过；本审计不声称部署质量门禁通过。未为获得批准无限重试。

## 范围

审计没有修改并行前端、根目录后端、生产数据库、部署、凭证或 `.vercel/output.stale-*`。浏览器截图移动至 `output/playwright/`，作为只读审计证据；不纳入源码提交。
