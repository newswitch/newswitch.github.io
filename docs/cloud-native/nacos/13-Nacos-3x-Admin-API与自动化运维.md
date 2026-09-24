---
title: "Nacos 3.x Admin API 与自动化运维"
sidebar_label: "13. Admin API 与自动化运维"
sidebar_position: 13
description: "区分 Client、Admin 与 Console API，掌握 Nacos 3.x 运维接口的鉴权、只读巡检、配置与实例管理、变更保护和版本迁移。"
tags: [Nacos, Admin API, OpenAPI, 自动化, 运维, Nacos 3.x]
---

# Nacos 3.x Admin API 与自动化运维

控制台上的一次点击最终也会变成请求，但这不表示所有接口都适合业务程序调用。Nacos 3.x 把客户端、运维和控制台接口分开，是为了隔离调用者、权限和稳定性边界。

> **版本基线（2026-09）**：本文以当前稳定文档的 Nacos 3.2 和 `/v3/admin/*` 为准。3.0、3.1、3.2 新增接口的起始版本不同，AI Prompt/Skill/AgentSpec 等能力主要出现在 3.2；调用前必须以目标集群的 Swagger 和版本文档核对，不能把“最新版页面”直接当成旧集群的接口清单。

## 1. 三类 API 先分清

| 类型 | 调用者 | 典型用途 | 是否适合业务运行时 |
| --- | --- | --- | --- |
| Client API / SDK | Provider、Consumer、配置客户端 | 注册、订阅、配置读取和监听 | 是，优先使用官方 SDK |
| Admin API | 运维、发布平台、审计和自动化工具 | 范围查询、批量操作、节点状态、导入导出 | 否，不应用作高频业务数据面 |
| Console API | Nacos Console | 页面查询与交互 | 否，不应把未承诺稳定的页面接口当公开集成协议 |

错误做法是抓取浏览器请求，把 Console API 固化进生产脚本。控制台升级后字段或路径变化，脚本可能无提示失效。运维自动化应使用公开 Admin API；应用注册和配置监听应使用 Client API 或 SDK。

## 2. Nacos 3.x 路径和版本边界

标准运维接口路径为：

```text
/<context-path>/v3/admin/<module>/<sub-path>
```

默认 `context-path` 是 `/nacos`，常见模块包括：

| 模块 | 路径片段 | 主要职责 |
| --- | --- | --- |
| Core | `/v3/admin/core/*` | 节点状态、连接、集群、命名空间、插件 |
| Naming | `/v3/admin/ns/*` | 服务、实例、订阅者、客户端和健康状态 |
| Config | `/v3/admin/cs/*` | 配置发布、查询、监听者、历史、导入导出 |
| AI | `/v3/admin/ai/*` | MCP、Prompt、Skill、AgentSpec 等 3.2+ 能力 |

Nacos 3.x 已移除旧的 v1/v2 Admin API。升级期间即使可以通过兼容适配器临时恢复部分路径，也不应把兼容开关当长期接口契约。

调用前记录实际版本和上下文路径：

```bash
curl -fsS 'http://nacos-server:8848/nacos/v3/admin/core/state' | jq .
```

状态接口示例：

```json
{
  "version": "3.2.0",
  "startup_mode": "cluster",
  "server_port": "8848",
  "auth_enabled": "true"
}
```

接口返回字段应以部署版本的 Swagger 和官方文档为准，不要让脚本依赖示例中未承诺稳定的字段。

## 3. 鉴权：Token 是凭据，不是普通参数

默认鉴权插件下，先使用具备相应权限的身份登录并获取 Token：

```bash
read -r -s NACOS_PASSWORD
export NACOS_PASSWORD

NACOS_TOKEN=$(
  curl -fsS -X POST 'http://nacos-server:8848/nacos/v3/auth/user/login' \
    --data-urlencode 'username=nacos' \
    --data-urlencode "password=${NACOS_PASSWORD}" \
  | jq -er '.data.accessToken // .accessToken'
)
```

访问需要权限的接口时携带 Token：

```bash
curl -fsS \
  -H "accessToken: ${NACOS_TOKEN}" \
  'http://nacos-server:8848/nacos/v3/admin/core/loader/current' \
  | jq .
```

生产脚本还应做到：

- 从 Secret 管理系统注入密码或短期凭据，不写入 Git、命令历史和日志；
- 不使用 `curl -v` 把请求头中的 Token 打进流水线日志；
- 区分管理员权限与 namespace 读写权限；
- 给请求设置连接和总超时；
- Token 失效时只重新认证有限次数，不能无限重试；
- OIDC/OAuth2 场景按对应插件流程取凭据，不能假设登录接口相同。

