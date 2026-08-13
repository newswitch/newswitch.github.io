---
title: "nvidia-smi 失败：从 PCIe、驱动、NVML 到容器的完整排查"
date: 2026-07-22 16:00:00
categories: 云原生
tags: ["GPU", "nvidia-smi", "NVML", "驱动", "容器", "故障排查"]
description: "按二进制、PCIe、内核驱动、设备节点、NVML 和容器注入六层定位 nvidia-smi 失败，并建立安全恢复与重新上线标准。"
---

# nvidia-smi 失败：从 PCIe、驱动、NVML 到容器的完整排查

`nvidia-smi` 失败并不等于 GPU 损坏。它只说明下面这条管理链路的某一环没有正常工作：

```text
nvidia-smi
  -> 用户态 NVML（libnvidia-ml.so）
  -> /dev/nvidia* 设备节点
  -> NVIDIA 内核模块
  -> PCIe 中的 GPU
  -> 供电、固件和物理硬件
```

容器中还要增加一层：

```text
Kubernetes Device Plugin
  -> CRI / containerd
  -> NVIDIA Container Toolkit 或 CDI
  -> 把设备节点和驱动库注入容器
```

所以正确做法不是“先重装驱动”，而是从错误发生位置向下验证，找到第一处与正常基线不一致的证据。

本文示例以 Linux、NVIDIA 数据中心 GPU、containerd 和 Kubernetes 为主。驱动、GPU Operator、
Container Toolkit 与 CDI 会随版本变化，生产操作应以实际版本的官方文档和变更流程为准。

## 1. 学习目标

完成本文后，应能够：

- 解释 `nvidia-smi`、NVML、内核驱动和 PCIe 设备之间的关系；
- 根据退出码和错误文本选择正确的排查分支；
- 区分宿主机故障、容器镜像缺命令和容器设备注入故障；
- 定位驱动/用户态库版本不一致、Secure Boot、Nouveau 冲突和掉卡；
- 在不破坏现场的前提下采集完整证据；
- 设计隔离、修复、诊断和重新上线流程。

前置阅读：

- [GPU 集群六层排障模型](./02-GPU%20集群六层排障模型.md)
- [nvidia-smi 常用命令与指标说明](../../commands/01-nvidia-smi常用命令与指标说明.md)
- [GPU 节点巡检体系](../governance/06-GPU%20节点巡检体系设计.md)

## 2. 先判断故障范围

同一句“`nvidia-smi` 失败”，可能发生在完全不同的位置：

| 位置 | 表现 | 第一检查点 |
|---|---|---|
| 所有节点 | 升级后大面积失败 | 驱动/Operator 变更、镜像、内核版本 |
| 单节点宿主机 | 节点上执行失败 | PCIe、内核模块、NVML、Xid |
| 单节点所有容器 | 宿主机正常、容器均失败 | Toolkit、CRI、CDI、device plugin |
| 单个 Pod | 同节点测试 Pod 正常 | Pod 资源请求、RuntimeClass、镜像和权限 |
| 容器里只有命令不存在 | CUDA 程序可能仍正常 | 镜像是否包含管理工具 |
| 运行一段时间后失败 | 重建 Pod 暂时恢复 | cgroup 更新、旧 runtime hook、设备健康变化 |

先写下四个答案：

```text
宿主机是否失败？
同节点其他容器是否失败？
是启动就失败，还是运行后失败？
同批节点、同版本是否同时出现？
```

它们比反复执行命令更能缩小范围。

## 3. 事故现场的安全顺序

### 3.1 不要立即重启

重启可能清除内核 ring buffer、进程、设备状态和时间关系。先进行只读采集：

```bash
date --iso-8601=seconds
hostnamectl
uname -a
nvidia-smi
printf 'nvidia_smi_rc=%s\n' "$?"
nvidia-smi -L
nvidia-smi -q
lspci -Dnn | grep -iE 'NVIDIA|3D controller|VGA'
journalctl -k -b --no-pager
```

