---
title: "Ray 多机网络、端口、存储与安全"
sidebar_label: "13. Ray 多机网络、端口、存储与安全"
sidebar_position: 13
description: "设计 Ray 多节点双向通信、端口、DNS、多网卡、共享内存、Spill、模型存储和安全隔离，并建立分层验收流程。"
tags: [Ray, 网络, 端口, 存储, 安全, TLS, 多网卡]
---

# Ray 多机网络、端口、存储与安全

Ray 多节点不是“Worker 能连通 Head 的 6379 端口”就结束了。节点之间还需要双向的控制、Worker、对象传输、
Agent 和指标通信；应用又可能使用 Ray Client、Jobs API、Ray Serve、对象存储和 GPU 集合通信。

正确方法是先画出通信矩阵，再按最小范围放通和验证。

## 1. 四个网络平面

```text
访问面
Client → Jobs API / Ray Client / Serve API

控制面
Head/GCS ↔ Raylet / Agent / Autoscaler

对象与Worker数据面
Worker ↔ Worker / Object Manager ↔ Object Manager

模型高速通信面
GPU/NPU ↔ NCCL/HCCL ↔ IB/RoCE/Socket
```

前三个属于 Ray 集群和服务，第四个属于模型引擎与集合通信。Ray Task 成功跨节点不代表 NCCL/RDMA 合格；
NCCL Tests 通过也不代表 Jobs API、Runtime Env 和 Object Store 正常。

## 2. 端口不要靠记忆配置

Ray 的默认端口、随机端口和参数会随版本变化。部署前在目标版本执行：

```bash
ray start --help
python -c "import ray; print(ray.__version__)"
```

常见端口类别如下，实际值以启动参数、日志和监听结果为准：

| 节点 | 类别 | 常见参数/服务 | 暴露范围 |
| --- | --- | --- | --- |
| Head | GCS | `--port` | 仅集群节点 |
| Head | Dashboard/Jobs | `--dashboard-port` | 管理网或受控代理 |
| Head | Ray Client | `--ray-client-server-port` | 受控开发/提交入口 |
| Head | Serve | 应用监听端口 | 业务网关后方 |
| 所有节点 | Node Manager | `--node-manager-port` | 仅集群节点 |
| 所有节点 | Object Manager | `--object-manager-port` | 仅集群节点 |
| 所有节点 | Runtime Env Agent | `--runtime-env-agent-port` | 仅集群节点 |
| 所有节点 | Dashboard Agent | Agent gRPC/HTTP 参数 | 仅集群与监控 |
| 所有节点 | Metrics | `--metrics-export-port` | 监控采集网络 |
| 所有节点 | Worker Ports | `--min-worker-port`/`--max-worker-port` | 节点间双向 |

调试时可以固定端口范围以验证防火墙；生产范围过窄会限制可同时存在的 Worker 数。变更端口前计算最大 Driver、
Task Worker、Actor Worker 和并发启动需求。

## 3. 双向可达

只测试 Worker → Head 不够。每个 Node 应能使用 Ray 实际选择的地址访问其他 Node 的相关端口。

```bash
ip -br address
ip route get 10.20.0.11
getent hosts ray-worker-01
ss -lntp
```

从指定节点测试指定端口：

```bash
nc -vz 10.20.0.10 6379
nc -vz 10.20.0.10 8265
```

端口成功只说明 TCP 建连，不证明协议、版本、TLS、应用认证和后续双向连接正确。

## 4. 多网卡与地址选择

服务器可能同时拥有：

- 管理网；
- 业务服务网；
- 存储网；
- IB/RoCE 高速网；
- 容器 Bridge/Overlay；
- 云厂商元数据或 NAT 接口。

Ray 自动选错地址时，节点可能注册一个其他节点无法访问的 IP。使用 `--node-ip-address` 显式指定 Ray 节点地址，
并在所有节点验证路由。

不要仅因为某个接口带宽最高就让所有 Ray 流量走该接口。控制面、对象流量、模型集合通信和存储流量需要结合
MTU、路由、ACL、RDMA 能力和拥塞设计。

## 5. DNS、主机名与 NAT

- 主机名必须唯一；
- DNS 返回地址必须从参与节点可达；
- 正反向解析不应指向错误网络；
- 地址漂移后 Ray Node 需要按完整生命周期重新加入；
- NAT 后 Head 打印的地址可能对外部 Worker 不可达；
- 容器应使用稳定 Service DNS，不使用一次性容器 IP。

不要在 `/etc/hosts` 中复制一份长期无人维护的生产服务发现系统。若使用静态记录，应纳入配置管理和变更审计。

## 6. MTU、丢包和带宽