关闭 `nacos.core.auth.admin.enabled` 会扩大管理面风险，不能作为解决 401/403 的常规办法。

## 4. 先建立只读巡检链路

自动化接入时先只读，再逐步开放写操作。推荐把巡检分成五层。

### 4.1 进程存活

```bash
curl -fsS 'http://nacos-server:8848/nacos/v3/admin/core/state/liveness' | jq .
```

成功返回只表示进程可以响应请求，不等于数据可读、集群一致或客户端已收到推送。

### 4.2 数据可读

```bash
curl -fsS 'http://nacos-server:8848/nacos/v3/admin/core/state/readiness' | jq .
```

`liveness=ok` 而 `readiness` 失败时，不应继续发送写流量；应检查数据库、Raft、节点状态和依赖连接。

### 4.3 Server 状态

```bash
curl -fsS 'http://nacos-server:8848/nacos/v3/admin/core/state' | jq .
```

重点记录版本、运行模式、鉴权状态和端口。多节点巡检必须逐节点执行，不能只访问 VIP，否则只能证明负载均衡器选中的某一个节点可用。

### 4.4 客户端连接

```bash
curl -fsS \
  -H "accessToken: ${NACOS_TOKEN}" \
  'http://nacos-0.nacos-headless:8848/nacos/v3/admin/core/loader/current' \
  | jq '.data | length'
```

该接口查看当前 Server 节点承载的 gRPC 连接。连接数突然集中到一个节点时，应检查 VIP、连接均衡、其他节点 9848 可达性和客户端重连风暴。

### 4.5 业务末端

最后必须从实际客户端或探针验证：

- 能否查询目标服务并得到健康实例；
- 能否读取目标 `DataId`；
- 修改测试配置后监听者能否收到新 MD5；
- 客户端本地缓存是否仍在提供旧值。

Admin API 正常只是控制面证据之一，不等于业务端到端成功。

## 5. Naming API：查清服务、实例和客户端

查询指定服务的实例：

```bash
curl -fsS -G \
  -H "accessToken: ${NACOS_TOKEN}" \
  'http://nacos-server:8848/nacos/v3/admin/ns/instance/list' \
  --data-urlencode 'namespaceId=public' \
  --data-urlencode 'groupName=DEFAULT_GROUP' \
  --data-urlencode 'serviceName=order-service' \
  --data-urlencode 'healthyOnly=false' \
  | jq .
```

排障时不要只数实例总数，还要比较：

```text
registered：Server 中是否存在
healthy：健康检查是否通过
enabled：是否允许参与发现
weight：是否被调成 0 或异常值
clusterName：Consumer 是否只订阅了其他 Cluster
ephemeral：临时/持久实例的故障语义不同
metadata：路由、版本和机房标签是否匹配
```

实例写操作的风险高于表面：错误地注册一个健康实例，会把真实流量导向不存在的服务；错误更新 weight 或 enabled 会直接改变负载分布。因此写接口应采用“读取当前值—计算差异—人工/策略审批—写入—再次读取—业务探测”的闭环。

## 6. Config API：配置内容之外还要看监听者和历史

一条配置由 namespace、groupName 和 dataId 共同定位。只检查 dataId 很容易读错环境。

查询监听者：

```bash
curl -fsS -G \
  -H "accessToken: ${NACOS_TOKEN}" \
  'http://nacos-server:8848/nacos/v3/admin/cs/config/listener' \
  --data-urlencode 'namespaceId=prod' \
  --data-urlencode 'groupName=ORDER' \
  --data-urlencode 'dataId=order-service.yaml' \
  --data-urlencode 'aggregation=true' \
  | jq .
```

返回的监听者状态可用于回答：哪些客户端正在监听、它们报告的内容 MD5 是否一致、问题是否只发生在一个 Server 节点。

导出配置用于迁移或备份辅助：

```bash
curl -fsS -G \
  -H "accessToken: ${NACOS_TOKEN}" \
  'http://nacos-server:8848/nacos/v3/admin/cs/config/export' \
  --data-urlencode 'namespaceId=prod' \
  --data-urlencode 'groupName=ORDER' \
  --output nacos-config-export.zip

sha256sum nacos-config-export.zip
unzip -t nacos-config-export.zip
```

导出成功不等于灾备完成。还要在隔离环境验证导入、元数据、加密配置、权限和客户端读取。外部数据库的备份与配置导出解决的恢复范围也不同。

### 6.1 发布配置的安全模式

发布前至少保存：

