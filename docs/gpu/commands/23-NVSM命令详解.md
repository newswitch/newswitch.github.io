---
title: "NVSM 命令详解"
sidebar_label: "23. NVSM 命令详解"
sidebar_position: 23
description: "在受支持平台上查询 NVSM 健康、告警和版本，解释子系统对象、健康包与有风险的管理动作。"
tags: [NVSM, DGX, 命令参考, GPU]
---

# NVSM 命令详解

`nvsm` CLI 通过平台管理服务观察整机健康和执行管理功能。先确认受支持平台、NVSM 版本和权限；命令存在不意味着所有平台功能可用。概念说明见[整机健康模型](../bare-metal-fleet/08-NVSM整机健康告警与证据关联.md)。

## 1. 查询入口

以下命令依据 NVSM 25.03 用户指南的受支持 DGX Server 功能，可能需要管理员权限；应在已安装且获授权的环境运行。该指南对 DGX Station 仅列出 `show health` 与 `dump health`，不能直接套用下面所有查询：

```bash
nvsm --help
sudo nvsm show versions
sudo nvsm show health
sudo nvsm show alerts
sudo nvsm show policy
```

帮助与版本先于业务操作。`show health` 是检查，不宜作为高频监控轮询无限执行；应阅读逐项结果、时间与被跳过的项目，不只抓取最后一行。

## 2. 对象和告警归属

交互式 CLI 可以在系统、部件和告警对象之间导航。对象路径与字段受平台和版本影响，先由当前输出发现，再查相应帮助，不猜某台机器必有同一风扇或槽位编号。

将告警目标关联到资产序列号、槽位、PCI BDF 和设备 UUID。一个链路错误可能由本端、对端或中间通道造成，告警挂在哪个对象上不等于哪个硬件必须更换。

逐层定位见[对象树与健康检查](../bare-metal-fleet/10-NVSM对象树健康检查与证据包.md)：集合级 `Status_HealthRollup`、具体 GPU 的健康属性和 incident 具有不同粒度，不能只读总状态，也不能把显示下标当成稳定硬件身份。

## 3. 采集健康包

```bash
sudo nvsm dump health
```

这会生成诊断材料，属于采集操作，不是无成本的纯字段读取。执行前确认磁盘空间、负载和采集窗口；只使用命令实际返回的路径。共享前检查主机名、地址、配置、日志和敏感信息，按支持流程传递。

不要因为压缩包成功生成就宣布问题已诊断，也不要把包上传到公开仓库或博客附件。

## 4. 安全边界

`set`、固件更新、压力测试与 Call Home 配置可能改变状态、占用资源或传出数据，不属于本篇只读检查。执行前必须明确对象、维护窗口、恢复路径和数据授权；不要从查询脚本顺手扩展为自动修复脚本。

## 5. 掌握检查

能区分检查项失败、不支持、跳过和服务不可达；能解释告警状态与真实部件状态；能从命令输出定位下一份证据，而不是机械运行所有子命令。

## 6. 参考资料

- [NVSM CLI 指南](https://docs.nvidia.com/datacenter/nvsm/nvsm-user-guide/latest/using-nvsm-cli.html)
