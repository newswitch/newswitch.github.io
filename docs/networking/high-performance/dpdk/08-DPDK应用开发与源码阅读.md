---
title: "DPDK 应用开发、初始化顺序与源码阅读"
sidebar_label: "08. 应用开发与源码阅读"
sidebar_position: 8
description: "用最小转发程序理解 rte_eal、ethdev、mempool、mbuf、lcore 与清理路径，并建立 DPDK 源码阅读方法。"
tags: [DPDK, C, EAL, ethdev, 源码分析]
---

# DPDK 应用开发、初始化顺序与源码阅读

会运行 testpmd 只能证明会使用参考应用。要定位初始化、队列、mbuf 和 PMD 问题，需要理解一个 DPDK 程序怎样从 `main()` 进入 EAL、配置 Port、启动 lcore 并退出。

## 1. 最小应用结构

```text
main
→ rte_eal_init
→ 解析应用参数
→ 创建 Mempool
→ 枚举并配置 Ethdev Port
→ Setup RX/TX Queue
→ Start Port
→ rte_eal_remote_launch 启动 Worker
→ Worker: rx_burst → process → tx_burst
→ 停止流量
→ 等待 Worker
→ Stop/Close Port
→ rte_eal_cleanup
```

初始化顺序不能随意交换。Queue Setup 需要 Port Configure 结果，Port Start 又依赖 Queue 已建立。

## 2. main 中的关键边界

示意代码只保留对象关系：

```c
int main(int argc, char **argv)
{
    int consumed = rte_eal_init(argc, argv);
    if (consumed < 0)
        rte_exit(EXIT_FAILURE, "EAL init failed\n");

    argc -= consumed;
    argv += consumed;

    struct rte_mempool *pool = rte_pktmbuf_pool_create(
        "packet_pool", 32768, 256, 0,
        RTE_MBUF_DEFAULT_BUF_SIZE, rte_socket_id());
    if (pool == NULL)
        rte_exit(EXIT_FAILURE, "mempool: %s\n", rte_strerror(rte_errno));

    /* 读取设备能力，配置 Port 和 Queue，再启动 Worker。 */
    /* 停止收包后等待在途 mbuf 回收，最后关闭 Port 和 EAL。 */
}
```

生产代码还需要信号处理、端口能力校验、NUMA、错误回滚、统计、Telemetry 和部分初始化失败时的清理。

## 3. Port 初始化应校验能力

```text
rte_eth_dev_info_get(port, &dev_info)
→ 根据 max_rx_queues/max_tx_queues 限制请求
→ desired_offloads & dev_info.*_offload_capa
→ rte_eth_dev_configure
→ rte_eth_dev_adjust_nb_rx_tx_desc
→ setup RX/TX queues
→ rte_eth_dev_start
```

`rte_eth_dev_adjust_nb_rx_tx_desc()` 可能修改 Descriptor 数量以满足硬件对齐和范围要求，应用必须使用调整后的值记录和展示。

## 4. Worker Loop 的正确性

```c
while (!force_quit) {
    uint16_t nb_rx = rte_eth_rx_burst(port, queue, pkts, BURST_SIZE);
    if (nb_rx == 0)
        continue;

    /* 解析和处理 pkts[0..nb_rx-1]。 */

    uint16_t nb_tx = rte_eth_tx_burst(port, queue, pkts, nb_rx);
    for (uint16_t i = nb_tx; i < nb_rx; i++)
        rte_pktmbuf_free(pkts[i]);
}
```

必须回答：

- 当前 lcore 使用哪个 RX/TX Queue；
- TX 未完全接受时谁释放剩余 mbuf；
- 丢包、解析失败和异常分支是否释放；
- 修改 Header 后是否更新长度、Checksum 和 Offload Flag；
- Multi-segment Packet 是否被正确解析；
- 统计是否造成共享 Cache Line 竞争。

## 5. 控制面和数据面分离

数据面循环不应做：

- 动态加载大配置；
- 同步写日志；
- DNS/HTTP/数据库调用；
- 全局锁保护的大表更新；
- 频繁内存分配；
- 长时间设备管理操作。

