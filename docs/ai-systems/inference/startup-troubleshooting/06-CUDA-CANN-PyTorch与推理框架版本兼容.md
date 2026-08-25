---
title: "CUDA、CANN、PyTorch 与推理框架版本兼容"
sidebar_label: "06. 加速器软件栈版本兼容"
sidebar_position: 6
description: "分别建立 NVIDIA CUDA 与昇腾 CANN 软件栈兼容矩阵，识别驱动、Runtime、PyTorch、插件、Kernel 和推理框架的边界。"
tags: [CUDA, CANN, PyTorch, torch-npu, vLLM, 兼容性]
---

# CUDA、CANN、PyTorch 与推理框架版本兼容

模型启动失败经常被概括为“环境问题”，但环境不是一个版本号，而是一条软件栈。任何相邻层的 ABI、
API 或硬件能力不匹配，都可能在导入、设备初始化、编译或第一次 Kernel 执行时暴露。

## 1. 两条软件栈

NVIDIA：

```text
GPU 架构
→ Firmware / Driver
→ NVIDIA Container Toolkit
→ 容器内 CUDA Runtime 与 CUDA 库
→ PyTorch CUDA Wheel
→ Triton / FlashAttention / 自定义 Kernel
→ vLLM / SGLang / 业务服务
```

昇腾：

```text
Atlas 服务器与 Ascend NPU
→ Firmware / Driver
→ 容器设备映射与 Ascend Runtime
→ CANN Toolkit / Kernels
→ PyTorch + torch-npu
→ ATB / Triton-Ascend / 自定义算子
→ vLLM-Ascend / MindIE / 业务服务
```

版本检查必须从底向上，不能只打印 `pip list`。

## 2. 兼容不只是版本字符串相等

需要同时满足：

- **硬件支持**：软件仍支持当前 GPU Compute Capability 或 NPU 型号。
- **驱动接口**：宿主机驱动满足容器 Runtime 的最低要求。
- **Python ABI**：Wheel 支持当前 Python 和 CPU 架构。
- **框架 ABI/API**：扩展按兼容的 PyTorch、vLLM 接口构建。
- **Kernel 能力**：dtype、模型架构和算子在目标设备上有实现。
- **插件对应关系**：vLLM-Ascend 等插件与上游 vLLM 版本严格匹配。

所以“CUDA 版本看起来一样”仍可能因为 PyTorch、Triton 或 GPU 架构不匹配而失败。

## 3. 宿主机和容器分别提供什么

NVIDIA 容器通常使用宿主机的内核态驱动，并在容器内携带用户态 CUDA Runtime、PyTorch 和应用库。
宿主机不需要安装一套与容器完全相同的 CUDA Toolkit，但驱动必须支持容器所需 CUDA 能力。

```text
宿主机：GPU + Driver + Container Runtime
容器：  CUDA Runtime/Libraries + PyTorch + Framework
```

不要把 `nvidia-smi` 显示的 `CUDA Version` 误认为容器内 `nvcc` 或 PyTorch 实际使用的 CUDA Runtime 版本。
它主要表示当前驱动能够支持的 CUDA 上限之一。

昇腾容器同样需要宿主机驱动、设备节点和容器内 CANN/torch-npu 正确配套。具体哪些组件由宿主机挂载、
哪些固化在镜像，应以当前部署方案和官方镜像说明为准。

## 4. 建立环境指纹

每次发布至少记录：

```text
操作系统、Kernel、CPU 架构
GPU/NPU 型号
驱动与 Firmware
容器运行时和设备插件
容器镜像 digest
Python
PyTorch 与 torch.version.cuda / torch-npu
CUDA/CANN 用户态库
NCCL/HCCL
Triton、FlashAttention、ATB 等 Kernel 包
vLLM、vLLM-Ascend、SGLang、MindIE
模型 revision、dtype 和量化格式
```

### 4.1 NVIDIA 环境取证

```bash
nvidia-smi
python - <<'PY'
import platform
import torch
print("python:", platform.python_version())
print("torch:", torch.__version__)
print("torch cuda:", torch.version.cuda)
print("cuda available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device:", torch.cuda.get_device_name(0))
    print("capability:", torch.cuda.get_device_capability(0))
PY
python -m pip show vllm triton flash-attn
```

### 4.2 昇腾环境取证

```bash
npu-smi info
python - <<'PY'
import platform
import torch
import torch_npu
print("python:", platform.python_version())
print("torch:", torch.__version__)
print("torch_npu:", torch_npu.__version__)
print("npu available:", torch.npu.is_available())
PY
python -m pip show vllm vllm-ascend torch torch-npu
```

这些命令只用于读取环境，不应在生产容器内顺手升级包。

## 5. NVIDIA Driver 与 CUDA 兼容边界

一般规律是：

- 新驱动通常可以运行使用较旧 CUDA Toolkit 构建的应用。
- 同一 CUDA 大版本内存在有条件的 Minor Version Compatibility。
- 跨大版本让旧驱动运行新 Runtime 可能需要 Forward Compatibility 包，并受平台限制。
- 每个 CUDA Toolkit 都有最低驱动要求。
- 新 Toolkit 可能停止支持旧 GPU 架构。

这些规则有前提和功能限制，不能把“新驱动兼容旧 CUDA”扩展成任意组合都受支持。生产环境应按
CUDA Release Notes 和驱动矩阵验证具体版本。

