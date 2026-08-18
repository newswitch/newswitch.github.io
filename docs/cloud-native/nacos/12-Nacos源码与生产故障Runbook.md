---
title: "源码、注册丢失、配置不生效、选主/数据库异常 Runbook"
sidebar_label: "12. 源码、注册丢失、配置不生效、选主/数据库异常 Runbook"
sidebar_position: 12
description: "从 SDK、gRPC、Naming/Config、Distro/JRaft 到数据库定位 Nacos 生产故障。"
tags: [Nacos, 源码, Runbook]
---

# 源码、注册丢失、配置不生效、选主/数据库异常 Runbook

> 版本基线：Nacos 3.2；最后核验：2026-08-18。源码分析必须固定 Git tag，不能把主分支的类名直接套到生产旧版本。

这篇文章的目标不是背类名，而是把一个故障现象映射到“Client、协议、业务模块、一致性、持久层或应用生效层”。源码用于验证推断，不能替代日志、指标和现场状态。

## 1. 源码阅读准备 {/* #源码阅读准备 */}

```bash
git clone https://github.com/alibaba/nacos.git
cd nacos
git checkout <与生产完全一致的-tag>
```

同时保存生产的 Server/Client JAR 校验和、JDK、插件、数据库 Schema 和启动参数。先运行最小单元/E2E 测试，再改代码；不要在主分支搜索到一个类名就套到 2.x/3.x 生产环境。

## 2. 模块地图：按职责找入口 {/* #模块地图按职责找入口 */}

```text
Client SDK
  addressing / auth / connection / cache / failover / redo
        ↓ 8848 HTTP、9848 Client gRPC
Server transport & core
  request dispatch / connection manager / auth / event bus / plugins
        ↓
Naming
  instance lifecycle / subscription / push / health / Distro
Config
  publish / query / listen / dump / history / datasource
Consistency
  JRaft / member / snapshot / apply
Persistence
  datasource plugin / external DB / local runtime state
Console
  独立管理入口，经 Admin/Console API 访问 Server
```

追源码时从接口请求类型、日志码或指标名反向搜索，比从包顶层顺序阅读更高效。把 `requestId`、`connectionId`、Client IP、Namespace、Group/DataId、ServiceName、发布 MD5 和时间线贯穿 Client/Server/DB。

## 3. 跟踪一条配置发布 {/* #跟踪一条配置发布 */}

```text
Maintainer SDK/Admin API
→ 认证与权限
→ Config 发布服务
→ 外部数据库写正式/灰度与历史
→ 变更事件和节点 Dump
→ Listener 变化通知
→ Client 再查询内容、更新 Snapshot
→ 应用回调与 effective hash
```

源码验证问题：哪个对象标识配置三元组？持久化提交后由什么事件触发节点 Cache？通知为什么不直接包含完整内容？Client 收到变化后怎样查询和调用 Listener？任何一步的异常是否会重试，重试是否幂等？

## 4. 跟踪一次临时实例注册 {/* #跟踪一次临时实例注册 */}

```text
Client register runtime intent
→ gRPC connection 与 Publisher 关联
→ Naming 保存临时实例并经 Distro 分发
→ Subscriber 获得新 ServiceInfo
→ 断线清理连接状态
→ Client 重连并用 Redo 重新注册/订阅
```

持久实例走持久/CP 管理路径，不能用临时实例的 Distro/Redo 结论解释。排障前先确认 `ephemeral` 类型与 Service 类型一致。

## 5. 现场保护与通用取证 {/* #现场保护与通用取证 */}

故障发生后先暂停配置发布、批量注册、自动扩缩与节点滚动，保护剩余控制面。记录：

```bash
# 每个节点都执行，确认监听和连接，不只查 VIP
ss -lntp | grep -E ':(8848|9848|9849|7848|8080)\b'

# 受控管理网中读取 3.x 状态接口
curl -fsS http://127.0.0.1:8848/nacos/v3/admin/core/state
curl -fsS http://127.0.0.1:8848/nacos/v3/admin/core/state/readiness

# JVM 现场，按权限和生产规范执行
jcmd <PID> VM.version
jcmd <PID> VM.flags
jcmd <PID> GC.heap_info
jcmd <PID> Thread.print
```

同时保存节点/Client 日志、Prometheus 时间窗、GC/JFR、线程栈、数据库状态、LB 配置、发布历史与实际依赖树。不要先重启、清 Cache、删表或改集群身份；这些动作会抹掉最有价值的证据。

## 6. Runbook 1：服务注册“丢失” {/* #runbook-1服务注册丢失 */}

```text
业务无实例
→ 是 Nacos 权威视图没有，还是 Consumer 本地视图没有？
→ Service identity/ephemeral/cluster/enabled/healthy 是否匹配？
→ Publisher 的 9848 connection 和 redo 是否存在？
→ Server 节点之间的 Distro 视图是否一致？
→ Subscriber push、Cache、Failover、框架路由是否正确？
```

取一个 Provider 和一个 Consumer 做端到端对比。若 Server 所有节点都没有实例，查 Provider 注册请求、Auth、连接和 Redo；若部分 Server 有，查 Distro、节点负载和 9849；若 Server 正确而 Consumer 错，查 Subscription、Push、Client Cache/Failover 和 Dubbo/Spring 路由。

