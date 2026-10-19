---
title: "GDRCopy 映射拷贝生命周期与源码"
sidebar_label: "06. GDRCopy 映射拷贝生命周期与源码"
sidebar_position: 6
description: "以 GDRCopy v2.6 源码解释 CPU 映射 GPU 内存、gdrdrv 与 DMA-BUF 后端、对齐、拷贝快路径和同步成本。"
tags: [GDRCopy, GPUDirect, PCIe, DMA-BUF, 源码, 内存模型]
---

# GDRCopy 映射拷贝生命周期与源码

GDRCopy 用 CPU 对 GPU 内存映射进行读写，减少某些小消息复制的提交开销。它不是让网卡执行 RDMA，也不是用 GPU Kernel 完成一次 `memcpy`。理解它的特色，应沿“建立映射、反复复制、完成交接、撤销映射”阅读，而不是只比较一个延迟数字。

前置是[CPU 与 GPU 数据搬运](./05-CPU与GPU之间的数据搬运.md)。源码固定为 [NVIDIA/gdrcopy v2.6](https://github.com/NVIDIA/gdrcopy/tree/v2.6)，不把移动分支当作所有已安装版本的行为；以下以调用链和自建模型解释，不提供生产加载模块脚本。

## 1. 三条路径的执行者不同

| 路径 | 数据面主要执行者 | 需要另外证明什么 |
| --- | --- | --- |
| 常见 CUDA Host/Device 复制 | 受设备和 API 条件约束的复制引擎/运行时路径 | 内存类型、Stream、完成属性与重叠 |
| GDRCopy | CPU Load/Store 访问合法 GPU 内存映射 | 映射类型、拓扑、CPU 成本和 GPU 消费同步 |
| NIC GPUDirect RDMA | NIC 对已注册 GPU 内存发起 DMA | RDMA 注册、队列、网络与 GPU 可见性 |

GDRCopy 可以复用 GPUDirect 相关能力建立映射，但测到 CPU↔GPU 拷贝快，不能证明跨机 Fabric 或 NIC 的 GPU Buffer 路径正常。网络注册的主线见[GPUDirect 生命周期](../../networking/rdma-roce/ai-cluster/13-GPUDirect内存注册DMA-BUF与生命周期.md)。

## 2. 先找到后端选择 而不是先找 memcpy

[`gdr_open`](https://github.com/NVIDIA/gdrcopy/blob/v2.6/src/gdrapi.c#L198)先建立库状态。默认尝试 `/dev/gdrdrv`，检查用户库与驱动版本；失败或显式要求另一后端时，再检查 CUDA 驱动的 DMA-BUF mmap 能力。两者均不可用才返回失败。

| v2.6 后端 | 建立访问的主要链路 | 不能混同的名称 |
| --- | --- | --- |
| gdrdrv | 用户库 → ioctl 固定 GPU 页面 → 内核 mmap | `gdrdrv` 不是面向 HCA Peer Memory 的 `nvidia-peermem` |
| DMA-BUF mmap | CUDA 导出 DMA-BUF FD → 对 FD 建立用户态 mmap | “可导出 DMA-BUF”不自动保证所有设备都支持此 CPU 映射能力 |

v2.6 的 [README](https://github.com/NVIDIA/gdrcopy/blob/v2.6/README.md#dma-buf-mmap-backend)将该 DMA-BUF mmap 后端的最低 CUDA driver 条件列为 13.3，并提供 `GDRCOPY_USE_DMABUF_MMAP=1` 强制选择及 `GDR_ATTR_USING_DMA_BUF_MMAP` 查询。它不是 GPU Operator 中 NIC DMA-BUF 注册路径的最低版本要求，不能跨产品照搬。

`gdr_open` 成功只说明库找到了可用后端；具体 GPU、分配和映射类型还要在后续操作检查。混合设备机器上，“有一张 GPU 支持”不等于待访问的那张也支持。

## 3. Pin 与 Map 是两个阶段

头文件 [`gdrapi.h`](https://github.com/NVIDIA/gdrcopy/blob/v2.6/include/gdrapi.h#L83)把 Pin 和用户态可访问的 Map 分开：Pin 得到内存句柄，不代表已经获得可解引用的 CPU 指针。

```text
CUDA 分配与设备身份
→ gdr_open 选后端
→ gdr_pin_buffer / v2 固定或导出这份分配
→ gdr_map / v2 建立 CPU 地址
→ gdr_get_info 查询实际映射
→ 多次复制 + 每轮交接
→ 停止所有使用者
→ gdr_unmap → gdr_unpin_buffer → 释放 CUDA 分配
```

gdrdrv 分支的 [`__gdrdrv_pin_buffer`](https://github.com/NVIDIA/gdrcopy/blob/v2.6/src/gdrdrv/gdrdrv.c#L798)对地址与长度进行对齐，再调用适用的 NVIDIA 页面 API，并验证返回页表；[`gdrdrv_mmap`](https://github.com/NVIDIA/gdrcopy/blob/v2.6/src/gdrdrv/gdrdrv.c#L1585)继续检查进程、句柄、失效状态及范围。这些步骤不能被“知道一个 GPU 指针”替代。

DMA-BUF 分支在 [`gdr_pin_buffer_dmabuf`](https://github.com/NVIDIA/gdrcopy/blob/v2.6/src/gdrapi.c#L284)取得导出句柄，并在 Map 阶段调用 `mmap`。因此要分别归因：导出失败、映射失败、复制调用失败和 GPU 消费错误，不必都归类为驱动未加载。

## 4. CPU 地址 GPU 地址和切片偏移

`gdr_get_info` 返回的 `va`、`mapped_size`、`page_size` 和 `mapping_type` 属于实际映射事实。CPU 映射基址不是 GPU 虚拟地址，逻辑 Buffer 也可能只是较大分配中的一个切片。

教学条件：合法分配基址为 GPU `0x10000000`，已按所选后端要求成功 Pin/Map 整块 64 KiB；查询结果确认对应基址，CPU 映射基址为 `0x70000000`。应用访问分配内 `0x1234` 偏移的 4096 字节：

```text
逻辑 GPU 地址 = 0x10000000 + 0x1234
逻辑 CPU 地址 = 0x70000000 + 0x1234
偏移 = 4660 字节
范围检查：4660 + 4096 = 8756，不超过该有效分配与映射范围
```

这是先建立合法整块映射、再寻址切片的例子，不是允许任意未对齐 GPU 指针直接 Pin。v2.6 的 gdrdrv mmap 分支会拒绝其不支持的非零原始 offset。实际代码应查对应后端约束，不能从“内部做了对齐”推导所有切片都被接受。

64 KiB 也不是所有后端的统一页大小。gdrdrv 页面路径有特定 GPU 页大小检查，DMA-BUF 分支使用自己的页对齐信息；代码应根据查询结果核对分配、映射和逻辑范围，不能复制一份固定掩码处理所有平台。

## 5. 拷贝快路径为何要区分映射类型

[`gdr_copy_to_mapping`](https://github.com/NVIDIA/gdrcopy/blob/v2.6/src/gdrapi.c#L1492)检查句柄是否已映射，再进入内部复制；CPU 指针和大小仍必须属于正确映射。入口检查不是完整的应用越界保护。

内部路径按 WC、Caching、Device 等映射属性，以及 CPU 指令能力、构建支持和对齐选择实现。源码中可见 SSE/AVX、MOVDIR64B 或 Arm 对应路径，但列出某条指令不表示所有机器都使用它。

Write Combining（WC）有利于把 CPU 写入合并为设备事务，并不让映射变成普通可缓存 RAM。传统非一致性 PCIe/BAR 映射的读写成本可能明显不对称；一致性平台的缓存迁移又可能改变冷、热访问结果。因此 H2D 优势不能直接外推到 D2H，更不能外推到所有 CPU-GPU 平台。

[`gdr_copy_to_mapping_internal`](https://github.com/NVIDIA/gdrcopy/blob/v2.6/src/gdrapi.c#L1270)还处理对齐、分块与尾部，最后按映射组合执行相应 Fence。直接把它替换成任意 libc `memcpy`，可能丢失设备映射访问与排序要求；只研究向量指令宽度，会漏掉真正的正确性前提。

## 6. CPU Fence 不等于 GPU 已经消费

源代码中的 CPU 内存屏障约束相应 CPU 访问顺序，不能据此宣称一个预先运行的 GPU Kernel 已安全看到完整数据。头文件明确提醒：该复制 API 不保证预先启动的 GPU 工作观察到的数据完整性与顺序。

BAR 映射与 CUDA 内存操作的一致性也有注册前提。官方 GPUDirect 文档说明相应路径需为分配建立 CUDA API consistency，例如适用时的 `CU_POINTER_ATTRIBUTE_SYNC_MEMOPS`；不能把“GPU 地址已映射到 CPU”直接推导为所有 CUDA API 与外部访问均已正确排序。该属性也不是预运行 Kernel 的通用消费通知。

一个保守的教学交接模型是：GPU 生产结果后，通过适用 CUDA 完成机制让 CPU 知道结果可读，再由 CPU 读取映射；CPU 写入输入后，通过该平台支持的 CUDA 工作提交/同步边界交给后续 GPU 工作。这里仍需遵循 [GPUDirect 同步契约](https://docs.nvidia.com/cuda/gpudirect-rdma/index.html#synchronization-and-memory-ordering)，不是任意 Event 都自动覆盖外部写入。

反例：CPU 写 payload，接着把标志设为 1，持久 GPU Kernel 普通轮询标志后读取 payload。仅靠 `volatile`、复制 API 返回或 CPU Fence，不能把它证明为可移植协议；需要目标平台支持的可见性、原子访问及先后关系。

通信侧的 Fence/Quiet 又属于另一份契约，比较见 [NVSHMEM](../../networking/rdma-roce/ai-cluster/11-NVSHMEM与GPU-One-Sided通信模型.md)。名称相似的完成原语不能跨执行域互相代替。

## 7. 生命周期比地址值更重要

传统失效回调路径中，[内核回调](https://github.com/NVIDIA/gdrcopy/blob/v2.6/src/gdrdrv/gdrdrv.c#L733)会标记失效、释放页表并撤销对应映射。Persistent 路径不具有相同的回调行为，DMA-BUF 后端还持有每个导出 Buffer 的 FD。不能用“回调标志仍为零”统一证明所有映射有效。

Persistent 在这里描述映射生命周期机制，不表示重启后数据持久、跨进程可任意使用或可以忘记释放。应用仍要保持原分配有效，先停止使用、Unmap、Unpin，最后释放 CUDA 分配；句柄、CPU 指针和 GPU 地址要作为一组对象管理。

地址释放后被下一份分配复用，也不是旧映射可以继续使用的理由。应关联分配身份和引用，而非只用指针数值查缓存。v2.6 源码中的部分映射计数按非线程安全假设处理，多线程程序也不能自行假定全部 API 可无锁并发。

## 8. 小消息收益需要摊销模型

用自建模型比较完成属性一致的两条路径，设每轮传 b 字节、同一映射复用 N 次：

```text
CUDA 路径：Tc = Lc + b/Bc
GDRCopy： Tg = Rg/N + Lg + b/Bg
```

Rg 是一次准备成本，Lg/Lc 是每轮固定成本，Bg/Bc 是同口径有效带宽。此模型未含并行、拥塞及真实 GPU 交接，仅用于解释固定开销与带宽的取舍。

纯教学假设：Rg=80 µs、N=1000、Lg=0.4 µs、Lc=4 µs、Bg=8 GB/s、Bc=24 GB/s，GB 使用十进制。准备成本摊到每轮为 0.08 µs；两条直线交点为：

```text
b = (4 - 0.4 - 0.08) µs / (1/(8 GB/s) - 1/(24 GB/s))
  = 42240 字节 = 41.25 KiB
```

在这些假设下，小消息更容易受益，大消息更容易受较低 Bg 限制。若每次重新 Pin/Map，N=1，准备成本就足以消除该例优势。数字不是硬件实测，更不是库内统一阈值。

还要计算 CPU 机会成本：CPU 亲自搬运数据，可能抢占网络 Progress、预处理或调度线程。一次复制变快但关键 CPU 核更忙，端到端训练或推理仍可能变慢。

## 9. 从测试源码辨认测到了什么

v2.6 的 [`tests/copylat.cpp`](https://github.com/NVIDIA/gdrcopy/blob/v2.6/tests/copylat.cpp#L267)把 Pin/Map 放在复制计时循环外，按消息大小进行重复调用；它还区分冷缓存相关条件，并明确提醒写入测试测量的是 CPU 观察到的 API 开销，不是 GPU 已完整消费的时刻。

因此应分开报告准备成本、稳态复制成本和包含 GPU 交接的端到端成本。冷缓存与热缓存、CPU/GPU 拓扑、映射类型、所选后端及复用次数必须相同，才适合做路径比较。不能把最小 API 延迟与另一条路径的完整同步延迟直接相减。

## 10. 掌握检查

**gdrdrv 不存在是否一定无法使用 GDRCopy？** v2.6 还要看特定 CUDA 驱动与设备支持的 DMA-BUF mmap 后端，不能只查模块。

**Pin 成功是否允许 CPU 解引用 GPU 指针？** 不允许。还需要合法用户态 Map，并使用正确 CPU 地址。

**Persistent 是否代表内存已经持久化？** 不代表，也不取消分配寿命和资源释放要求。

**CPU 写入 API 延迟很小，是否等于 GPU 已读到？** 不等于，必须补上消费与完成口径。

## 11. 参考资料

- [GDRCopy v2.6 版本说明及后端条件](https://github.com/NVIDIA/gdrcopy/blob/v2.6/README.md)
- [v2.6 用户 API 定义](https://github.com/NVIDIA/gdrcopy/blob/v2.6/include/gdrapi.h)
- [v2.6 用户态映射与复制实现](https://github.com/NVIDIA/gdrcopy/blob/v2.6/src/gdrapi.c)
- [v2.6 gdrdrv 页面与 mmap 实现](https://github.com/NVIDIA/gdrcopy/blob/v2.6/src/gdrdrv/gdrdrv.c)
- [v2.6 copylat 测量边界](https://github.com/NVIDIA/gdrcopy/blob/v2.6/tests/copylat.cpp)
- [GPUDirect 同步与内存排序](https://docs.nvidia.com/cuda/gpudirect-rdma/index.html#synchronization-and-memory-ordering)