如果 `nvidia-smi -q` 本身失败也要保留输出和退出码，不要用空文件代表“无异常”。

### 3.2 判断是否需要隔离

出现以下任一情况，应阻止新 GPU 任务进入节点：

- GPU 数量少于资产基线；
- `GPU has fallen off the bus`、Xid 79 或持续 PCIe AER；
- Xid Catalog/Recovery Action 要求 drain/reset/reboot；
- Node Allocatable 与物理设备不一致；
- 多个业务容器持续失去 GPU；
- 需要重载驱动、reset GPU 或重启节点。

```bash
kubectl cordon gpu-node-01
```

`cordon` 只阻止新调度，不迁移现有 Pod。是否 drain 必须核对训练 Checkpoint、PDB、DaemonSet、
本地数据和业务恢复方案。

## 4. 读取退出码，而不是只看一行文本

```bash
nvidia-smi
rc=$?
printf 'return_code=%s\n' "$rc"
```

官方定义的常见返回码：

| 返回码 | 官方含义 | 主要排查方向 |
|---:|---|---|
| 0 | 成功 | 命令链路正常，不代表性能和所有链路健康 |
| 2 | 参数无效 | 脚本参数、版本不支持该查询字段 |
| 3 | 目标设备不支持该操作 | GPU 型号、虚拟化、MIG 或功能边界 |
| 4 | 权限不足 | 用户、设备节点、容器安全上下文 |
| 6 | 未找到查询对象 | index/UUID 变化、MIG 实例变化 |
| 8 | 外部供电线异常 | 供电、服务器硬件 |
| 9 | NVIDIA 驱动未加载 | 内核模块、Secure Boot、内核兼容性 |
| 10 | 驱动检测到 GPU 中断问题 | 内核日志、硬件/驱动诊断 |
| 12 | NVML 共享库未找到或无法加载 | 用户态包、动态链接、容器库注入 |
| 13 | 本地 NVML 不实现该功能 | 驱动/NVML 版本或功能差异 |
| 14 | infoROM 损坏 | 保留证据并联系厂商 |
| 15 | GPU 掉总线或不可访问 | Xid 79、PCIe/AER、供电、硬件 |
| 255 | 其他内部错误 | 完整日志、驱动报告和厂商支持 |

`nvidia-smi` 的文本输出不保证跨版本兼容，自动化应优先使用明确查询字段、CSV/XML、退出码和版本固定。

## 5. 六层排查

### 5.1 第一层：命令是否存在

```bash
command -v nvidia-smi
type -a nvidia-smi
readlink -f "$(command -v nvidia-smi)"
```

宿主机命令不存在，通常是驱动用户态工具未安装或 PATH 问题。容器中命令不存在则不一定故障：
精简业务镜像可能只注入 CUDA/NVML 运行库，没有安装 `nvidia-smi` 可执行文件。

容器内可继续检查：

```bash
ls -l /dev/nvidia* 2>&1
python -c 'import torch; print(torch.cuda.is_available(), torch.cuda.device_count())'
```

若框架能使用 GPU，只是命令缺失，应修复诊断镜像或调试流程，而不是重装宿主机驱动。

### 5.2 第二层：PCIe 是否枚举 GPU

```bash
lspci -Dnn | grep -iE 'NVIDIA|3D controller|VGA'
lspci -s 0000:41:00.0 -vv
```

将数量和 BDF 与资产基线比较：

```text
lspci 看不到目标 GPU
  -> 供电 / 插槽 / PCIe Switch / BIOS / 固件 / 硬件

lspci 能看到，nvidia-smi 看不到
  -> 驱动绑定 / 初始化 / 设备节点 / NVML / Xid
```

不要因为 `lspci` 有一行 NVIDIA 就宣告所有 GPU 正常；8 卡服务器必须核对 8 个预期 BDF。

### 5.3 第三层：内核模块是否加载和绑定

