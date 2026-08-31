# 提交前审查

## 结果

- Codex：`COMMIT_PUSH_OK=yes`，无 Critical。
- Claude：`COMMIT_PUSH_OK=yes`，无 Critical。
- 精确凭证扫描通过；工作区根 `.env` 未进入仓库。
- 修复 Feed UPSERT 清空既有正文的问题，并增加回归测试。
- D1 迁移与 Pages 部署解耦，避免未核对迁移账本时自动修改远端数据库。
- Extension 部分更新保留既有分类与条目，缺失资源返回 404。

## 验证

- 13 项单元测试通过。
- D1 snapshot、migration-only、legacy upgrade 三条路径通过。
- TypeScript、ESLint、`git diff --check` 通过。
- 生产依赖审计：0 个已知漏洞。

## 提交

- `4350516 fix: harden auth publishing and deployment`

## 遗留操作

- 历史提交曾包含旧 Feed API key；本次提交移除了工作树中的值，但无法清除历史或替代凭证轮换。
- 部署前必须核对远端 D1 迁移账本并先配置 Cloudflare 变量/Secrets。
