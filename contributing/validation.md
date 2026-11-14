# 验证与发布

## 日常检查

```bash
npm ci
npm run check
npm run build
npm run check:site
```

`npm run check` 包含统一格式、相对 Markdown 文章链接、目录与分类入口检查，以及维护脚本语法检查。`npm run check:site` 必须在本次成功构建后运行：逐层核对网站侧边栏与物理文件夹，验证正文覆盖、生成页面和本地搜索索引。

检查不会替代事实核验：外部 URL、段落锚点、硬件规格、集群行为和示例输出仍需按修改范围专项验证。`validate:docs` 不是全网链接探测器。

格式修改使用 `npm run format:docs`；调整一级导航后使用 `npm run sync:navigation`。先查看差异，不在发布任务中自动修写源码。

## 本地构建资源

全站文章较多，Windows 本机可限制构建并发：

```powershell
$env:DOCUSAURUS_SSR_CONCURRENCY='2'
$env:DOCUSAURUS_SSG_WORKER_THREAD_COUNT='2'
$env:NODE_OPTIONS='--max-old-space-size=6144'
npm run build
```

这些是当前终端的构建参数，不是网站运行依赖。不要因单次构建缓慢批量结束用户进程；只关闭本次验证创建的服务器、浏览器和子进程。

## 脚本范围

| 目录 | 用途 | 注意 |
|---|---|---|
| `scripts/checks/` | 格式、链接、专题、示例与浏览器验证 | 阅读脚本参数，区分静态检查与实际运行 |
| `scripts/generators/` | 导航元数据、机制图生成 | 生成后检查 Git 差异；机制图需要视觉复核 |
| `scripts/migrations/` | 历史一次性结构迁移 | 不加入 CI，不在当前目录直接重跑 |

文章与 Java 示例的一致性可以不启动 JVM、不下载依赖：

```bash
node scripts/checks/verify-java-examples.mjs --check-sources
node scripts/checks/verify-java-standard-library.mjs --check-sources
node scripts/checks/verify-java-concurrency.mjs --check-sources
node scripts/checks/verify-java-builds.mjs --check-sources
node scripts/checks/verify-java-runtime.mjs --check-sources
```

这些检查只证明文中的源码与仓库一致。实际编译、测试和性能验证要使用脚本要求的 JDK/Maven/Gradle 版本；不能把源码检查写成已完成集成验收。

其他专题可按修改范围运行，例如：

```bash
node scripts/checks/verify-ai-server-articles.mjs
node scripts/checks/verify-ai-storage-articles.mjs
node scripts/checks/verify-accelerator-pooling-articles.mjs
node scripts/checks/verify-elasticsearch-api-articles.mjs
node scripts/checks/validate-java-component-articles.mjs
npm run check:datax
npm run check:integration
```

更多工具链、测试范围和限制见各 `examples/` README 与 [历史验证记录](./validation-history.md)，以当前脚本与实际结果为准。不要凭历史篇数推断当前全站统计。

`check:datax` 需要 Python 3.10+，检查 14 页 MDX、56 个练习答案、任务 JSON/YAML、固定数据算术，并运行配置渲染与离线数据契约测试；不启动 DataX JVM、数据库、对象存储或 Kubernetes。可用 `node scripts/checks/verify-datax-articles.mjs --python /path/to/python` 指定解释器。

`check:integration` 检查 SeaTunnel、NiFi、Airbyte 三个产品共 21 页、84 个答案、6 张图及配置与示例一致性，运行 8 项 Node 标准库离线测试。`examples/data-integration/` 的 NiFi 配方不是 flow export，Airbyte State 是合成协议示例；检查不启动三个产品或外部服务，不能替代 JDBC/TLS、CDC、集群与恢复实测。

## 页面与搜索

生产构建生成中英文离线搜索索引，涵盖技术文档与博客的标题、章节和摘要，不是代码与正文的逐字全文检索，也不索引 `/lab` 等独立参考页。无须外部搜索账号，查询在浏览器本地进行；开发服务器不能代替生产索引测试。

发布前抽查桌面和手机：导航展开/折叠、分类入口、单篇直达、图片/图表、站内搜索和结果跳转。首次搜索要下载静态索引，CI 将导航检索索引限制在 32 MiB 以下。扩展内容时继续观察体积与检索响应，不直接恢复全正文索引。

## 发布

推送 `main` 后，GitHub Actions 依次安装、静态检查、构建、校验生成导航并部署 Pages。技术文章只维护 `docs/`，个人博客维护 `blog/`；通常不需要修改侧边栏或 CI。

提交前检查 `git diff --check` 和暂存差异。不要提交缓存、测试数据库、虚拟环境、`target/` 或 `build/`。推送成功不等于部署已成功，应另外查看对应提交的 Actions 状态。
