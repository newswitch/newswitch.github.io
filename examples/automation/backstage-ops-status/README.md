# Backstage ops-status 插件核心文件

对应 `docs/automation/backstage/07-插件架构与集成开发.md`。以 Backstage `v1.56.5` 的新 Backend/Frontend System 为 API 基线。这不是完整独立应用，不能在博客根目录运行 `yarn start` 来启动 Backstage。

在已按该 release 对齐依赖和 lockfile 的隔离 Backstage workspace 中生成三个包，再合并这些文件：

| 本目录 | 目标文件夹 | 包名及 role |
| --- | --- | --- |
| `common/*` | `plugins/ops-status-common/src/` | `@internal/plugin-ops-status-common`，common-library |
| `backend/*` | `plugins/ops-status-backend/src/` | `@internal/plugin-ops-status-backend`，backend-plugin |
| `frontend/*` | `plugins/ops-status/src/` | `@internal/plugin-ops-status`，frontend-plugin |
| `policy/CustomPolicy.ts` | 生成的 permission-policy-module 的 policy 目录 | 隔离示例策略；宿主模块需注入 `coreServices.userInfo` |

保留脚手架生成的 package.json、tsconfig、CLI/Jest 设置。common 的 index 导出 permissions；backend 的 index 将 `opsStatusPlugin` 导出为 default；frontend 的 index 将 plugin 的 default 再导出。前端 `../package.json` 指目标插件包的真实 manifest，不是这个示例目录里的文件。

后端包依赖 backend-plugin-api、errors、permission-common、express-promise-router 和 common 包；测试还需 backend-defaults、backend-test-utils、express、supertest 及相应类型。前端依赖 React、frontend-plugin-api 和 common 包；common 依赖 permission-common。策略模块还需 permission-node 和 common 包。按基线 workspace 解析依赖，不把所有 Backstage 包都强制设成 1.56.5。

在宿主 backend 注册 `backend.add(import('@internal/plugin-ops-status-backend'))`；启用宿主 Permission Framework，并在当前策略中显式处理 `ops-status.read`，未知 permission 不应默认放行。示例策略仅允许身份解析得到 `group:default/ops-readers` 的用户读取该插件，拒绝其他 permission；不可直接替换已有生产策略而意外关闭其他插件。移除 allow-all 模块后，只注册一个实际策略。frontend 使用新系统的 features 安装或 feature discovery，不混用旧 FlatRoutes 注册。

`model.ts` 只返回合成 fixture，明确标有 `source: fixture`，不表示已读取 Kubernetes，也不代表当前健康状态。`parseSnapshot` 验证这份窄 DTO 的运行时结构；真实集成需要扩展合约和错误分类。权限是插件级基础读权限，不提供按 Entity/租户的资源隔离；正式集成必须额外实现资源权限、配置映射和外部身份。

在完成目标 workspace 的依赖/入口接入后运行其 typecheck、build、lint，以及：

```bash
yarn workspace @internal/plugin-ops-status-backend test --watchAll=false
```

`router.test.ts` 的 6 个 Jest/Supertest 测试只验证注入认证/授权 mock 时的路由行为；不能代替真实令牌校验、宿主策略或匿名用户的集成测试。博客专项检查只验证 TS/TSX 可转换、代码与正文一致，以及模型的离线数据契约，不安装或运行完整 Backstage。
