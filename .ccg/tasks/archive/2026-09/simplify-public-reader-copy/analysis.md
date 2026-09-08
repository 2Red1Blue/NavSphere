# 双模型分析摘要

分析会话：Codex `01a07f11-e427-74d1-bcbb-3f9a7573bf98`；Claude `8c9b320f-dc86-495a-82e4-6204f51d10a7`。

- 详情页原先已使用 `article.title`；重复标题来自 `EditorialBrief` 再次显示 `brief.headline`。
- `original_title` 才是上游文章标题。公开列表、详情、专题和日报应采用 `original_title → title → 未命名文章` 的统一顺序。
- E1、版本、材料分级和复核声明属于审核数据。公开正文只显示 lead、facts、analysis、caveats，并保留名称可读的相关来源链接。
- 隐藏元数据不能绕过 `validateEditorialPublication`、URL 安全、发布许可与撤回边界。
- 评分为零代表旧数据未评分，不应展示为可信的 0/100。
