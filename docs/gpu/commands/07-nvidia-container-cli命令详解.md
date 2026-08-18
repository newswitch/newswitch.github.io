---
title: "nvidia-container-cli 命令详解：容器 GPU 注入链路诊断"
sidebar_label: "07. nvidia-container-cli 命令详解：容器 GPU 注入链路诊断"
sidebar_position: 7
description: "使用 nvidia-container-cli 查看驱动、GPU、库与容器注入信息，定位宿主机正常但容器不可见 GPU 的问题。"
tags: [GPU, NVIDIA Container Toolkit, nvidia-container-cli, 容器, 故障排查]
---

# nvidia-container-cli 命令详解：容器 GPU 注入链路诊断

`nvidia-container-cli` 是 `libnvidia-container` 的底层 CLI。OCI runtime hook 和 Toolkit 通过它发现 GPU、选择驱动能力，并向容器注入设备节点、库和挂载。日常配置优先使用 `nvidia-ctk`；本命令主要用于底层诊断。

## 1. 版本与信息查询 `[R]`

```bash
nvidia-container-cli --version
nvidia-container-cli --help
nvidia-container-cli info --help
sudo nvidia-container-cli info
```

`info` 可显示 NVRM/CUDA 兼容信息、GPU Index、Device Minor、Model、Brand、UUID、Bus Location 和 Architecture。字段随版本变化，自动化应优先使用稳定接口或 CDI，而不是解析面向人的文本。

## 2. 命令结构

```text
nvidia-container-cli [global-options] <command> [command-options]

info       查询宿主机驱动和 GPU
configure  将设备、库、二进制和能力注入目标容器根文件系统
list       列出可注入资源（版本支持时）
```

常见全局参数族包括日志文件/级别、root 路径、ldconfig 路径和用户设置。`configure` 还涉及设备选择、驱动 capabilities、容器 PID/rootfs、cgroup 与兼容性约束。它是内部接口，精确选项必须以当前版本 `--help` 为准。

## 3. 只读诊断顺序

```bash
# 宿主机驱动
nvidia-smi -L

# libnvidia-container 看到的设备
sudo nvidia-container-cli info

# Toolkit/CDI 看到的设备
nvidia-ctk cdi list

# 运行时最终效果
docker run --rm --gpus all nvidia/cuda:<已验证标签> nvidia-smi
```

比较三个层次：NVML 能看到什么、libnvidia-container 能发现什么、容器里实际得到什么。第一层失败先修驱动；第二层失败查库/权限；只有第三层失败才重点查 runtime 配置。

## 4. 驱动能力选择

Toolkit 常用能力概念包括 `compute`、`utility`、`graphics`、`display`、`video`、`compat32`。例如 CUDA 计算通常需要 `compute`，容器内运行 `nvidia-smi` 需要 `utility`。能力越宽，注入的库和攻击面越大；按工作负载最小授权。

环境变量常见入口：

```text
NVIDIA_VISIBLE_DEVICES
NVIDIA_DRIVER_CAPABILITIES
NVIDIA_REQUIRE_CUDA
```

变量最终如何转换为 CLI 参数取决于 Toolkit/runtime 集成。不要只检查变量字符串，还要检查实际设备节点和挂载。

## 5. 为什么不手工运行 configure

`configure` 会对目标容器 rootfs、namespace、cgroup 和挂载进行修改，且通常需要高权限；传错 rootfs/PID 可能污染错误目标。生产诊断优先开启 Toolkit debug 日志、使用 `info`、检查 OCI 配置/CDI spec。只有在隔离实验环境复现底层 runtime 调用时，才按当前官方文档构造命令。

## 6. 故障定位表

| 现象 | 证据与解释 |
|---|---|
| `info` 报 NVRM 错误 | 驱动模块、用户态库、设备节点或权限问题 |
| `info` 可见但容器无 GPU | runtime 未配置、设备请求/CDI 名称错误、hook 未执行 |
| 容器有设备但缺 `libcuda.so` | driver capability 或库挂载/ldcache 问题 |
| `CUDA driver version is insufficient` | 应用/Toolkit 需求高于宿主机驱动能力，不能靠挂更多库解决 |
| 只在 root 下成功 | 节点、Socket、CDI 文件或 runtime 的权限策略有误 |
| MIG 实例选择错误 | UUID/CDI 设备名和当前 MIG 配置是否一致，配置是否已刷新 |

## 7. 安全边界

`info` 主要是只读查询 `[R]`，但会暴露 GPU UUID、Bus ID、驱动和系统路径，外发前仍要审查。`configure` 会修改目标容器的挂载、设备和 cgroup `[W]`，只应由受控 Runtime 链路调用；不要把宿主机根目录、错误 PID 或业务容器 rootfs 作为实验目标。调试日志也可能带有容器环境变量和内部路径。

## 8. 日志与证据

保存 Toolkit、`libnvidia-container`、runtime 和驱动版本；保存 `nvidia-container-cli info`、CDI spec、OCI runtime 配置、容器请求和运行时日志。敏感日志可能包含路径、环境变量和容器信息，传出前审查。

## 9. 掌握标准

能画出 Runtime → hook/CDI → libnvidia-container → 设备节点/驱动库的链路；能用 `info` 判定发现层是否健康；能解释“看得到 `/dev/nvidia0`”为什么仍不代表 CUDA 可用；不会把底层 `configure` 当普通业务命令。

## 10. 官方参考 {/* #官方参考 */}

- [libnvidia-container repository](https://github.com/NVIDIA/libnvidia-container)
- [NVIDIA Container Toolkit Architecture Overview](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/arch-overview.html)
