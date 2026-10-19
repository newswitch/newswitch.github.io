---
title: "CDI 设备规范、刷新机制与容器权限边界"
sidebar_label: "04. CDI 规范与刷新"
sidebar_position: 4
description: "理解 CDI 设备身份如何变成 OCI 配置，以及 MIG 变化、陈旧规范、重复注入和资源分配之间的边界。"
tags: [GPU, CDI, Container Toolkit, 容器, MIG]
---

# CDI 设备规范、刷新机制与容器权限边界

CDI（Container Device Interface）解决的是“运行时怎样把一个具名设备注入容器”。它不负责判断谁有权获得 GPU，也不替代调度器、Device Plugin 或设备 cgroup。把设备名、分配结果与访问权限分清，才能理解容器为什么会看见错误设备。

## 1. 一份规范如何影响容器

CDI 的基本关系是：设备提供者生成规范，容器请求合格设备名，支持 CDI 的运行时查找对应定义，再把设备节点、挂载、环境或 hook 等编辑应用到 OCI 配置。具体字段由规范版本和实现决定。参见 [CDI 规范仓库](https://github.com/cncf-tags/container-device-interface)。

```text
硬件与驱动当前状态 → 设备规范
调度与设备分配结果 → 请求的 CDI 名称
名称查找与 OCI 编辑 → 创建容器 → 设备访问与 CUDA 验证
```

规范生成和请求产生是两条不同链路。第一条知道设备长什么样，第二条决定把哪个设备交给工作负载。仅生成 `nvidia.com/gpu=all` 一类定义，不等于所有 Pod 已获得 GPU，也不意味着运行时会替平台做租户鉴权。

## 2. 持久规范与即时生成不要混为一谈

持久规范保存在运行时扫描的目录中，适合原生 CDI 使用者直接引用；NVIDIA 运行时的较新实现还提供 JIT-CDI 路径，在内存中即时生成规范。两者的故障证据不同：前者重点检查文件和刷新时间，后者重点检查运行时模式、发现结果与创建容器日志。不能因为磁盘上没有 YAML，就认定所有模式都没有 GPU 支持。

NVIDIA Toolkit 自 1.18 起提供 `nvidia-cdi-refresh` 自动刷新机制，持久输出通常为 `/var/run/cdi/nvidia.yaml`。当前文档明确说明：驱动移除和 MIG 重配置不能完全依赖自动触发，需要显式重新生成。上述行为与 JIT-CDI 的适用版本应分别核对，见 [NVIDIA CDI 支持说明](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/cdi-support.html)。

## 3. MIG 变化为什么会使旧文件失效

假设节点原来有一组 MIG 实例，设备规范保存了这些实例对应的身份和设备编辑。管理员重建实例后，即使显存规格看起来一样，旧身份也不能被当成新实例的稳定标识。

此时有三种状态需要分别收敛：硬件布局、规范库存、调度器公布的资源。只更新其中一个，就可能出现“资源数量正确，但请求的设备名称不存在”，或者“文件可解析，但里面的节点已失效”。

安全的维护顺序是先停止向目标节点派发受影响任务，处理现有任务，再调整硬件布局，重新发现并刷新规范和资源库存，最后用新分配验证容器。刷新文件本身不会把已有进程的文件描述符、挂载与 CUDA 上下文迁移到新设备；成功创建新容器也不能证明旧任务不受影响。

## 4. systemd 显示 inactive 不一定是刷新失败

刷新链路包含负责触发的 path 单元和执行生成的 oneshot service。oneshot 成功退出后可以显示 `inactive (dead)`，因此判断应看最近执行结果、日志和新规范，而不是要求 service 一直运行。

下面是 Linux 上的只读检查，不会变更 MIG 或重启业务：

```bash
systemctl status nvidia-cdi-refresh.path nvidia-cdi-refresh.service
journalctl -u nvidia-cdi-refresh.service --no-pager -n 100
nvidia-ctk --debug cdi list
```

检查时同时看 `/etc/cdi` 和 `/var/run/cdi` 等实际扫描目录。管理员手工留下的旧规范可能与自动生成结果冲突；应先确定文件生产者与名称冲突，再处理明确的旧文件，不要把整个目录当缓存清空。

## 5. 双重注入为什么不是双重保险

原生 CDI 与 legacy NVIDIA OCI hook 是不同设备注入路径。若二者同时编辑同一个容器，可能产生重复挂载或不一致的设备视图。反过来，选择 NVIDIA runtime 的 CDI 模式，并不等于必须再加 legacy hook。

诊断时应回答三个问题：谁读取设备请求，谁修改 OCI spec，最终修改了什么。只检查 `NVIDIA_VISIBLE_DEVICES` 无法覆盖所有 CDI 模式，因为原生运行时可以从另一种请求接口获得 CDI 名称。Kubernetes 的资源请求与 CDI 名称之间的传递，继续阅读 [Device Plugin 与 Container Toolkit](../cluster/device-management/03-Pod如何使用上GPU：Device%20Plugin与Container%20Toolkit.md)。

权限边界也要分别验证：容器中的设备节点存在，只证明路径可见；进程还需要允许的设备访问、合适的驱动库和对应的运行环境。把容器改成 privileged 可能掩盖边界错误，却不能解释原来的分配为什么失败。

## 6. 三个故障推演

| 现象 | 可证伪的假设 | 下一条证据 |
| --- | --- | --- |
| 名称无法解析 | 请求和规范库存不同步 | 请求原文、规范中的设备名、生成时间 |
| 名称存在但创建失败 | 编辑冲突或设备节点已变化 | OCI 创建错误、hook 列表、宿主机设备现状 |
| 新容器正常，旧容器失败 | 旧上下文仍引用变更前设备 | 任务创建时间、MIG 变更时间、上下文错误 |

不要用“CDI 坏了”概括所有现象。名称解析失败发生在运行 GPU 程序之前；CUDA 初始化失败则需要继续检查实际注入结果。

## 7. 掌握检查

请解释：为什么 CDI 名称不是排他锁；为什么成功刷新文件不能修复已运行任务；为什么 oneshot 处于 inactive 仍可能正常；为什么 MIG 数量不变仍可能需要刷新身份。

如果能给一张节点画出“硬件状态—规范—分配—OCI—进程”的五层证据链，就具备了排查能力。实际生产变更仍应按平台版本验证自动触发条件，而不是照搬另一台机器的服务状态。
