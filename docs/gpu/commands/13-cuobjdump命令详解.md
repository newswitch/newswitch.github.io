---
title: "cuobjdump 命令详解：提取 PTX、Cubin 与 CUDA ELF 信息"
sidebar_label: "13. cuobjdump 命令详解：提取 PTX、Cubin 与 CUDA ELF 信息"
sidebar_position: 13
description: "使用 cuobjdump 检查 Host Binary、Library 与 Fatbin 中的 CUDA 代码对象、架构、资源和反汇编信息。"
tags: [CUDA, cuobjdump, PTX, Cubin, SASS, 二进制分析]
---

# cuobjdump 命令详解：提取 PTX、Cubin 与 CUDA ELF 信息

`cuobjdump` 类似 CUDA 世界的 `objdump`：它可从可执行文件、对象文件、静态/动态库和 Fatbin 中列出或提取 PTX、Cubin、ELF 段与 SASS。它回答“最终 Binary 里到底打包了哪些 GPU 架构和代码”。

## 1. 基础查询 `[R]`

```bash
cuobjdump --version
cuobjdump --help
cuobjdump --list-elf ./app
cuobjdump --list-ptx ./app
cuobjdump --dump-resource-usage ./app
```

输出选项在 CUDA Binary Utilities 的不同版本中会有增减；执行前以本机帮助确认名称和组合限制。

## 2. 核心选项族

| 选项 | 作用 |
|---|---|
| `--list-elf` | 列出嵌入的 CUDA ELF/Cubin |
| `--list-ptx` | 列出嵌入 PTX |
| `--dump-elf` | 输出 CUDA ELF 内容 |
| `--dump-ptx` | 输出 PTX 文本 |
| `--dump-sass` | 反汇编并输出 SASS |
| `--dump-resource-usage` | 显示函数寄存器、Shared/Local/Constant Memory 等资源 |
| `--extract-elf` | 把匹配的 ELF/Cubin 提取到文件 |
| `--extract-ptx` | 把匹配的 PTX 提取到文件 |
| `--function` | 将操作限定到指定函数（版本支持时） |
| `--gpu-architecture` | 限定目标架构 |

部分选项提供短格式；为保证脚本可读性，自动化优先长选项，并固定 Toolkit 版本。

## 3. 验证 Fat Binary 架构

```bash
cuobjdump --list-elf ./app
cuobjdump --list-ptx ./app
```

检查：是否包含部署 GPU 对应 `sm_XX` Cubin；是否保留合适 `compute_XX` PTX；是否意外打包过多旧架构；插件/共享库中的 CUDA 代码是否也被覆盖。`no kernel image is available` 常能从这里发现架构缺口。

## 4. 查看资源与 SASS

```bash
cuobjdump --dump-resource-usage ./app
cuobjdump --dump-sass ./app
cuobjdump --dump-ptx ./app
```

资源数值用于提出假设：寄存器多可能限制 Occupancy，Local Memory 可能意味着 Spill，Shared Memory 可能限制并发 Block。但这些不是性能结论，需结合 Launch 配置、Nsight Compute 与实测。

## 5. 安全提取

```bash
mkdir extracted-cuda
cd extracted-cuda
cuobjdump --extract-elf all ../app
cuobjdump --extract-ptx all ../app
```

实际通配符/表达式语法以 `--help` 为准。使用新目录避免覆盖同名文件；提取物可能包含知识产权、Kernel 名和实现细节，不应上传公共服务。

## 6. cuobjdump 与 nvdisasm 的分工

`cuobjdump` 擅长从 Host Binary/Fatbin 中**找到并提取** CUDA 对象；`nvdisasm` 面向独立 Cubin 做更深入的 SASS 控制流和指令分析。常见链路是：`cuobjdump --extract-elf → nvdisasm`。

## 7. 常见问题

| 现象 | 原因与下一步 |
|---|---|
| 看不到 PTX | 构建只打包 Cubin，或 CUDA 代码在另一共享库/插件中 |
| 看不到目标架构 | `nvcc -gencode`/构建系统架构配置遗漏 |
| 函数名难读 | C++ name mangling；结合 `c++filt` 和函数过滤 |
| 资源与 NCU 不同 | 编译变体、动态 Shared Memory、实际加载 Binary 或指标口径不同 |
| 工具拒绝文件 | 文件不是支持格式、被压缩/封装、Toolkit 太旧或 Binary 损坏 |

## 8. 掌握标准

能证明一个发布包包含哪些 Cubin/PTX 架构；能提取目标 Cubin；能解释资源报告只是静态证据；能从运行时报错反向核查实际 Binary，而不是只看构建日志。

## 9. 官方参考 {/* #官方参考 */}

- [CUDA Binary Utilities](https://docs.nvidia.com/cuda/cuda-binary-utilities/)
