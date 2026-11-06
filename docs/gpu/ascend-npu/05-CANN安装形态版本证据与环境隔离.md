---
title: "CANN 安装形态与环境隔离"
sidebar_label: "05. CANN 安装形态与环境隔离"
sidebar_position: 5
description: "以 CANN 9.1 安装文档为参考，解释 Toolkit、ops、NNAL、新旧路径、进程环境和动态库证据，区分软件安装、环境生效与设备功能验证。"
tags: [CANN, Toolkit, ops, NNAL, 环境变量, 动态链接, 容器]
---

# CANN 安装形态与环境隔离

一台机器安装过 CANN，不表示每个用户、systemd 服务和容器都在使用它。安装文件、环境变量、动态库装载和设备访问分别由不同机制决定，排障必须回到**出问题的那个进程**。

本文以 CANN 9.1 的快速安装说明为版本基线，讲解安装结构和证据方法；命令中的路径是明确标注的示例，不是所有版本和安装方式的固定目录。Driver/Firmware 变更涉及整机维护，不在业务容器里试装。

## 1. 先区分底层使能与用户态计算环境

| 安装对象 | 常见归属 | 更新影响 |
| --- | --- | --- |
| Driver / Firmware | 宿主机或受支持虚拟化方案的对应层 | 可能影响整机所有设备任务，并要求维护或重启 |
| Toolkit 与相关运行组件 | 宿主、独立环境或镜像，按部署方式确定 | 影响使用相应路径的进程 |
| 目标硬件的 ops 算子包 | 与相应 Toolkit/部署环境配套 | 影响所需算子的可用性与实现 |
| NNAL 等额外加速组件 | 按框架与引擎需求配置 | 不是有无 NPU 的唯一条件 |
| PyTorch / torch-npu / 引擎 | Python 环境与镜像 | 还受 Python ABI、CPU 架构和扩展构建影响 |

虚拟环境主要隔离 Python 等依赖，不会替容器创建一个独立的宿主内核驱动。Conda 可以安装某些 CANN 用户态软件，也不等于它能替代 NPU Driver。

## 2. 旧包名与新包名不能机械对应

CANN 8.0 文档常见 Toolkit、NNAE、NNRT 以及 Kernels 等名称；CANN 9.1 快速安装说明则按 Driver、Toolkit 与目标产品的 ops 包组织步骤。旧教程里的“推理装 NNRT”不能脱离版本直接套到新包体系。

| 阅读旧资料时看到 | 应先确认 |
| --- | --- |
| Toolkit / NNAE / NNRT 三类选择 | 目标版本实际发布哪些组合包 |
| `kernels-910b` 一类安装文件 | 当前目标硬件的 ops 包名称与配套要求 |
| `ascend-toolkit/latest` | 当前路径是否为兼容链接，实际目标在哪 |
| 独立 NNAL/ATB 环境脚本 | 引擎是否要求它，以及与 Toolkit 的配套关系 |

这是包体系演进，不应推导为“旧文件看到就可以删除”或“把目录改名便能升级”。已有进程可能仍引用旧文件；回退也可能有独立约束。

