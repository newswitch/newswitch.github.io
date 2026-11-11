# 文档目录与维护入口

`docs/` 是网站技术文档目录的唯一来源：本地文件夹对应网站分类，文章文件对应页面。二级及以下侧边栏自动生成，不维护另一份文章清单。

- [目录结构与归档规则](./contributing/structure.md)：技术域、文件命名、分类入口、跨模块引用。
- [验证与发布](./contributing/validation.md)：格式、链接、目录、生产构建与示例检查。
- [迁移记录](./contributing/migrations/README.md)：历史脚本及本次搬迁清单。
- [历史专题验证记录](./contributing/validation-history.md)：过去各批文章的验证范围与限制。

技术域名称、排序与入口统一维护在 `src/data/domains.mjs`，首页、文档导读和一级侧边栏共用。修改后执行 `npm run sync:navigation` 同步分类元数据，再执行 `npm run check`。

维护说明保留在仓库，不发布为技术文章。新增正文仍只需要维护对应 `docs/` 文件夹和 Markdown 文件，发布流程见 [README](./README.md)。