常见设计：控制线程构建新的只读表，通过 RCU/QSBR、指针交换或消息把版本发布给 Worker；旧版本等待 Grace Period 后回收。

## 6. 错误回滚

初始化可能在第 3 个 Port 或第 7 个 Queue 失败。可靠程序记录已成功对象并反向清理：

```text
停止 Worker
→ Stop 已启动 Port
→ Close 已配置 Port
→ 释放 Flow/Timer/Ring/Mempool（满足引用关系后）
→ 清理 EAL
```

直接 `exit()` 可能留下设备状态、HugePage 文件和主从进程资源。开发阶段可使用 Sanitizer、Debug Build 和故障注入覆盖部分失败路径。

## 7. 源码目录怎样读

| 目录 | 关注内容 |
|------|----------|
| `lib/eal/` | 启动、lcore、内存、PCI、日志、Telemetry |
| `lib/ethdev/` | 统一以太网设备 API 与公共数据结构 |
| `lib/mbuf/` | mbuf 创建、修改、引用和释放 |
| `lib/mempool/` | 对象池与 Cache |
| `lib/ring/` | 无锁 Ring 算法 |
| `drivers/net/<pmd>/` | 具体 NIC 的 Probe、Queue、RX/TX Burst |
| `app/test-pmd/` | testpmd 参数、Forward Engine 和命令 |
| `examples/` | 最小 L2/L3、Pipeline、IPsec 等用法 |

### 7.1 从 API 追到 PMD

以 `rte_eth_rx_burst()` 为例：

```text
应用调用公共 inline API
→ 读取 port 对应 rte_eth_dev
→ 调用 dev->rx_pkt_burst 函数指针
→ 进入具体 PMD 的 Vector/Scalar RX Function
→ 读取硬件 Descriptor
→ 填充并返回 mbuf
```

源码分析需要同时记录 DPDK Tag、PMD、CPU SIMD 路径、编译选项和设备型号。同一 API 在不同 NIC 上的实现可能完全不同。

## 8. 进阶库地图

| 库 | 作用 |
|----|------|
| `rte_hash` / LPM | 精确匹配与最长前缀匹配 |
| `rte_flow` | 硬件/软件 Flow 匹配与动作 |
| Eventdev | 事件调度和 Pipeline 工作分发 |
| Graph | 以 Node/Edge 组织高效 Packet Graph |
| Cryptodev | 对称/非对称加密设备抽象 |
| Compressdev | 压缩设备抽象 |
| Regexdev | 正则加速设备抽象 |
| Telemetry | 运行时查询应用与库注册的数据 |

这些库不是必须同时使用。先从数据路径瓶颈和产品需求选择，避免把所有 Framework 叠加到热路径。

## 9. 测试策略

- 单元测试：解析、查表、长度、Checksum 与错误分支；
- 虚拟设备：Ring/Null/PCAP PMD 做无硬件测试；
- testpmd/流量发生器：验证 Port、Queue 和 NIC；
- Packet Capture/Reference Model：验证转发语义；
- 性能回归：固定包长、流数、Core 和 Offload；
- Fault Injection：Link Down、TX Full、Mempool Empty、Flow Rule 失败；
- Upgrade：旧配置与新 PMD 的行为对比。

## 10. 课后练习与答案

**问题 1：`rte_eth_tx_burst()` 返回值为什么必须检查？**

它可能只接受部分 mbuf；未接受部分仍归应用所有，必须重试、排队或释放。

**问题 2：为什么读取 PMD 源码时必须记录网卡型号？**

公共 ethdev API 通过函数指针进入具体 PMD，不同 NIC、固件和 SIMD 路径的行为与限制不同。

**问题 3：为什么控制面更新不能直接持有数据面全局锁？**

繁忙 Worker 会在热路径等待锁，造成吞吐下降和尾延迟尖峰，还可能形成优先级反转。

## 11. 参考资料

- [DPDK API Documentation](https://doc.dpdk.org/api/)
- [DPDK Examples](https://doc.dpdk.org/guides/sample_app_ug/)
- [DPDK Source](https://git.dpdk.org/dpdk/)