```bash
lsmod | grep -E '^nvidia|^nouveau'
modinfo nvidia | head
cat /proc/driver/nvidia/version
for d in /sys/bus/pci/devices/*; do
  if grep -qi 10de "$d/vendor" 2>/dev/null; then
    printf '%s -> ' "$(basename "$d")"
    readlink "$d/driver" 2>/dev/null || true
  fi
done
```

常见异常：

- 升级内核后 NVIDIA 模块没有为新内核构建；
- Secure Boot 拒绝未签名模块；
- Nouveau 抢占设备；
- 模块版本与用户态包来自不同升级批次；
- 驱动模块加载过程中因硬件或固件问题失败。

检查日志：

```bash
journalctl -k -b | grep -iE 'nvidia|nvrm|nouveau|module|secure|lockdown|aer|pcie'
mokutil --sb-state 2>/dev/null || true
```

不要在承载业务时直接 `rmmod nvidia`、强行卸载 Nouveau 或重载驱动。这些是维护动作，不是诊断命令。

### 5.4 第四层：设备节点

```bash
ls -l /dev/nvidia* 2>&1
stat /dev/nvidiactl /dev/nvidia-uvm 2>&1
```

常见设备包括：

```text
/dev/nvidia0...N    具体 GPU
/dev/nvidiactl      控制设备
/dev/nvidia-uvm     Unified Virtual Memory
/dev/nvidia-modeset 显示/模式相关，环境不同
/dev/nvidia-caps/*  能力设备，MIG 等场景会使用
```

宿主机驱动正常但节点缺失时，应检查 udev、驱动初始化和系统日志。容器中缺失而宿主机存在，重点转向
Toolkit/CDI 注入和容器设备 cgroup。

### 5.5 第五层：NVML 与驱动版本

`nvidia-smi` 通过 `libnvidia-ml.so` 使用 NVML：

```bash
ldd "$(command -v nvidia-smi)"
ldconfig -p | grep libnvidia-ml
cat /proc/driver/nvidia/version
modinfo -F version nvidia
```

`Driver/library version mismatch` 常见于：

- 驱动包升级后，旧内核模块仍在内存中；
- 多套软件源或 `.run` 安装与包管理器混用；
- `LD_LIBRARY_PATH` 把进程指向旧 NVML；
- 容器挂载了与宿主机驱动不匹配的库；
- 节点升级只完成了一半。

正确修复是确认软件来源、目标版本和兼容矩阵，在维护窗口完成一致升级和节点重启，再核对版本。
仅复制一个 `libnvidia-ml.so` 或不断执行 `ldconfig` 可能制造更难追踪的混合环境。

### 5.6 第六层：容器与 Kubernetes 注入

若宿主机 `nvidia-smi` 正常，容器失败：

```bash
kubectl get pod -A --field-selector spec.nodeName=gpu-node-01 -o wide
kubectl describe pod -n <namespace> <pod>
kubectl exec -n <namespace> <pod> -- sh -c 'ls -l /dev/nvidia* 2>&1; env | grep -E "NVIDIA|CUDA"'
kubectl logs -n gpu-operator -l app=nvidia-device-plugin-daemonset --tail=200
crictl info
containerd config dump
```

命名空间和 label 必须按安装方式调整。检查：

- Pod 是否真的请求 `nvidia.com/gpu` 或正确的 MIG/共享资源名；
- 目标节点 device plugin 是否健康并注册资源；
- containerd 是否有 NVIDIA runtime/CDI 配置；
- RuntimeClass 是否正确；
- 容器是否注入设备节点和驱动库；
- `NVIDIA_VISIBLE_DEVICES`、CDI annotation/CRI 字段是否与插件策略一致；
- MIG 重配置后 CDI spec 和资源是否已刷新。

Container Toolkit 较新版本可通过 CDI 描述设备，`nvidia-ctk cdi list` 可检查可用设备。当前文档中，
CDI spec 通常位于 `/var/run/cdi/nvidia.yaml`，并由 `nvidia-cdi-refresh` 管理；具体机制以安装版本为准：

