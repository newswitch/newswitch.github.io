---
title: nvme 命令详解：Controller、Namespace、日志、固件与 NVMe-oF
sidebar_position: 12
description: 以 nvme-cli 2.16 稳定版为基线，讲解 nvme 子命令架构、设备拓扑、Identify、SMART/error log、format/sanitize/firmware 风险、reservation 和 NVMe-oF。
tags: [Linux, nvme-cli, NVMe, SSD, NVMe-oF]
---

# `nvme` 命令详解：Controller、Namespace、日志、固件与 NVMe-oF

`nvme` 是 nvme-cli 的多子命令入口，直接通过 NVMe admin/I/O command、sysfs 和 fabrics 配置管理 Controller、Namespace 与 Subsystem。它既有安全查询，也有会立即破坏数据的 format/sanitize/ns-delete。

## 1. 对象与版本

```text
NVMe Subsystem
  ├─ Controller /dev/nvme0
  └─ Namespace  /dev/nvme0n1
```

```bash
nvme version
nvme help
nvme list
nvme list-subsys
```

本文以稳定 nvme-cli 2.16 为基线；3.x 正在重构并整合 libnvme，输出/插件可能变化。每个子命令都有独立帮助：`nvme help smart-log`。

## 2. 全局和发现查询

```bash
nvme list -o json
nvme list-subsys -o json
nvme id-ctrl /dev/nvme0 -o json
nvme id-ns /dev/nvme0n1 -o json
nvme ns-descs /dev/nvme0n1
```

通用输出参数常见 `-o normal|json|binary`、`-v` verbose、`--output-format-version`；具体取决于子命令。重要身份字段：SN/MN/FR、NQN、CNTLID、Namespace ID、LBA format、metadata、capacity/utilization。

## 3. 健康与错误日志

```bash
nvme smart-log /dev/nvme0 -o json
nvme error-log /dev/nvme0 --log-entries=64 -o json
nvme fw-log /dev/nvme0
nvme effects-log /dev/nvme0
nvme persistent-event-log /dev/nvme0 --action=read
```

重点字段：critical_warning、temperature、available_spare、percentage_used、data_units、host commands、controller_busy_time、power_cycles/hours、unsafe_shutdowns、media_errors、num_err_log_entries。

Error Log Entries 是累计数，非零不等于当前仍故障；需要看最近 error entry、kernel log、重置和业务 I/O 时间。

## 4. 常用管理子命令分类

| 类别 | 子命令示例 | 风险 |
|---|---|---|
| 查询 | `list`, `list-subsys`, `id-ctrl`, `id-ns`, `smart-log`, `error-log` | `[R]` |
| feature | `get-feature`, `set-feature` | set 可能影响功耗/队列/可用性 |
| Namespace | `create-ns`, `delete-ns`, `attach-ns`, `detach-ns` | `[D]`，改变设备集合和数据 |
| format/sanitize | `format`, `sanitize`, `sanitize-log` | `[D]`，可能不可恢复 |
| firmware | `fw-download`, `fw-commit`, `fw-log` | 可能 reset/offline/变砖 |
| reservation | `resv-register/acquire/release/report` | 影响集群写入所有权 |
| controller | `reset`, `subsystem-reset`, `device-self-test` | 中断 I/O |
| I/O passthrough | `read`, `write`, `compare`, `admin-passthru`, `io-passthru` | write/passthru 极高风险 |
| Fabrics | `discover`, `connect`, `connect-all`, `disconnect`, `disconnect-all` | 改变远端 block path |
| plugins | `nvme <vendor> ...` | 厂商特有语义 |

## 5. format 与 sanitize 边界

```bash
nvme id-ns /dev/nvme0n1 -H
nvme effects-log /dev/nvme0
```

`nvme format` 可修改 LBA format/metadata/protection 并触发 secure erase；作用范围可能是 namespace 或整个 controller。`sanitize` 是后台不可轻易取消的数据清除过程。不要提供“通用执行命令”在生产复制，必须按设备手册、支持位、multipath/RAID/LVM/文件系统关系和数据销毁审批生成变更单。

## 6. 固件更新

流程：确认型号/当前 FR → 查厂商 release note/兼容矩阵 → 冗余和备份 → 下载 → commit action 能否在线激活 → 维护窗口 → reset/reboot → 核对 FR/health/error。firmware 文件必须来自厂商可信渠道并校验完整性。

## 7. NVMe-oF

```bash
nvme discover -t tcp -a 192.0.2.10 -s 8009
nvme list-subsys
cat /etc/nvme/hostnqn
cat /etc/nvme/hostid
```

`connect/connect-all` 需配置 transport、traddr、trsvcid、subsysnqn、hostnqn/hostid，可能还涉及 TLS/DH-HMAC-CHAP。重复 host identity、路由/MTU、path loss timeout 和 multipath policy 都会影响稳定性。disconnect 前先确认挂载、LVM、MD、数据库和 Kubernetes volume 引用。

## 8. 证据链

```bash
nvme list -o json
nvme list-subsys -o json
nvme smart-log /dev/nvme0 -o json
nvme error-log /dev/nvme0 --log-entries=64 -o json
journalctl -k --since '-30 min' | grep -i nvme
iostat -x -d -y 1 10
```

完成标准：能区分 controller/namespace/subsystem，能解释 SMART 与 error log 的趋势，并把 format/sanitize/firmware/reset/reservation 明确标为变更或数据破坏操作。

参考：[nvme-cli 官方项目与文档](https://github.com/linux-nvme/nvme-cli)。
