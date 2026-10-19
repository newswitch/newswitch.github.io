---
title: "DOCA 软件栈版本契约与兼容矩阵"
sidebar_label: "06. DOCA 软件栈版本契约与兼容矩阵"
sidebar_position: 6
description: "区分 DOCA Host、Arm、BSP、固件、服务镜像和 SDK 的兼容边界，用依赖图推导升级中间态。"
tags: [DOCA, BlueField, BSP, 兼容性, 软件供应链]
---

# DOCA 软件栈版本契约与兼容矩阵

DOCA 服务能否运行，不取决于一个版本号，而取决于一组组件之间的契约。容器解决部分用户态依赖，却不能把 Host 驱动、DPU 固件、Arm 内核和设备模式封装掉。

本篇以 DOCA 3.5.0 的兼容政策为基线；旧版服务部署和 DPF 26.4.0 分别保留自己的版本范围。前置阅读为[Host 与 Arm 管理边界](./01-BlueField工作模式Host与Arm管理边界.md)。

## 1. 先区分六种版本

| 层次 | 表达什么 | 典型误读 |
| --- | --- | --- |
| 硬件与模式 | BlueField 代际、SKU、DPU/NIC 模式 | 所有同品牌设备功能相同 |
| NIC 与平台固件 | 网络设备、启动链及平台管理组件 | 只更新一个包就全部生效 |
| BSP 与 Arm OS | 启动环境、内核、系统与设备支持 | 与服务容器是同一制品 |
| DOCA-Host | Host 侧驱动、运行库和安装 Profile | 任意旧 MLNX_OFED 都能替代 |
| DOCA Runtime 与 SDK | 运行库和开发接口 | 编译通过等于设备功能受支持 |
| 服务镜像与配置 | 应用架构、依赖、参数和权限 | Tag 相同就得到相同内容 |