```bash
nvidia-ctk --debug cdi list
systemctl status nvidia-cdi-refresh.path nvidia-cdi-refresh.service
journalctl -u nvidia-cdi-refresh.service
```

MIG 重配置可能需要显式触发刷新。不要同时混用 CDI 与旧 OCI Hook 而没有明确设计，否则可能重复注入或冲突。

## 6. 按错误文本分流

### 6.1 `command not found`

```text
宿主机？
├─ 是 -> 用户态工具包/PATH/安装方式
└─ 否，容器
   ├─ /dev/nvidia* 和 CUDA 正常 -> 镜像仅缺命令
   └─ 设备也缺 -> Pod 请求与注入链路
```

### 6.2 `NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver`

按顺序确认：

1. `lspci` 是否有预期 GPU；
2. `lsmod` 是否加载 NVIDIA 模块；
3. `/proc/driver/nvidia/version` 是否存在；
4. 内核日志是否有模块加载、Secure Boot、Nouveau 或 Xid；
5. `/dev/nvidia*` 是否存在；
6. 是否只在容器中发生。

### 6.3 `Failed to initialize NVML: Driver/library version mismatch`

比较运行中的内核模块和用户态 NVML。若刚完成升级，节点可能需要在安全维护流程中重启，让新模块真正加载。
记录包版本和安装来源，避免“卸了又装”丢失根因。

### 6.4 `NVML Shared Library couldn't be found or loaded`

返回码通常为 12。检查 `ldd`、`ldconfig -p`、包完整性和容器挂载。不要把主机某个库文件手工复制进镜像作为长期方案，
驱动库应由受支持的容器注入链路提供。

### 6.5 `No devices were found`

```text
lspci 是否符合资产基线？
├─ 否 -> PCIe/供电/硬件
└─ 是
   ├─ 驱动是否绑定
   ├─ 内核日志是否有初始化失败/Xid
   ├─ 设备是否被 VFIO/虚拟化占用
   ├─ MIG/虚拟 GPU 配置是否改变
   └─ 容器是否只注入了指定设备
```

### 6.6 `GPU has fallen off the bus`

常与 Xid 79、PCIe/AER、供电或硬件相关：

```text
cordon
 -> 保存 kernel journal、Xid、AER、BMC/SEL、BDF 和工作负载
 -> 协调任务退出/Checkpoint
 -> 按官方 Recovery Action 和厂商流程决定 reset/reboot/诊断
 -> 修复后进行 DCGM、链路和业务验收
```

见 [NVIDIA Xid 错误排查](./06-NVIDIA%20Xid%20错误排查.md)。

### 6.7 容器中的 `Failed to initialize NVML: Unknown Error`

若容器启动时正常、运行一段时间后失效，而宿主机仍正常，检查问题发生前是否有：

- `systemctl daemon-reload`；
- 容器 CPU/内存限制更新；
- runtime/cgroup 配置变化；
- 旧 NVIDIA Runtime Hook 注入；
- runc/驱动版本相关设备节点问题。

官方 Container Toolkit 文档指出，旧 Hook/cgroup 注入方式可能在容器更新后失去 GPU 访问，重建容器会恢复；
CDI 是可评估的长期缓解方向。生产迁移必须先在固定版本的测试节点验证，不能因一条错误直接切换全群 runtime。

## 7. 把 GPU 映射到节点、Pod 和进程

即使 `nvidia-smi` 还能工作，也要使用稳定标识建立关联：

```bash
nvidia-smi --query-gpu=index,uuid,pci.bus_id,name --format=csv
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv
```

将进程映射到容器：

```bash
pid=12345
cat "/proc/$pid/cgroup"
readlink -f "/proc/$pid/ns/mnt"
```

再通过 container runtime 和 Kubernetes 元数据找到 Pod。GPU index 会变化，事故报告应记录 UUID、PCI BDF、
节点、Pod UID、容器 ID 和时间。

## 8. 恢复动作的风险等级