```text
namespaceId / groupName / dataId
旧内容或旧 MD5
新内容 SHA-256
操作人、工单、时间
目标集群和 Nacos 版本
验证请求和回滚条件
```

写操作不能只根据 HTTP 200 判断成功，还要检查统一返回体中的业务 `code` 和 `data`，随后读取配置、查询监听者并验证应用端实际值。

## 7. 通用自动化客户端应具备什么

一个可靠的 Nacos API 工具至少包含：

```text
配置解析
→ 登录与 Token 缓存
→ URL/context-path 规范化
→ connect/read/total timeout
→ 状态码与业务 code 双重检查
→ 只对安全请求有限重试
→ 分页直到结束
→ 输出稳定 JSON
→ 写操作生成审计记录
→ 变更后读取验证
```

重试规则要按语义区分：

| 请求 | 是否可自动重试 | 条件 |
| --- | --- | --- |
| GET 查询 | 可以 | 有次数、退避和超时 |
| 导出 | 谨慎 | 确认服务端不会创建重复任务 |
| 发布配置 | 不能盲重试 | 先查询是否已写入目标 MD5 |
| 创建/删除服务实例 | 不能盲重试 | 根据资源键和期望状态确认幂等性 |
| 批量删除 | 默认不自动重试 | 必须记录目标清单并二次确认 |

不要把所有 `5xx` 都当瞬时网络错误。Nacos Server、数据库或共识层异常时，持续重试可能进一步放大连接和写压力。

## 8. 从 2.x 迁移到 3.x

迁移前建立 API Inventory：

```bash
rg -n '/nacos/(v1|v2)/' scripts/ pipelines/ dashboards/
rg -n '8848|9848|9849|7848' deploy/ charts/ terraform/
```

逐项分类：

1. 业务注册/订阅：迁移 SDK 或 Client API；
2. 运维脚本：迁移 `/v3/admin/*`；
3. 自定义控制台：评估 Console API，不与 Admin API 混用；
4. 健康检查：改用 liveness/readiness 并验证返回语义；
5. 网络策略：8848、9848、9849、7848 和独立 Console 端口按调用者放行；
6. 鉴权：验证 Token 获取、权限和审计，而不是关闭鉴权。

兼容适配器只适合作为短期过渡。退出条件应是旧路径调用量归零，而不是“新集群已经启动”。

## 9. 常见错误与证据链

| 现象 | 优先检查 | 不应先做 |
| --- | --- | --- |
| 401/403 | Token、权限、鉴权插件、时钟和接口类型 | 关闭 Admin API 鉴权 |
| 404 | 版本、context-path、v1/v2 旧路径、反向代理 rewrite | 反复重启 Server |
| 单节点连接数异常高 | 各节点 loader、9848、VIP 和客户端重连 | 手工踢掉全部连接 |
| 配置发布成功但应用未生效 | namespace/group/dataId、监听者 MD5、客户端缓存 | 重复发布相同内容 |
| 服务列表有实例但请求失败 | healthy/enabled/weight/cluster/metadata、业务端口 | 只看控制台绿色状态 |
| 批量脚本部分成功 | 每项返回、分页、审计清单和幂等键 | 无条件从头重跑 |

## 10. 练习与答案

**问题 1：为什么业务应用不应每秒调用 Admin API 查询配置？**

Admin API 面向范围管理和运维，权限更大、返回更重，也不提供客户端 SDK 的监听、本地缓存和容灾语义。业务运行时应使用 SDK/Client API。

**问题 2：liveness 正常、readiness 失败说明什么？**

进程能够响应，但当前不具备可靠读能力。应检查数据源、共识状态和依赖，而不是继续把它当健康节点承载管理流量。

**问题 3：为什么导出的 ZIP 文件存在仍不能证明可恢复？**

文件可能损坏、范围不全、缺少权限和加密相关信息，也可能无法导入目标版本。必须校验文件并在隔离环境完成导入和客户端读取验证。

**问题 4：发布请求超时后为什么不能直接重试？**

超时只表示客户端没收到结果，服务端可能已经提交成功。先按 namespace/group/dataId 查询内容或 MD5，再决定是否补偿，避免重复副作用和审计混乱。

## 11. 参考资料

- [Nacos 3.x 运维 API](https://nacos.io/docs/latest/manual/admin/admin-api/)
- [Nacos OpenAPI 概览](https://nacos.io/docs/latest/manual/user/open-api/)
- [Nacos 权限校验](https://nacos.io/docs/latest/manual/admin/auth/)
- [Nacos 系统参数](https://nacos.io/docs/latest/manual/admin/system-configurations/)
