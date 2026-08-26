---
title: "seccomp、AppArmor、容器沙箱与设备访问控制"
sidebar_label: "06. 容器沙箱与设备控制"
sidebar_position: 6
description: "从 Linux 权限模型理解 AI 容器的 Syscall、文件、Capability、HostPath 与 GPU/RDMA 设备访问边界。"
tags: [seccomp, AppArmor, 容器安全, GPU, Device]
---

# seccomp、AppArmor、容器沙箱与设备访问控制

## 1. 容器不是虚拟机边界

容器共享宿主 Kernel。一个训练镜像可能包含编译器、Shell、Notebook 和任意 Python 代码，因此应按不受信任应用管理，而不是因为“内部模型”就授予 Privileged。

## 2. 权限层次

```text
User Namespace / UID
→ Linux Capability
→ seccomp Syscall
→ AppArmor/SELinux 文件与行为
→ Namespace/cgroup
→ Device节点与ioctl
→ HostPath/Socket/Kernel接口
```

任何一层放开都可能扩大其他层攻击面。

## 3. Pod 安全基线

- `runAsNonRoot` 与固定 UID/GID；
- `allowPrivilegeEscalation: false`；
- Drop All Capabilities，只添加必要项；
- `readOnlyRootFilesystem`，为缓存和 `/tmp` 单独挂载；
- 使用 RuntimeDefault seccomp 起步；
- 禁止 HostPID、HostIPC、HostNetwork，除非有明确技术需要；
- 禁止任意 HostPath 和容器 Runtime Socket；
- 限制 Proc Mount、Sysctl 和 Device。

GPU Runtime 需要设备和部分宿主库，不代表需要 Privileged。

## 4. seccomp 与 AppArmor

seccomp 过滤系统调用及参数范围，AppArmor/SELinux 约束文件、Capability、网络等行为。训练框架可能使用 `clone3`、`perf_event_open`、共享内存或调试接口，策略应在测试环境通过 Audit 生成，再收敛允许集。

遇到 Permission Denied 时不能直接改成 Unconfined；先关联 Audit Log、Syscall、进程和实际功能。

## 5. GPU 与 RDMA Device

设备插件将 `/dev/nvidia*`、Ascend Device、RDMA Character Device 等注入容器。要确认：

- 只暴露已分配设备；
- 容器内 Device Major/Minor 与 cgroup Allow List；
- 管理设备是否会扩大到全部 GPU；
- `/sys`、DebugFS、Fabric Manager Socket 是否必要；
- RDMA Device 与 VF/IOMMU 匹配。

## 6. 沙箱 Runtime

gVisor、Kata 等可以增强隔离，但 GPU/RDMA 直通、性能和驱动支持需要验证。不是所有训练负载都适合通用沙箱。高信任差异可通过独立节点池/虚拟机实现更强边界。

## 7. 安全测试

验证业务正常路径以及拒绝路径：读取宿主文件、访问其他 Device、创建 Raw Socket、使用 ptrace、挂载文件系统、访问 Runtime Socket。测试在隔离环境执行，并确保策略变更有版本和回滚。

参考：[Kubernetes Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/)、[Kubernetes seccomp](https://kubernetes.io/docs/tutorials/security/seccomp/)、[AppArmor](https://apparmor.net/)。