## 6. PyTorch Wheel 决定了什么

PyTorch 安装包通常针对特定 CUDA Runtime 或平台构建。它还决定：

- 支持的 Python 版本。
- 编译时 C++ ABI 与依赖库。
- 自带或依赖的 CUDA 组件。
- 可用 dtype、算子和设备能力。
- 第三方扩展需要匹配的 PyTorch ABI。

常见问题：

```text
安装了 CPU-only PyTorch
PyTorch Wheel 对应的 CUDA 与镜像库混杂
升级 PyTorch 后 flash-attn 仍是旧 ABI
Python 小版本不在 Wheel 支持范围
x86_64 镜像运行在 aarch64 节点
```

## 7. 为什么自定义算子最容易暴露兼容问题

FlashAttention、Triton Kernel、PagedAttention 或厂商算子位于 PyTorch 和硬件之间，可能依赖：

- PyTorch C++/CUDA 扩展 ABI。
- CUDA/CANN API。
- GPU Compute Capability 或 NPU 型号。
- 编译器、glibc、libstdc++。
- 特定 dtype 和模型 Shape。

因此，基础 `torch.matmul` 成功不代表推理框架全部 Kernel 可用。至少要完成一次真实模型 Prefill 和 Decode。

## 8. 昇腾版本矩阵为什么更加需要整体锁定

vLLM-Ascend 是上游 vLLM 的平台插件，版本通常与特定 vLLM、PyTorch、torch-npu 和 CANN 组合对应。
不能只升级其中一个包。

推荐把下面一组视为一个发布单元：

```text
Driver/Firmware
CANN
PyTorch / torch-npu
vLLM / vLLM-Ascend
ATB 或相关 Kernel
模型与启动参数
```

插件版本中的 `rcN`、`.postN` 和开发版具有不同稳定性边界。具体选择见
[vLLM-Ascend 版本兼容矩阵与镜像标签选择](../vllm-ascend/04-vLLM-Ascend版本兼容矩阵与镜像标签选择.md)。

## 9. 错误发生在哪一层

| 现象 | 优先检查层 |
|---|---|
| `ModuleNotFoundError` | Python 包与环境 |
| `undefined symbol` | PyTorch/扩展/动态库 ABI |
| `driver version is insufficient` | 宿主机 Driver 与容器 CUDA |
| `no kernel image is available` | Kernel 编译架构与 GPU 能力 |
| `torch.cuda.is_available() == False` | 设备注入、驱动、PyTorch Wheel |
| `torch.npu.is_available() == False` | 设备节点、CANN、torch-npu |
| 模型创建成功、首个算子失败 | dtype、Kernel、模型支持矩阵 |
| vLLM-Ascend 插件拒绝加载 | vLLM 与插件版本对应关系 |

## 10. 动态库冲突怎样确认

首先确定模块文件位置：

```bash
python -c "import torch; print(torch.__file__)"
```

再查看关键扩展依赖：

```bash
ldd /path/to/extension.so
readelf -d /path/to/extension.so
```

重点观察：

- 是否出现 `not found`。
- 实际加载路径是否来自意外的 Conda、系统目录或旧 Toolkit。
- 同名库是否存在多个版本。
- `LD_LIBRARY_PATH` 是否把旧目录放在前面。

完整方法见[动态链接库诊断命令详解](../../runtime/commands/03-动态链接库诊断命令详解.md)。

## 11. 构建一张受支持矩阵

不要维护“可能可以”的组合，只维护经过验证的组合：

| 环境 ID | 设备 | Driver/CANN | PyTorch | 框架 | Kernel | 模型 | 状态 |
|---|---|---|---|---|---|---|---|
| nvidia-a | A100 | 固定版本 | 固定版本 | vLLM 固定版本 | 固定版本 | Qwen 固定 revision | 通过 |
| ascend-b | 910B | 固定版本 | torch/torch-npu 固定版本 | vLLM/插件固定版本 | 固定版本 | Qwen 固定 revision | 通过 |

“通过”至少包含：

- Python 导入。
- 设备最小算子。
- 模型启动。
- 短请求和长请求。
- 多卡通信测试。
- 性能与显存基线。
- 重启、升级和回滚。

## 12. 安全升级流程

1. 复制当前可工作的完整矩阵。
2. 一次升级一个发布单元，而不是在线 `pip install -U`。
3. 构建新镜像并固定 digest。
4. 在同型号设备运行兼容性和模型验收。
5. 对比启动日志、精度、显存和性能。
6. 小流量灰度，保留旧镜像与模型目录。
7. 明确回滚触发条件和最大回滚时间。

如果某组件的官方矩阵要求联动升级，应把它们作为同一个单元测试，但仍要记录每项变化。

## 13. 参考资料

- [NVIDIA CUDA Compatibility](https://docs.nvidia.com/deploy/cuda-compatibility/latest/)
- [NVIDIA CUDA Toolkit、Driver 与架构矩阵](https://docs.nvidia.com/datacenter/tesla/drivers/cuda-toolkit-driver-and-architecture-matrix.html)
- [PyTorch Previous Versions](https://pytorch.org/get-started/previous-versions/)
- [vLLM-Ascend Versioning Policy](https://vllm-ascend.readthedocs.io/en/latest/developer_guide/versioning_policy.html)
- [NVIDIA 驱动、CUDA 与容器运行时的关系](../../../gpu/driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md)
