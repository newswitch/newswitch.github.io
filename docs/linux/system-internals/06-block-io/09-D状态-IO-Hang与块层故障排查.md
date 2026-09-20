---
title: "D 状态、I/O Hang 与块层故障排查：从任务栈定位等待层次"
sidebar_label: "09. D 状态、I/O Hang 与块层排障"
sidebar_position: 9
description: "使用任务状态、内核栈、块层指标、设备日志和拓扑定位 IO 超时、路径故障与文件系统冻结。"
tags: [Linux, D State, IO Hang, Hung Task, 故障排查]
---

# D 状态、I/O Hang 与块层故障排查：从任务栈定位等待层次

任务处于 `D` 表示不可中断睡眠，常见于 IO 和关键内核等待，但不能直接断言“磁盘坏了”。定位要找出它在等待哪个对象、请求是否已提交、最后完成停在哪层。

## 1. 先确认影响范围

```bash
ps -eLo pid,tid,stat,wchan:32,comm | awk '$3 ~ /D/'
cat /proc/pressure/io
vmstat -w 1
iostat -x -y 1
```

- 单任务 D：可能等待单文件、锁或设备命令。
- 大量任务同一 wchan/栈：共享文件系统、块设备或冻结点。
- IO PSI full 高：所有非 idle 任务都因 IO 压力停顿的时间增加。
- load 高 CPU 空闲：D 状态可能推高 load。

## 2. 读取内核栈

```bash
cat /proc/<PID>/stack
cat /proc/<PID>/wchan
echo w > /proc/sysrq-trigger   # 仅在已授权且确认日志容量的诊断场景
```

任务栈可提示等待 Page Lock、Journal、NFS RPC、SCSI 命令、设备 mapper 或文件系统冻结。SysRq 会向内核日志输出大量阻塞任务，生产使用前必须评估权限、日志量和安全策略。

## 3. 检查设备树

```bash
lsblk -o NAME,KNAME,MAJ:MIN,TYPE,SIZE,FSTYPE,MOUNTPOINTS
dmsetup ls --tree
cat /proc/mdstat
multipath -ll 2>/dev/null
```

应用挂载在 `/dev/mapper/vg-lv` 时，真正超时可能来自其下 dm-crypt、multipath、SCSI path 或远端阵列。只看顶层 iostat 会遗漏失败路径。

## 4. 检查第一条错误

```bash
journalctl -k --since '-30 min' | grep -i -E 'timeout|reset|abort|I/O error|nvme|scsi|blk|xfs|ext4|multipath|aer'
```

典型链路：

```text
命令超时
→ 驱动重试/abort
→ controller/path reset
→ 请求积压
→ 文件系统任务 D 状态
→ hung task 告警
```

最后的 reset 可能是恢复动作；第一条 timeout、PCIe AER、链路掉线或后端告警更接近起点。

## 5. 为什么 kill -9 无效

SIGKILL 会设为 pending，但不可中断等待在返回前不处理。强制杀进程不能取消所有已提交设备命令，也不能修复文件系统/驱动锁。应恢复/隔离底层路径，或按设备和业务容灾方案切换。

## 6. 常见场景

| 场景 | 关键证据 |
|---|---|
| 本地 NVMe controller reset | NVMe timeout/reset、PCIe AER、设备健康日志 |
| SAN 路径全失效 | multipath path 状态、HBA/交换机/阵列日志 |
| NFS server 不响应 | RPC/NFS 任务栈、网络和服务端指标 |
| 文件系统冻结 | freeze 操作、备份快照流程、任务栈 |
| thin pool 满 | LVM data/metadata percent、dm 日志 |
| 回写拥塞 | Dirty/Writeback、设备延迟、flusher 栈 |

## 7. 恢复原则

1. 保护现场和业务数据。
2. 明确是否有副本/故障切换路径。
3. 不对仍在活动写入的文件系统盲目 fsck。
4. 不同时重置所有多路径。
5. 保存第一条错误、拓扑、固件和时间线。
6. 恢复后验证数据一致性，不只验证进程恢复。

## 8. 练习与答案

**问题：D 状态任务数量多、iostat 顶层设备无 IO，能否排除存储？**

答案：不能。请求可能卡在文件系统锁、NFS、Device Mapper、已消失路径或提交前资源等待；需看任务栈和完整设备树。

**问题：为什么重启可能“恢复”却没有找到根因？**

答案：重启会重置驱动、控制器、队列和连接，也会丢失易失现场。恢复可用性不等于证明原始故障位置，必须保留日志和外部设备证据。

下一模块：[Linux 网络栈导读](../07-network-stack/00-Linux网络栈导读.md)
