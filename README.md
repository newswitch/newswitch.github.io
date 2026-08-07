# newswitch.github.io

基于 Docusaurus 构建的 AI Infra 与云原生技术知识库。

## 本地开发

```bash
npm ci
npm run start
```

生产构建：

```bash
npm run build
```

所有长篇技术文档统一维护在 `docs/` 下。目录设计、文章归档规则和新增模块方法见
[DOCUMENTATION_STRUCTURE.md](./DOCUMENTATION_STRUCTURE.md)。

## 发布

提交并推送到 `main` 后，`.github/workflows/deploy.yml` 会执行生产构建并部署到
GitHub Pages。文档访问路径统一位于：

```text
https://newswitch.github.io/docs/...
```