小包 Ping 成功不能证明大对象传输可靠。分层验证：

```bash
ping -c 20 <peer-ip>
tracepath <peer-ip>
iperf3 -c <peer-ip>
```

对实际网络还要观察：

- RTT、抖动、重传和丢包；
- 路径 MTU 和分片；
- NIC 队列、错误、Drop；
- Overlay/VXLAN 开销；
- 防火墙连接跟踪；
- 大流量是否与存储/NCCL 争用。

测试工具和参数必须获得目标环境授权，不要在生产高峰无预算压满链路。

## 7. Ray Client、Jobs API 与 Driver 位置

三种入口的故障模型不同：

| 方式 | Driver 在哪里 | 适合场景 |
| --- | --- | --- |
| Head/集群节点直接运行 | 集群内部 | 受控脚本和排障 |
| Jobs API | Head 侧运行 Job Driver | 生产提交、日志和状态管理 |
| Ray Client | 客户端与集群保持连接 | 交互开发、短时探索 |

生产批任务优先 Jobs API。Ray Client 网络中断会影响交互会话，不应把开发笔记本到 Head 的长连接当作关键业务
控制面。

访问 Dashboard/Ray Client 优先 SSH Tunnel、VPN、Kubernetes Port Forward 或带认证的受控代理。

## 8. 节点内存和 `/dev/shm`

每个 Node 都有自己的 Object Store。Linux/容器中通常使用共享内存：

```bash
df -h /dev/shm
mount | grep /dev/shm
free -h
```

需要分别规划：

- Worker Heap；
- Object Store；
- Ray 系统进程；
- Page Cache；
- Spill 目录；
- GPU HBM。

容器环境还要核对 Memory Limit、`shm_size` 或 Kubernetes `emptyDir.medium: Memory`。tmpfs 仍计入内存预算，不是
免费空间。

## 9. Spill 存储

Object Store 紧张时对象可能 Spill 到磁盘。Spill 盘要求：

- 每节点独立路径或明确隔离；
- 足够容量和 IOPS；
- 不与 OS 根盘、日志、容器层或模型缓存互相挤压；
- 指标和水位告警；
- 节点退出后允许丢失，因为它不是持久业务结果；
- 清理过程不误删活跃 Session。

共享网络盘用于 Spill 可能把内存压力转为网络和存储集群压力。必须压测 Spill/Restore，而不是只看磁盘总容量。

## 10. 模型、数据与 Checkpoint

| 数据类型 | 推荐位置 | 一致性要求 |
| --- | --- | --- |
| 应用代码 | 镜像、Wheel、Runtime Env | Revision/Hash |
| 模型权重 | 对象存储、模型仓库、共享 FS、节点缓存 | Revision/Digest、只读 |
| 输入数据 | 对象存储、数据湖、共享 FS | 分片清单与版本 |
| Ray 中间对象 | Object Store/Spill | 运行时生命周期 |
| Checkpoint | 持久对象存储或共享存储 | 原子发布、Manifest、校验 |
| 最终结果 | 业务数据库/对象存储 | 幂等和 Commit Marker |

不要使用 `/tmp`、容器层、Object Store 或本地 Spill 保存唯一模型和 Checkpoint。

## 11. 本地缓存与共享存储

共享文件系统降低分发复杂度，但模型冷启动可能造成元数据和带宽风暴。本地 NVMe 缓存提升加载速度，但需要：

- 缓存键包含模型 Revision/Digest；
- 临时下载与原子发布；
- 校验和；
- 容量水位与淘汰；
- 并发下载锁；
- 节点重建时可恢复；
- 不把缓存命中当正确性前提。

## 12. Ray 的安全模型

Ray 会执行提交给它的代码。集群内部不是面向不可信用户的安全沙箱。最低原则：

```text
可信代码
＋ 受控网络
＋ 最小身份权限
＋ 独立故障/租户边界
＋ 制品与依赖校验
```

Ray 官方安全建议强调在集群外部实施隔离。不同信任级别或需要强租户隔离的工作负载使用不同 Ray 集群。

## 13. 认证与 TLS

较新 Ray 版本提供 Token Authentication 等纵深防御能力，gRPC 通信也可以配置 TLS。它们具有版本和组件覆盖
边界，不能替代网络隔离。

启用前建立矩阵：

| 入口/链路 | 认证 | 加密 | 网络限制 | 轮换测试 |
| --- | --- | --- | --- | --- |
| Jobs API | 目标版本能力/外部代理 | TLS | 管理网 | 必须 |
| Dashboard | 外部鉴权代理 | TLS | 管理网 | 必须 |
| Ray Client | Token/受控入口 | TLS/隧道 | 开发网 | 必须 |
| 节点内部 | 目标版本机制 | gRPC TLS | 集群网 | 必须 |
| Serve API | 网关鉴权 | TLS/mTLS | 业务网 | 必须 |

