---
title: "dcgmi 命令详解：GPU 发现、健康、字段监控与诊断"
sidebar_label: "02. dcgmi 命令详解：GPU 发现、健康、字段监控与诊断"
sidebar_position: 2
description: "掌握 DCGM CLI 的对象模型、常用子命令、健康策略、字段组、诊断等级和生产排障方法。"
tags: [GPU, DCGM, dcgmi, 监控, 诊断, SRE]
---

# dcgmi 命令详解：GPU 发现、健康、字段监控与诊断

`dcgmi` 是 NVIDIA Data Center GPU Manager 的管理 CLI。它通过 Host Engine 管理 GPU、GPU Instance、Compute Instance、Switch 和字段数据，适合节点巡检与集群监控；`nvidia-smi` 更像单机 NVML 入口，两者互补。

## 1. 先确认连接模型

```bash
dcgmi --version
dcgmi --help
systemctl status nvidia-dcgm
dcgmi discovery -l
```

常见部署有两种：命令自行启动嵌入式 Host Engine，或连接已运行的 `nv-hostengine`/`nvidia-dcgm` 服务。远程连接选项和监听策略随版本变化，生产环境不要把 Host Engine 无认证暴露到非可信网络。

## 2. 对象与选择器

| 对象 | 稳定标识 | 注意事项 |
|---|---|---|
| GPU | 实体 ID、UUID、PCI Bus ID | Index 可能因启动或配置变化 |
| GPU Group | 组 ID | 健康策略和字段监控通常作用于组 |
| MIG GI/CI | GPU/Compute Instance 实体 | 不要把物理 GPU 利用率直接等同于单个 CI |
| NVSwitch | 实体 ID | 只在支持的平台出现 |

```bash
dcgmi discovery -l
dcgmi discovery -i 0 -a
dcgmi group -l
dcgmi fieldgroup -l
```

## 3. 子命令总览

```text
discovery   发现实体与属性
group       创建、修改、列出和删除 GPU 组
fieldgroup  管理字段集合
dmon        按周期查看字段值
health      设置健康监视并检查结果
diag        执行主动诊断
stats       管理作业统计
topo        查看实体拓扑与亲和性
config      查看或设置设备配置
policy      配置策略动作
profile     查看/暂停/恢复 Profiling 指标
introspect  查看 DCGM 自身资源使用
nvlink      查看互联状态和错误
modules     管理 Host Engine 模块
```

不同 DCGM 版本的子命令和参数会变化，先用 `dcgmi <subcommand> --help` 获取准确列表。

## 4. 只读巡检 `[R]`

```bash
dcgmi discovery -l
dcgmi topo --help
dcgmi topo -g 0
dcgmi nvlink --help
dcgmi health -c
```

健康检查不是一次即时传感器读取。通常应先启用观察项，等待一个覆盖业务周期的窗口，再检查结果：

```bash
dcgmi health --help
dcgmi health -s a
dcgmi health -c
```

`a` 通常表示全部可用观察项；以本机帮助为准。结果中的 Warning/Failure 要结合时间、实体、错误码、Xid、ECC 和业务日志，不要只看总状态。

## 5. 字段监控 `[R/A]`

先查字段 ID 和字段组，再选择少量字段采样：

```bash
dcgmi fieldgroup -l
dcgmi dmon --help
dcgmi dmon -i 0 -e 1001,1002 -d 1000 -c 10
```

常见参数族：`-i` 选择实体，`-g` 选择组，`-e` 指定字段 ID，`-f` 使用字段组，`-d` 设采样间隔，`-c` 设采样次数。字段含义和支持范围应从当前 DCGM Field ID 文档确认；不支持常显示 `N/A`、`Not Supported` 或空白。

Profiling 字段会占用硬件计数器，可能与 Nsight Compute 冲突。线上监控只开必要字段，并控制频率和保留周期。

## 6. 主动诊断 `[A]`

```bash
dcgmi diag --help
dcgmi diag -r 1 -i 0
```

诊断等级越高，耗时、显存、功耗和互联负载通常越大。等级名称、数字范围、插件与跳过选项随版本变化。执行前：确认目标 GPU 空闲；保存进程、温度、功耗、ECC、Xid 基线；指定 GPU 而非默认全量；设置维护窗口和超时。

一次通过只说明本次插件未发现异常。一次失败也要区分硬件故障、环境权限、驱动版本、GPU 正忙、阈值不适配和插件不支持。

## 7. 配置类操作 `[W/D]`

`config`、`policy`、组增删和某些模块操作会改变状态。先查看帮助和当前配置，记录回滚值：

```bash
dcgmi config --help
dcgmi config -g 0 --get
dcgmi policy --help
```

不要在不清楚作用域时复制 `--set`、ECC、功耗或时钟命令。配置可能要求 root、影响整张物理卡，并与 Slurm/Kubernetes 的资源管理策略冲突。

## 8. 排障闭环

| 现象 | 下一步证据 |
|---|---|
| 无法连接 Host Engine | `systemctl status nvidia-dcgm`、服务日志、Socket/端口、版本是否一致 |
| discovery 看不到 GPU | 先查 `lspci`、`lsmod`、`dmesg`、宿主机 `nvidia-smi` |
| 字段一直 N/A | GPU/驱动/DCGM 是否支持、字段实体类型是否正确、Profiling 模块是否暂停 |
| diag 立即失败 | 权限、GPU 是否被占用、插件依赖、配置文件和详细日志 |
| 健康告警反复 | 将实体 ID 映射到 UUID/Bus ID，关联 Xid、ECC、温度和业务时间线 |

## 9. 掌握标准

你应能解释 DCGM 的 Host Engine—Group—Entity—Field 模型；在不影响在线任务的前提下完成发现和健康检查；能说明主动诊断为什么必须进维护窗口；能把 DCGM 告警关联到物理 GPU、应用进程和内核日志。

## 10. 官方参考 {/* #官方参考 */}

- [DCGM command-line reference](https://docs.nvidia.com/datacenter/dcgm/latest/reference/command-line-reference/index.html)
- [dcgmi diag reference](https://docs.nvidia.com/datacenter/dcgm/latest/reference/command-line-reference/dcgmi/dcgmi-diag.html)
- [DCGM field identifiers](https://docs.nvidia.com/datacenter/dcgm/latest/dcgm-api/dcgm-api-field-ids.html)