DOCA 3.5.0 发行说明明确要求 BlueField-3 的 Host 使用 DOCA-Host，而不是 MLNX_OFED；这是一条有版本范围的产品要求，不能被泛化的“OFED 驱动都一样”覆盖。[发行说明](https://networking-docs.nvidia.com/doca/archive/3-5-0/doca-release-notes)和[支持矩阵](https://networking-docs.nvidia.com/doca/archive/3-5-0/general-support)应一起阅读。

## 2. 兼容是边的性质 不是组件的单独标签

```text
服务镜像与配置 → Arm Runtime → Arm 内核与设备
                                  ↓
Host 应用 → Host 库与驱动 ↔ NIC 固件及硬件
                                  ↑
                        BSP 与平台固件
```

每条箭头都要回答：两端是什么版本，调用什么接口，依赖哪项能力，允许沿哪个方向更新。A 与 B 兼容、B 与 C 兼容，不自动推出 A 与 C 的任意组合都受支持；更不能从单机加载成功推断跨设备协议互通。

兼容记录至少包含型号、模式、CPU 架构、OS/Kernel、Host 安装 Profile、BSP、当前固件、服务 Digest、配置修订和所用功能。一个笼统的“DOCA 版本”无法复现这组条件。

## 3. 三类兼容不能互相代替

源码兼容回答旧代码能否用新头文件重新编译；二进制兼容回答既有动态程序能否链接新库；行为兼容回答已定义行为是否保持。它们还要与驱动和固件的依赖兼容分别判断。

DOCA 3.5.0 的 SDK 政策区分 Experimental、Stable 和 Deprecated API；不能把稳定接口的承诺套到实验接口。其动态库 ABI 与源代码跨主版本兼容的规则也不同。对结构体，CTSD 会把通用接口映射到选定的库接口版本，因此头文件、编译选项和运行库都属于复现信息。[SDK 兼容政策](https://networking-docs.nvidia.com/doca/archive/3-5-0/doca-sdk-compatibility-policy)说明了这些边界。

教学反例：旧二进制仍能加载，但重新编译旧源码失败。若新主版本改变了源码接口，这两件事可以同时成立；不能据此认定 ABI 保证一定失效。另一个反例是库加载成功，但使用的新硬件功能不受旧固件支持，失败点已在另一条依赖边。

## 4. 依赖政策必须同时看层次与时间窗口

DOCA 3.5.0 的依赖政策分别定义 Level 1 与 Level 2：前者在指定 LTS 支持窗口内提供更强的双向二进制兼容，后者受年度发布周期限制。DOCA-OFED Profile 与其他 Host Profile、服务与 BF-Bundle 并不全部适用同一等级。[依赖兼容表](https://networking-docs.nvidia.com/doca/archive/3-5-0/doca-dependency-compatibility-policy)是判断依据。

因此“更新 Runtime”“更新 Host 驱动”“更新整份 BFB”需要不同审核。兼容政策允许某些解耦更新，不代表新功能一定在旧层上出现，也不保证所有现存会话都能跨激活阶段不中断。

遇到归档文档中的特殊例外和当前通用政策冲突时，应先固定目标发行分支，核对对应发行说明与已知问题，而不是拼接两个年代最宽松的条件。

## 5. 起点和终点支持 中间态仍可能不支持

用三个教学组件表示 Host H、Arm A 和固件 F。假设支持矩阵允许 `(H0,A0,F0)` 和 `(H1,A1,F1)`，但并未允许 `(H0,A1,F1)`。先更新 Arm 和固件就会经过一个未经支持的中间态。

把升级视为图上的路径：每一步不仅要有可执行动作，还要有允许的中间组合及相应隔离条件。若新 Host 能兼容旧固件，可先切到受支持的中间态；若没有这种路径，就可能需要整体维护窗口。不能为了滚动升级而发明兼容关系。

回退也要重新检查每条边。恢复旧服务容器只恢复应用层；若固件、配置格式或安全策略已经改变，未必能回到旧组合。详细过程见[升级激活与恢复](./07-BlueField升级激活重置与回退边界.md)。

## 6. 兼容验收分四层

先证明版本组合在支持范围，再证明程序加载和设备初始化，接着验证目标功能，最后比较端到端性能与隔离。库加载、Ping、规则存在和应用达标分别处于不同层。

例如新服务依赖硬件转发计数器，不能只验证 HTTP 健康接口；它可能启动成功但无法创建所需规则。反过来，硬件规则安装成功后吞吐下降，还应检查 CPU、NUMA、包长、异常路径比例和外部网络，而不把所有回归归因于版本不兼容。

## 7. 用 DPF 26.4 的实际矩阵解释支持等级

DOCA SDK 的兼容政策不能代替 DPF 的 BFB 支持表。DPF 26.4.0 的[平台支持矩阵](https://networking-docs.nvidia.com/dpf/26.4.0/platform-support)对下面的组合使用不同标记：

| BFB 分支 | DPF 25.10 | DPF 26.4 | 应如何解释 |
| --- | --- | --- | --- |
| 3.2 LTS | 完整测试与支持 | 允许旧版本运行，支持排查前要求更新到最新受支持 BFB | 允许管理旧设备不等于与当前 BFB 同等验证 |
| 3.4 | 不支持 | 完整测试与支持 | 不因数字更大就与所有旧 DPF 兼容 |
| 3.5 | 不能从这两列推导支持 | 不能从这两列推导支持 | 查其对应发行版矩阵，不用 DOCA 3.5 SDK 文档补出一条 DPF 支持关系 |

因此本系列保留 DOCA 3.5.0 的 SDK/服务机制说明，不表示它与 DPF 26.4.0 自动构成已支持组合。表中的“最新受支持 BFB”也要在目标 DPF 分支内解释，不是直接安装任何最新下载包。

[26.4.0 发行说明](https://networking-docs.nvidia.com/dpf/26.4.0/doca-platform-framework-v26-4-0)还分别列出最低预装 BFB 前提和支持的目标 BFB 分支。最低前提回答设备是否能进入供应流程；目标组合回答供应后由哪套软件管理，不能把前者读成目标版本全集。

### 7.1 产品支持与资源约束是两道门

即使 BFB/DPF 在矩阵内，服务仍可能因自己的版本约束、CPU/内存、SF 或接口依赖无法部署。DPUDeployment 的版本匹配结果只覆盖相应约束，不自动证明所有服务运行正常；见[控制对象与生命周期](./04-DPF控制对象与DPU生命周期.md)。

教学例子：DPF 26.4 允许管理一张运行 3.2 LTS BFB 的 DPU，目标服务却要求更高的 DOCA 能力。管理可达、旧 BFB 允许运行和目标服务可部署是三个不同命题。不能只看到 DPU Ready 就绕过服务约束。

### 7.2 把支持矩阵变成有条件的升级路径

将每个节点写成 `(DPF, BFB, DPU Agent, kubelet, 服务约束)`，再为每条变更边核对先决条件与影响。只记录 DPF 和 BFB 两列，仍可能漏掉供应时代不同造成的 Agent 或版本报告缺失。

例如 DPF 25.10 供应的 3.2 LTS 节点，与在 DPF 26.4 下重新供应、仍使用 3.2 LTS 的节点，BFB 名字可以相同，但管理能力并非必然相同。发行说明要求前一种情形在升级后重新供应，以补足后续版本验证依赖的信息；影响及边界见[升级与重置](./07-BlueField升级激活重置与回退边界.md)。

## 8. 掌握检查

**服务镜像相同，为什么两台 DPU 行为不同？** 比较镜像以外的硬件、模式、固件、Host/Arm 组件和配置。

**二进制兼容是否承诺旧硬件获得新功能？** 不承诺，这是接口、能力和依赖矩阵三个问题。

**可否直接从起点和终点推导滚动升级顺序？** 不可以，必须验证中间组合和激活动作。

**旧 LTS 允许运行是否等于完整测试与无条件支持？** 不等于，应保留矩阵标记的支持条件。

**设备达到最低预装条件，是否说明应把它作为最终 BFB？** 不说明，两张表回答的问题不同。

## 9. 参考资料

- [DOCA 3.5.0 兼容政策](https://networking-docs.nvidia.com/doca/archive/3-5-0/doca-compatibility-policy)
- [依赖兼容政策](https://networking-docs.nvidia.com/doca/archive/3-5-0/doca-dependency-compatibility-policy)
- [SDK 与 ABI 政策](https://networking-docs.nvidia.com/doca/archive/3-5-0/doca-sdk-compatibility-policy)
- [支持平台及组件版本](https://networking-docs.nvidia.com/doca/archive/3-5-0/general-support)
- [DPF 26.4.0 平台与 BFB 支持矩阵](https://networking-docs.nvidia.com/dpf/26.4.0/platform-support)
- [DPF 26.4.0 发行说明与升级条件](https://networking-docs.nvidia.com/dpf/26.4.0/doca-platform-framework-v26-4-0)
