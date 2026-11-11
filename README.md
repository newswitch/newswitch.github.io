# newswitch.github.io

基于 Docusaurus 构建的 AI Infra 与云原生技术知识库。

## 本地开发

```bash
npm ci
npm run start
```

检查与生产构建：

```bash
npm run check
npm run build
npm run check:site
```

所有长篇技术文档统一维护在 `docs/` 下。目录设计、文章归档规则和新增模块方法见
[DOCUMENTATION_STRUCTURE.md](./DOCUMENTATION_STRUCTURE.md)。

本地 `docs/` 文件夹与网站分类保持对应，新增文章不需要手动添加侧边栏。一级入口共用 `src/data/domains.mjs`；修改一级技术域后运行 `npm run sync:navigation`。

`scripts/checks/` 保存验证工具，`scripts/generators/` 保存生成工具，`scripts/migrations/` 保存历史一次性迁移。示例源码在 `examples/`，维护说明在 `contributing/`，不会作为技术文章发布。

生产构建包含中英文站内搜索，检索文档与博客的标题、章节和摘要，无须外部服务账号。索引与页面一起部署；搜索验证方法与本机并发设置见 [验证与发布](./contributing/validation.md)。

## 发布

提交并推送到 `main` 后，`.github/workflows/deploy.yml` 会执行生产构建并部署到
GitHub Pages。文档访问路径统一位于：

```text
https://newswitch.github.io/docs/...
```
