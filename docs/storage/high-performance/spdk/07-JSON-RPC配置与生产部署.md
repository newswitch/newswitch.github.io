---
title: "SPDK JSON-RPC、配置固化与生产部署"
sidebar_label: "07. JSON-RPC 与生产部署"
sidebar_position: 7
description: "掌握 SPDK RPC Socket、对象依赖、配置保存与恢复、服务启动、权限、变更、升级和回滚。"
tags: [SPDK, JSON-RPC, systemd, 配置管理, 升级]
---

# SPDK JSON-RPC、配置固化与生产部署

SPDK 应用通常通过 JSON-RPC 动态创建 Transport、bdev、Subsystem、Listener 和其他对象。RPC 返回成功只说明某一步被接受，不代表完整服务已经可用；生产部署需要依赖排序、幂等、验收和回滚。

## 1. RPC 架构

```text
运维脚本 / rpc.py
→ Unix Domain Socket 或 TCP RPC Listener
→ JSON-RPC Dispatcher
→ 对应 Subsystem 方法
→ 在正确 spdk_thread 执行
→ 返回 result / error
```

Unix Socket 应是生产默认选择，因为更容易通过文件权限限制本机访问。若开放 TCP RPC，必须额外建立网络隔离、认证代理或其他保护；原生管理接口不能直接暴露公网。

## 2. 启动阶段与运行阶段 RPC

部分 RPC 只能在 Framework 初始化前调用，部分只能在运行阶段调用。使用等待初始化模式时：

```bash
sudo build/bin/nvmf_tgt \
  -m '[2-5]' \
  -r /var/tmp/spdk-nvmf.sock \
  --wait-for-rpc
```

先设置启动期选项，再开始初始化：

```bash
scripts/rpc.py -s /var/tmp/spdk-nvmf.sock framework_start_init
```

若在错误阶段调用，可能得到 Method not found、Invalid state 或模块尚未初始化。应查看当前版本 RPC 文档中的 Startup/Runtime 标记。

## 3. 对象创建顺序

NVMe-oF 示例依赖图：

```text
Framework
├─ bdev 后端
└─ nvmf Transport
     ↓
  Subsystem
     ↓
  Namespace（引用 bdev）
     ↓
  Host ACL / Listener
```

删除顺序通常反向：先停止入口和新连接，再移除 Namespace/Subystem，最后删除后端 bdev。直接删除仍被 Claim 的 bdev 会失败，这是保护而不是异常。

## 4. 不要把命令堆成不可恢复脚本

可靠脚本对每一步执行：

```text
读取当前状态
→ 比较期望状态
→ 只创建缺失对象
→ 检查 RPC result
→ 再次读取确认
→ 执行业务探针
```

重复执行 `create` 可能返回“已存在”，但不能把所有错误都忽略。名称相同、参数不同必须被识别为配置漂移。

## 5. 保存与加载配置

当前运行配置可以导出为 JSON：

```bash
scripts/rpc.py -s /var/tmp/spdk-nvmf.sock save_config \
  > /etc/spdk/nvmf.json
```

保存后校验：

```bash
jq empty /etc/spdk/nvmf.json
sha256sum /etc/spdk/nvmf.json
```

加载方式依应用和版本而定，可在启动时指定 JSON 配置，或通过 RPC `load_config` 输入。必须在隔离环境验证以下问题：

- Secret 是否被导出到明文；
- PCIe BDF 和 IP 是否会因机器变化失效；
- 废弃 RPC 参数在新版本是否拒绝；
- 创建顺序是否完整；
- 失败时是否留下部分对象。

配置文件存在不等于可恢复，必须演练“空环境启动—加载—Host 连接—读写验证”。

## 6. 服务账户与权限

生产服务账户通常只需要：

- 指定 VFIO Group；
- 指定 HugePage Mount 和 memlock；
- 指定 RPC Socket 目录；
- 日志与 Trace 目录；
- 必要的网络绑定能力；
- 明确的 CPU Affinity。

不要默认赋予 Root、全部 `/dev/vfio`、全部 Host Network 和可写源码目录。

## 7. systemd 设计要点

服务单元需要表达：

```text
After：HugePage、VFIO、Network/RDMA 和设备准备完成
ExecStartPre：只读校验 BDF、NUMA、HugePage 和配置
ExecStart：固定二进制与配置路径
ExecStop：发送 SIGTERM，允许 Drain
Restart：区分崩溃与配置错误，避免无限重启风暴
LimitMEMLOCK：覆盖 DMA/HugePage 映射需求
CPUAffinity：与 SPDK Core Mask 一致
RuntimeDirectory：安全放置 RPC Socket
```

不要在 `ExecStartPre` 中无条件执行会接管所有 NVMe 的 `setup.sh`。设备准备应按明确 allowlist 完成，并在主机变更系统中审计。

## 8. 健康检查

健康不能只看 PID：

```text
进程存活
→ RPC Socket 可访问
→ Framework State 正确
→ 期望 bdev 存在且未丢失
→ Subsystem/Listener/Host ACL 正确
→ Host 可以发现和连接
→ 测试 Namespace 完成读写/Flush
→ 延迟和错误率符合 SLO
```

读写探针不能破坏生产数据。应使用专用测试 Namespace、保留 LBA 或只读命令，并明确探针故障不会触发错误写入。

## 9. 变更与升级

升级前对照 Release、CHANGELOG 和 `deprecation.md`，特别关注：

- JSON-RPC 方法、参数和默认值；
- 公共 API/ABI；
- bdev、NVMe-oF Transport 与 Buffer Cache；
- VFIO、DPDK Submodule、RDMA Provider；
- Config 导入兼容性；
- 中断模式和性能默认值。

SPDK `YY.MM` 不同版本不应假设 API/ABI 完全兼容。补丁版本通常用于兼容性修复，但仍需做回归。

Canary 流程：

```text
固定 Host/Target 版本组合
→ 离线加载旧配置
→ 功能与错误注入
→ 相同负载性能回归
→ 多路径切换与 Drain
→ 小流量节点
→ 分批推广
```

## 10. 故障处理

| 现象 | 先查什么 |
|------|----------|
| RPC Socket 不存在 | 进程、`-r` 路径、目录权限、启动日志 |
| RPC 返回 method not found | 版本、构建模块、调用阶段、废弃方法 |
| 配置加载一半失败 | 失败对象、依赖顺序、已有资源和字段兼容性 |
| 重启后 BDF 变化 | BIOS/PCIe 枚举、热插拔、用序列号校验 |
| systemd 重启风暴 | 配置错误、设备未准备、Restart 策略和限速 |
| SIGTERM 无法退出 | 在途 I/O、Host 连接、Poller/Callback 阻塞 |

## 11. 课后练习与答案

**问题 1：为什么 `save_config` 文件不能直接视为灾备？**

它只记录可导出的运行配置，不保证 Secret、设备身份、版本兼容、数据内容和恢复流程都完整。

**问题 2：为什么健康检查不能只执行 `systemctl is-active`？**

进程存活时设备、bdev、Listener 或数据路径仍可能失效，需要验证控制面对象和端到端 I/O。

**问题 3：为什么 RPC Socket 应优先使用 Unix Socket？**

它可以用本机文件权限限制访问，减少将高权限管理面暴露到网络的风险。

## 12. 参考资料

- [SPDK JSON-RPC](https://spdk.io/doc/jsonrpc.html)
- [SPDK Application Overview](https://spdk.io/doc/app_overview.html)
- [SPDK Releases](https://spdk.io/doc/releases.html)