证书、Token、CA 和私钥不能写入文章示例、镜像或普通 ConfigMap。轮换必须验证旧连接、重连和回滚。

## 14. 最小权限

- 独立非 root OS 用户；
- 容器禁止不必要的 Privileged、Host PID 和 Host Socket；
- Worker 只读模型和代码；
- 对象存储 Bucket/Prefix 最小授权；
- Kubernetes ServiceAccount 最小 RBAC；
- 限制云元数据服务；
- 限制 Runtime Env 出站和私有包源；
- 日志不记录 Prompt、密钥、完整凭证和敏感数据。

## 15. NetworkPolicy/防火墙思路

允许：

```text
Ray节点 ↔ Ray节点：已确认的内部端口和Worker范围
提交器 → Head：受控Jobs/Ray Client入口
监控 → Metrics：只读采集
网关 → Serve：业务端口
Worker → 模型/数据存储：指定目标和端口
```

拒绝：

- 公网直接访问 GCS、Dashboard、Jobs API、Ray Client；
- 非集群主机访问内部 Worker/Object Manager 端口；
- Worker 任意访问云元数据和管理平面；
- 不受信租户向共享 Ray 集群提交代码。

先在实验环境通过审计日志观察真实连接，再收紧策略。不要直接开放全端口作为永久修复。

## 16. 分层验收

### 16.1 主机与基础网络 {/* #主机与基础网络 */}

- IP、路由、DNS、时钟、MTU；
- 防火墙和双向 TCP；
- 磁盘、共享内存和文件描述符。

### 16.2 Ray 控制面 {/* #ray控制面 */}

- Head/GCS/Agent 状态；
- Worker 加入和心跳；
- State CLI 和 Jobs API。

### 16.3 对象与任务数据面 {/* #对象与任务数据面 */}

- 跨节点 Task；
- 大对象传输；
- Object Store 与 Spill；
- 节点退出后的重建。

### 16.4 模型高速通信面 {/* #模型高速通信面 */}

- GPU/NIC 拓扑；
- NCCL/HCCL 正确性；
- RDMA/RoCE/IB 或 Socket；
- 目标消息大小和稳定性。

### 16.5 业务面 {/* #业务面 */}

- 模型加载；
- OpenAI/业务 API；
- TTFT、TPOT、吞吐和错误率；
- 网关、限流、取消和恢复。

## 17. 常见误判

| 误判 | 正确认识 |
| --- | --- |
| Ping 通说明 Ray 一定可用 | 还需双向端口、协议、版本和节点注册地址 |
| 6379 通就够了 | Worker/Object/Agent 还有节点间端口 |
| Dashboard 能打开说明业务正常 | 只证明一个管理入口可用 |
| 共享目录路径相同就是同一数据 | 要验证挂载、内容 Revision、权限和一致性 |
| 开 TLS 就可以暴露公网 | Ray 仍要求受控网络和可信代码 |
| Spill 在共享盘就不会丢数据 | Spill 没有业务持久提交语义 |
| Ray 跨节点 Task 成功说明 NCCL 正常 | 两条数据路径和协议不同 |

## 18. 生产检查表

- [ ] 四个网络平面和通信矩阵已画出；
- [ ] 所有端口来自目标版本帮助和实际监听；
- [ ] 多网卡注册地址与路由一致；
- [ ] Dashboard/Jobs/Ray Client 不直连公网；
- [ ] Object Store、Spill、模型、Checkpoint 和结果存储边界明确；
- [ ] 身份、Secret、证书和 Token 可轮换；
- [ ] 不同信任租户使用独立集群；
- [ ] 跨节点对象与 NCCL/HCCL 分别验收；
- [ ] 防火墙、NetworkPolicy 和出站限制完成故障演练。

下一篇：[Ray 集群资源管理与自动扩缩容](./14-Ray集群资源管理与自动扩缩容.md)。

## 19. 官方资料 {/* #官方资料 */}

- [Configuring Ray：Ports](https://docs.ray.io/en/latest/configure.html#ports-configurations)
- [Ray Security](https://docs.ray.io/en/latest/ray-security/index.html)
- [Ray Client](https://docs.ray.io/en/latest/cluster/running-applications/job-submission/ray-client.html)
- [Ray Memory Management](https://docs.ray.io/en/latest/ray-core/scheduling/memory-management.html)
- [Object Spilling](https://docs.ray.io/en/latest/ray-core/objects/object-spilling.html)
