---
title: "Nginx 高可用、Keepalived、热升级、灰度与故障 Runbook"
sidebar_label: "12. 高可用、升级与 Runbook"
sidebar_position: 12
description: "从入口高可用、VRRP 与上层负载均衡，进入 Reload/热升级、连接排空、灰度发布、故障切换和演练。"
tags: [Nginx, Keepalived, VRRP, 高可用, 热升级, 灰度]
---

# Nginx 高可用、Keepalived、热升级、灰度与故障 Runbook

运行两个 Nginx 进程不等于高可用。必须同时处理入口地址、健康判断、配置和证书一致性、状态差异、容量、连接生命周期和故障域。

## 1. 高可用层次

```text
DNS / GSLB / Anycast
  → Cloud LB / Hardware LB / VIP
  → Nginx Instances
  → Upstream Services
```

每层故障检测和切换速度不同。DNS 受缓存影响，VRRP 负责同一二层域的 VIP 所有权，上层 LB 可以跨节点探测，Nginx 自身 Reload 只改变单实例进程。

## 2. Keepalived 与 VRRP

典型双机：

```text
Node A MASTER ── VIP
Node B BACKUP
```

VRRP 通告停止或优先级变化后，Backup 接管 VIP 并发送 Gratuitous ARP/Neighbor Advertisement 更新邻居。它不迁移现有 TCP/TLS 状态，故障时旧连接通常断开并由客户端重连。

Keepalived 脚本健康检查要避免：

- 只检查进程存在，不检查监听和请求；
- 检查依赖太深，短暂后端波动导致入口来回漂移；
- 脚本超时或权限问题被误判故障；
- 没有 Fall/Rise 抑制抖动；
- 两节点网络分区形成双主。

## 3. 上层 LB 模式

云/硬件 LB 常比 VRRP 更适合跨故障域：

- 多可用区与弹性扩容；
- 独立健康检查；
- 与安全组、DDoS、证书服务集成；
- 不依赖二层邻居更新。

但仍要验证 LB 到 Nginx 的协议、真实 IP、PROXY Protocol、TLS 终止点、空闲超时和健康检查来源。

## 4. 健康检查设计

分层 Endpoint：

```text
/livez   进程事件循环可响应
/readyz  配置加载完成，可承接新请求
/health  关键依赖状态（谨慎用于摘流）
```

入口探活不应因单个非关键上游失败就摘除整个 Nginx，也不能只返回静态 200 而忽略磁盘满、证书加载失败或 Worker 全部退出。

## 5. 配置与证书一致性

多实例需要明确配置来源：

```text
版本化配置/模板
→ CI 语法与安全检查
→ Canary 实例
→ 分批发布
→ 真实请求验证
→ 完成全量
```

对比 `nginx -V`、`nginx -T` 摘要、证书序列号和动态模块 Hash。相同配置在不同构建模块上可能行为不同。

## 6. Reload 与 Restart

- Reload：Master 解析新配置，启动新 Worker，旧 Worker 排空；监听通常持续；
- Restart：进程退出再启动，可能产生接受窗口和连接中断；
- Binary Upgrade：通过信号和 PID/监听继承并存新旧 Master/Worker，操作复杂，需按所用版本官方流程演练；
- 容器滚动升级：由编排系统创建新 Pod、就绪后摘除旧 Pod，仍需处理 PreStop、Termination Grace 和长连接。

## 7. 容器连接排空

```text
Pod 被标记终止
→ Endpoint/负载均衡配置传播
→ 等待新连接停止进入
→ Nginx QUIT 优雅退出
→ 等待存量请求
→ 超时后终止
```

仅执行 `sleep 5` 不是可靠排空。传播时间依赖 EndpointSlice、Controller、外部 LB 和连接复用。SSE/WebSocket 需要客户端重连和最大连接寿命策略。

## 8. 灰度发布

可基于独立域名、Header、Cookie、稳定用户 ID 或 `split_clients` 分流。要求：

- 分桶输入稳定且可信；
- 灰度与稳定版日志可区分；
- Session/Cache Key 不发生交叉污染；
- 数据库和 API 兼容新旧版本并存；
- 具备自动/人工回滚阈值。

按客户端 IP 分桶在 NAT、移动网络和 IPv6 变化下不稳定。

## 9. 热升级边界

热升级降低监听中断，不保证：

- 所有第三方模块 ABI 兼容；
- 缓存和共享状态完全继承；
- 新旧 Worker 对配置/证书解释一致；
- 长连接无感；
- 回滚永远成功。

重要变更优先通过多实例滚动和流量切换降低单机热升级复杂度。

## 10. 故障 Runbook

### 10.1 入口全失败

```text
1. 从外部解析 DNS、检查目标 IP/VIP
2. 验证 TCP/TLS/HTTP 分层
3. 检查 LB/Keepalived/VIP 所有权
4. 检查 Nginx Master/Worker 与监听
5. nginx -t / nginx -T / error_log
6. 验证磁盘、FD、CPU、内存和证书
7. 再检查 Upstream；不要先重启所有节点
```

### 10.2 单节点异常

先从 LB 摘流，保存进程、连接、日志和配置证据，再重启/回滚。直接重启会丢失最有价值的现场状态。

### 10.3 502/504 激增

按 `$upstream_addr/$upstream_status` 找出故障后端和重试序列，对比分段耗时、连接错误、DNS 和后端容量。若所有 Nginx 同时异常，更可能是共同上游或共享网络。

### 10.4 Reload 后异常

```text
确认旧配置是否仍在服务
→ 比对新旧 Worker PID 和启动时间
→ 回滚版本化配置并 Reload
→ 验证真实请求
→ 分析语法检查为何未覆盖语义问题
```

## 11. 演练矩阵

| 演练 | 应验证 |
| --- | --- |
| Kill 单个 Worker | Master 拉起、连接影响和告警 |
| 停止单台 Nginx | LB 摘流、剩余容量和客户端重试 |
| VRRP 主节点断网 | VIP 接管、ARP/ND、双主防护 |
| 错误配置 Reload | 旧配置继续服务、报警和回滚 |
| 证书轮换 | 所有实例新握手展示新序列号 |
| 后端超时 | 重试放大、504、熔断与降级 |
| 磁盘/ inode 接近满 | 日志/Temp/Cache 告警与保护 |
| Kubernetes Pod 滚动 | Endpoint 传播、排空、长连接 |

## 12. 可观测性与 SLO

- 外部可用性、DNS/TCP/TLS/TTFB 分段；
- Active/Reading/Writing/Waiting；
- 4xx/5xx、Upstream 状态和重试；
- Worker 存活、新旧代际和退出耗时；
- LB Healthy Host、VIP Master 和切换次数；
- 配置版本、证书序列号和到期时间；
- 单节点退出后的容量余量。

## 13. 练习与答案

**问题：** VRRP 切换后为什么已有下载连接中断？

VRRP 转移 VIP 所有权，不迁移两台主机的 TCP/TLS 会话状态。

**问题：** `nginx -t` 成功后为什么发布仍可能 404？

语法正确不代表 Host/Location/Rewrite/文件路径和业务路由语义正确。

**问题：** 两台 Nginx 是否足以容忍一台故障？

只有单台剩余实例能独立承载故障时峰值，且入口切换、配置、证书和上游均无共同故障时才成立。

## 14. 参考资料

- [Nginx Controlling Processes](https://nginx.org/en/docs/control.html)
- [Nginx Binary Upgrade](https://nginx.org/en/docs/control.html#upgrade)
- [Keepalived Documentation](https://www.keepalived.org/manpage.html)