历史与新基线分别见 [CANN 8.0 软件准备](https://www.hiascend.com/doc_center/source/en/canncommercial/800/softwareinst/instg/instg_0003.html)、[CANN 9.1 快速安装 FAQ](https://www.hiascend.com/doc_center/source/zh/CANNCommunityEdition/910/softwareinst/instg/instg_0050.html)。

## 3. 安装方式改变了什么

CANN 9.1 快速安装提供在线包管理、Conda 与离线方式，支持范围要按产品、CPU 架构和 OS 筛选。不能因为支持 Yum 就推断任意 RPM 系统都能使用同一仓库，也不能把 ARM 包装进 x86_64 镜像。

| 方式 | 优点 | 需要额外记录 |
| --- | --- | --- |
| 系统包管理 | 包依赖、清单与系统管理集成 | 仓库、精确包版本和依赖变动 |
| 独立环境安装 | 用户态依赖可以更明确地归组 | 环境前缀、共享库路径与实际硬件包 |
| 离线包 | 便于受限网络和固定制品分发 | 校验值、完整包集合、架构和安装选项 |
| 已构建镜像 | 固定用户态交付物 | Digest、构建信息、Host 注入与完整兼容矩阵 |

尤其注意：该版快速安装中的离线合一包默认涉及 Driver 与 Toolkit，文档提供选择安装对象的方式。它不能被当作“只更新容器里一个普通软件包”的无影响操作。

这里不执行安装、升级或卸载。实际部署先生成目标硬件和 OS 对应的官方安装方案，再在维护范围内实施。

## 4. set_env.sh 具体做了什么

环境脚本主要为当前 Shell 设置路径与其他变量，使后续进程找到组件。它不更新内核驱动，不自动注入设备，也不能把一个不支持的算子变成支持。

假设目标安装文档确认所用目录是 `/usr/local/Ascend/cann`，并且已经核验脚本来源，可以在**新开的专用 Shell** 中运行：

```bash
source /usr/local/Ascend/cann/set_env.sh
```

`source` 会执行脚本，不属于只读查询。它影响当前 Shell 与随后创建的子进程；已经运行的服务不会自动继承。不要在一个长期调试 Shell 中连续 source 多套版本，叠加的 PATH、库路径和 Python 路径很容易混合。

对于旧版安装，脚本可能在 `ascend-toolkit/set_env.sh`；非 root 或 Conda 安装也可能处于环境专属目录。选择路径应依据包记录和实际文件，而不是把网络上的 export 全部追加到 `.bashrc`。

## 5. 四种生效范围

| 场景 | 环境由谁提供 | 常见误判 |
| --- | --- | --- |
| 交互终端 | 启动 Shell、profile 与手动 source | 当前终端成功，所以所有服务都成功 |
| systemd | 单元、受控启动脚本及配置 | 默认一定读取用户 `.bashrc` |
| Docker / Kubernetes | 镜像、启动配置、Entrypoint 与运行时注入 | 在宿主终端 export 后，新 Pod 自动继承 |
| Notebook / 常驻 Worker | 内核或 Worker 创建时的环境 | 改 Shell 后旧进程中的库也已替换 |

对进程进行取证时，当前 Shell 的环境只是线索，不是该进程的实际环境。读取目标进程信息还要遵循用户权限，并避免导出令牌、私有仓库地址和完整业务配置。

## 6. 先收集不初始化计算的证据

以下面向 Linux，路径与 PID 需要按现场替换：

```bash
uname -m
cat /etc/os-release
python -VV
python -m pip show torch torch-npu
printf '%s\n' "${ASCEND_HOME_PATH-}" "${ASCEND_OPP_PATH-}"
printf '%s\n' "${LD_LIBRARY_PATH-}"
readlink -f /usr/local/Ascend/cann
```

某变量不存在、目录不存在或 `pip show` 找不到发行包，也可能只是使用了不同安装方式或错误解释器，不要为填满输出而临时安装软件。`latest` 或兼容链接的目标与其字面名称可能不同。

假设一个仍存活的目标进程 PID 为 24680，可以读取已经映射的相关库：

```bash
rg 'Ascend|libascendcl|libhccl|libatb|libtorch_npu' /proc/24680/maps
```

这只覆盖当时已映射的文件。延迟加载的库可能尚未出现，静态链接内容也不会以独立 `.so` 展示。路径不能单独证明补丁内容；还应关联精确包记录、制品身份与构建信息。

教学节选：

```text
... /usr/local/Ascend/cann-9.1.0/lib64/libascendcl.so
... /opt/venv/lib/python3.11/site-packages/torch_npu/lib/libtorch_npu.so
```

它表达“计算库和 Python 扩展来自不同安装前缀”，不表示这种组合天然错误；必须继续核对配套关系。这是归一化示例，不是本地实测输出。

## 7. 验证顺序与操作代价

| 验证 | 可以确认 | 不能单独确认 |
| --- | --- | --- |
| 文件、包与环境查询 | 安装和装载线索 | NPU 能运行算子 |
| `npu-smi info` | 部分管理可达与设备状态 | 应用计算依赖全部可用 |
| 框架导入及设备初始化 | 相应路径能开始工作 | 全模型 Kernel 和通信正确 |
| 有限最小算子 | 指定设备上的这次计算完成并校验结果 | 所有 dtype、Shape、图与多卡性能 |
| 目标模型与通信验证 | 所覆盖负载的功能与表现 | 未测业务与故障恢复能力 |

导入框架、查询可用性和运行算子可能初始化运行库、创建上下文或写缓存，不把它们归为完全无副作用的文本查询。功能验证应在有授权、资源有余量的测试实例上执行，见 [PyTorch 最小后端验证](../../ai-systems/runtime/01-PyTorch后端选择CUDA与torch-npu适配.md)。

## 8. 三种混装故障怎样区分

第一种是解释器错位：`pip` 装在环境 A，服务使用环境 B。先确认进程解释器与包路径，不通过扩大 `PYTHONPATH` 拼接整个环境。

第二种是用户态库混用：Python 扩展来自新环境，动态链接却选中旧库。查看实际映射、搜索路径与 ABI 错误，不能仅凭目录名里有 `latest` 就认为最新。

第三种是 Host 配套不满足：镜像内部自洽，但 Driver/Firmware 不支持所需能力。重新 source 不会升级 Host 接口；应按目标产品的完整矩阵重新选择组合。

镜像与宿主存在挂载时，还要检查挂载是否遮住镜像中的文件。固定 Digest 只能固定镜像本身，不能固定后注入的 Host 文件。

## 9. 练习与答案

**问题一：在终端 source 成功，为什么 systemd 服务仍可能缺库？**

答案：服务拥有自己的启动环境，不默认继承这个交互 Shell。应检查单元和实际启动进程，明确提供环境，而不是重复修改无关终端。

**问题二：安装新版用户态 CANN，是否同时升级了正在运行的 NPU 驱动？**

答案：不能这样假定。Driver、Firmware 与用户态环境是不同对象；某些合一包可能包含多类组件，更应检查实际选项、结果和维护影响。

**问题三：为什么不能把旧教程的 NNRT/Kernels 文件名直接改成新版本号安装？**

答案：软件包划分、目标硬件包和路径都可能演进。需要使用目标版本实际发布的包集合和配套关系，不存在仅改字符串就通用的安装公式。

**问题四：固定了镜像 Digest，为什么环境仍可能变化？**

答案：Host 驱动、运行时注入文件、挂载、设备分配和启动环境不由镜像 Digest 全部固定。应把这些因素一起纳入环境指纹。

## 10. 官方参考与延伸阅读

- [CANN 9.1 快速安装 FAQ](https://www.hiascend.com/doc_center/source/zh/CANNCommunityEdition/910/softwareinst/instg/instg_0050.html)
- [CANN 9.1 系列安装说明](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/910/softwareinst/instg/instg_0030.html)
- [CANN 新路径的环境脚本示例](https://www.hiascend.com/document/detail/zh/CANNCommunityEdition/910beta1/devaids/aoe/aoeep_16_023.html)
- [TorchNPU 配套关系](https://github.com/Ascend/pytorch/blob/master/COMPATIBILITY.md)
- [CANN 软件栈组件](./04-CANN软件栈组件与计算调用链.md)
- [昇腾容器注入与权限](../driver-runtime/08-昇腾容器运行时设备注入与权限边界.md)