| 动作 | 风险 | 适用条件 |
|---|---|---|
| 重跑只读命令 | 低 | 收集证据 |
| 重建单个测试 Pod | 低到中 | 宿主机正常、验证注入链路 |
| 重建业务 Pod | 中 | 已确认状态和流量迁移方式 |
| 重启 device plugin | 中 | 资源注册问题，评估节点影响 |
| 重启 containerd | 高 | 可能影响节点全部容器 |
| GPU reset | 高 | GPU 空闲、拓扑支持、官方流程允许 |
| 重载驱动 | 高 | 节点清空并进入维护窗口 |
| 节点重启 | 高 | Checkpoint、PDB、本地数据和回滚已确认 |

GPU reset 受 GPU 架构、NVLink/NVSwitch、Fabric Manager、虚拟化和是否有进程占用等限制。不要把
`nvidia-smi --gpu-reset` 写进无人值守的通用修复脚本。

## 9. 修复后的重新上线门禁

至少验证：

- [ ] `lspci` GPU 数量与 BDF 符合资产基线；
- [ ] `nvidia-smi -L` 的 UUID、型号和 MIG 状态正确；
- [ ] 内核模块、NVML 和驱动版本一致；
- [ ] 最近观察窗没有新的 Xid/AER/ECC 关键错误；
- [ ] device plugin 资源注册与 Node Allocatable 正确；
- [ ] 最小 CUDA Pod 能申请并运行；
- [ ] DCGM 指定级别诊断通过；
- [ ] NVLink/NVSwitch、PCIe 和 NIC 拓扑符合基线；
- [ ] 固定业务 smoke test 通过；
- [ ] 最后才执行 `kubectl uncordon`。

`nvidia-smi` 恢复只是其中一项，不是节点健康证明。

## 10. 可复现实验

### 实验一：认识退出码和不支持字段

在测试节点执行正确与错误参数，记录 stdout、stderr 和退出码。再使用
`nvidia-smi --help-query-gpu` 核对当前驱动支持的字段。

### 实验二：区分无命令与无设备

准备两个测试镜像：一个包含 `nvidia-smi`，另一个只安装 PyTorch。两者都申请一张 GPU，分别用
管理命令和 `torch.cuda` 证明设备是否可用。

### 实验三：容器注入证据

对比宿主机和测试 Pod 的 `/dev/nvidia*`、环境变量、Mount、CDI 列表和 runtime inspect 输出，画出设备如何进入容器。

### 实验四：资源注册故障

只在测试集群停止 device plugin，观察：宿主机 GPU、Node Allocatable、已有 Pod 和新 Pod 分别怎样变化。
恢复插件后验证资源重新注册。不要在生产环境实施该实验。

## 11. 掌握标准

### 入门

- 能解释 `nvidia-smi` 为什么依赖 NVML 和内核驱动；
- 能读取返回码并区分宿主机与容器故障；
- 能完成不破坏现场的只读采集。

### 进阶

- 能定位驱动未加载、版本不一致、NVML 缺失和容器设备缺失；
- 能把 GPU UUID/BDF 映射到进程和 Pod；
- 能解释 `Unknown Error` 为什么可能与 cgroup/CDI 相关。

### 生产级

- 能根据 Xid/Recovery Action 安全隔离和恢复节点；
- 能设计驱动升级、容器注入和重新上线门禁；
- 能在不盲目重启的情况下形成可提交给厂商的证据包。

## 参考资料

- [NVIDIA System Management Interface](https://docs.nvidia.com/deploy/nvidia-smi/index.html)
- [NVIDIA Container Toolkit troubleshooting](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/troubleshooting.html)
- [NVIDIA Container Toolkit CDI support](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/cdi-support.html)
- [NVIDIA GPU Debug Guidelines](https://docs.nvidia.com/deploy/gpu-debug-guidelines/index.html)
- [Kubernetes Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/)

本文中的修改 runtime、reset、重载驱动和重启均属于生产变更，应在隔离节点、明确回滚和业务批准后执行。