止血可先停止大规模扩缩、降低注册风暴、从 LB 摘除确定异常的 Server，但不能手工在数据库插入临时实例。恢复标准是 Provider 连接与实例稳定、所有 Server 视图一致、Consumer 收敛并真实调用成功。

## 7. Runbook 2：配置发布成功但应用没生效 {/* #runbook-2配置发布成功但应用没生效 */}

```text
发布历史/正式或灰度 MD5
→ 每个 Server 查询与 Dump
→ Client 9848 connection/listener
→ Client 查询 MD5、Snapshot/Failover
→ 回调结果
→ Spring Bean/运行对象/effective hash
```

先停止继续扩大灰度。按三元组和灰度规则确认发对资源，再逐层比较 MD5；如果 Client 命中本地 Failover，它可能有意覆盖 Server。回调解析失败时保留 last-known-good，修复配置后重新灰度，不要批量删 Client Cache。

恢复标准是所有目标实例 effective hash 收敛、Reload Error 清零、业务 SLO 恢复，而不只是 Console 显示新内容。

## 8. Runbook 3：无 Leader、写失败或节点反复重启 {/* #runbook-3无-leader写失败或节点反复重启 */}

```text
成员/readiness
→ 7848 JRaft 网络、Term/Leader/Apply
→ 9849 Server gRPC
→ GC pause/CPU throttle/磁盘
→ 配置与插件版本
```

冻结升级和自动重启，判断是否仍有多数派。对齐每个节点 Term、Leader、Apply/Log、启动时间和时钟，再查 7848 双向网络、证书/身份、GC 停顿、磁盘与数据目录。持续重启节点可能不断打断选举和覆盖日志，应先隔离明确异常节点、保护多数派。

不要删除 JRaft 数据、复制另一节点目录、修改集群成员表或同时重启全部节点。若已丢失可恢复多数派，按目标版本备份/恢复机制处理，不临场执行未经演练的“强制选主”。

## 9. Runbook 4：外部数据库异常 {/* #runbook-4外部数据库异常 */}

数据库主要影响 Config、历史、Auth/权限和持久资源；Client 的本地配置 Snapshot/服务 Cache 可能让已有流量暂时看似正常，这不代表控制面可继续变更。

```text
DB 连接/凭据/DNS/TLS
→ Nacos pool active/wait/timeout
→ DB 连接数、锁、慢 SQL、IO、复制/切换
→ Config 查询/发布、Dump 与权限实际结果
```

先暂停发布、导入导出和大管理查询，保护数据库与连接池。若数据库切换，确认新端点 Schema、权限、数据时间点和读写角色；逐个恢复 Nacos 节点并核对 Config MD5/历史/Auth。不要手工删表、改记录或把本地 Dump 当权威回写。

## 10. Runbook 5：Client 重连风暴 {/* #runbook-5client-重连风暴 */}

特征是 9848 连接骤降后同时回升，认证、Redo 注册/订阅、推送和数据库查询叠加，Server CPU/GC/队列和 LB Conntrack 同时升高。

止血顺序：停止非必要 Console/Admin 大查询和发布 → 保持健康节点稳定 → 按批恢复 Client/工作负载 → 检查 SDK 退避抖动 → 必要时启用已验证的流控。不要同时重启所有 Client 或 Nacos 节点。恢复后验证 Connection、Redo、实例/订阅和 effective hash，而不只看连接数。

## 11. 源码调试：用假设驱动 {/* #源码调试用假设驱动 */}

建议过程：

1. 从时间线写出一个可证伪假设，例如“LB 只转发 8848，导致 Listener 断开”。
2. 在同版本最小三节点和一个测试 Client 复现。
3. 先用日志、指标、抓包或线程栈确定边界，再设置断点。
4. 从协议请求/事件/日志码追到 Config/Naming，再追 Distro/JRaft/DB。
5. 用单元、集成、E2E 和故障测试验证修复，不只验证 Happy Path。

使用 JFR/async-profiler 时同时记录 GC、Lock、Socket、CPU 和分配；性能结果要与相同 JDK/参数的 Release 构建比较。第三方插件和 SDK 冲突先做 Maven/Gradle 依赖树与 Class Loading 取证。

## 12. 故障关闭条件 {/* #故障关闭条件 */}

一次事故只有满足以下条件才关闭：根因层已由证据确认；临时止血与永久修复已区分；所有 Server/Client/应用视图收敛；数据与权限无损；告警、Runbook 和故障实验已更新；未执行不可解释的删数据或重置身份操作。

## 13. 验收题 {/* #验收题 */}

- 注册丢失为何要同时查 SDK 和 Distro owner？
- 配置发布成功后最末端证据是什么？
- 数据库故障为何可能不立即中断已有发现？
- 如何区分 gRPC 端口与 JRaft 端口故障？
- 为什么“Console 里实例存在”不能证明 Consumer 一定会调用？
- 重连风暴时为什么批量重启 Client 会放大故障？

## 14. 参考资料 {/* #参考资料 */}

- [Nacos source](https://github.com/alibaba/nacos)
- [Nacos Monitoring Manual](https://nacos.io/en/docs/latest/manual/admin/monitor/)
- [Configuration Operations And Troubleshooting](https://nacos.io/en/docs/latest/manual/user/config/ops-and-troubleshooting/)
- [SDK Runtime Guide](https://nacos.io/en/docs/latest/manual/user/sdk/runtime-guide/)
- [Subscription, Push, And Operations](https://nacos.io/en/docs/latest/manual/user/naming/subscription-and-ops/)
