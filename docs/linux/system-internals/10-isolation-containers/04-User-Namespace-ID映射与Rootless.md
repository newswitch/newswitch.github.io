---
title: "User Namespace、UID/GID 映射与 Rootless：容器内 root 到底是谁"
sidebar_label: "04. User Namespace 与 Rootless"
sidebar_position: 4
description: "理解 kuid/kgid、uid_map/gid_map、capability 作用域、subuid/subgid 和无根容器限制。"
tags: [Linux, User Namespace, Rootless, UID Map, Capability]
---

# User Namespace、UID/GID 映射与 Rootless：容器内 root 到底是谁

User Namespace 虚拟化身份和 capability 作用域。容器内 UID 0 可以映射为宿主机普通 UID，因此它在自己的 Namespace 内拥有部分特权，却不自动拥有初始 User Namespace 的系统级特权。

## 1. 映射示例

```text
inside UID 0..65535
        │ uid_map: 0 100000 65536
host UID 100000..165535
```

```bash
cat /proc/<PID>/uid_map
cat /proc/<PID>/gid_map
readlink /proc/<PID>/ns/user
grep "^$(id -un):" /etc/subuid /etc/subgid
```

一行三个数分别为 Namespace 内起点、父 Namespace 起点和长度。映射必须满足内核权限规则，`newuidmap/newgidmap` 以受控 setuid helper 使用预分配范围。

## 2. Capability 有作用域

进程在自己的 User Namespace 拥有 `CAP_SYS_ADMIN`，只对由该 Namespace 管辖的对象生效；不能因此任意操作宿主设备或初始 Namespace 挂载。

但内核攻击面仍存在：允许非特权用户创建 User Namespace 会开放更多 namespaced 内核接口，因此某些环境会限制它。

## 3. 文件所有权

内核内部使用 kuid/kgid 表达相对于 User Namespace 的 ID。一个文件在宿主显示 UID 100000，在容器内可显示 UID 0。未映射 ID 通常显示 overflow 值，且权限判断可能失败。

idmapped mount 可让挂载视图应用 ID 映射，减少递归 `chown`，但需要文件系统与内核支持，语义不同于简单改 inode owner。

## 4. Rootless 容器限制

Rootless 运行时可创建 User/Mount/PID 等 Namespace，但通常不能直接：

- 配置宿主真实网络设备和低层防火墙。
- 挂载任意宿主文件系统或访问真实块设备。
- 使用需要初始 User Namespace capability 的功能。

因此常借助用户态网络、FUSE、受控 helper 或 systemd user service，性能和功能要单独评估。

## 5. 练习与答案

**问题：容器内 `id` 显示 root，是否能 `kill` 宿主任意进程？**

答案：不能。宿主进程通常不可见，信号权限按目标和调用者 credential/User Namespace 关系检查。

**问题：User Namespace 是否让内核漏洞无效？**

答案：不会。容器仍共享宿主内核；它缩小正常权限，但可达内核接口本身也需要补丁、seccomp 和 LSM 等防护。

下一篇：[Network、UTS、IPC、Time 与 cgroup Namespace](./05-其他Namespace及其边界.md)
