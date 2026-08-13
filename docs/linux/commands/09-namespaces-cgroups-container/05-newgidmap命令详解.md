---
title: newgidmap 命令详解：GID 映射、subgid 与 setgroups 安全门
sidebar_position: 5
description: 讲清 newgidmap 三元组、subgid 委派、setgroups=deny、一次性 gid_map 写入和 Rootless 容器组权限排障。
tags: [Linux, newgidmap, User Namespace, subgid, Rootless]
---

# `newgidmap` 命令详解：GID 映射、subgid 与 `setgroups` 安全门

`newgidmap` 验证 `/etc/subgid` 或 NSS subid 委派后写入 `/proc/PID/gid_map`。它与 `newuidmap` 的三元组相同，但多了一条重要安全边界：非特权映射通常要先向 `/proc/PID/setgroups` 写入 `deny`，防止进程通过补充组获得本不应拥有的文件访问权。

## 1. 语法与全部参数

```text
newgidmap PID GID_INSIDE GID_OUTSIDE COUNT [GID_INSIDE GID_OUTSIDE COUNT ...]
newgidmap fd:N GID_INSIDE GID_OUTSIDE COUNT [...]
```

命令没有选项。每组三元组依次是 Namespace 内起点、父 User Namespace 起点和连续数量；内层区间不能重叠，所有外层 GID 都要经过委派验证。`fd:N` 形式用于降低 PID 重用竞态。

```text
/etc/subgid: alice:200000:65536
newgidmap PID 0 1000 1 1 200000 65536
```

## 2. 为什么必须理解 `setgroups`

```bash
cat /proc/$pid/setgroups
printf 'deny\n' > /proc/$pid/setgroups
newgidmap "$pid" 0 "$(id -g)" 1 1 200000 65536
```

一旦写入 `deny` 便不能改回 `allow`。之后该 User Namespace 中的进程不能调用 `setgroups(2)`，但可使用已映射的 real/effective/saved GID。现代 `unshare --map-group` 会处理这个顺序，手工工具链需要调用者协调。

## 3. 诊断证据链

```bash
getent subgid alice
cat /proc/$pid/gid_map
cat /proc/$pid/setgroups
grep -E '^(Gid|Groups):' /proc/$pid/status
stat -c '%u:%g %n' /path/in/rootfs
```

| 现象 | 常见根因 |
|---|---|
| 写 `gid_map` 返回 EPERM | 未先禁止 setgroups、目标已映射、缺少父 Namespace 权限 |
| `range not allowed` | subgid 未委派、范围只覆盖了一部分或 NSS 子 ID 不一致 |
| 容器内无法访问组共享目录 | 文件 GID 未映射、补充组被清空、ACL 或 LSM 仍拒绝 |
| 目录显示溢出 GID | 映射有空洞或挂载所有权与映射设计不一致 |

subgid 是授权数据，不是随意选择的数字池。变更前检查是否与其他用户重叠，并评估现有 Rootless 容器的文件所有权。

## 4. 掌握标准与参考

能够解释为何 UID 映射成功而组权限仍失败；能把 `gid_map`、`setgroups`、补充组、DAC/ACL/LSM 分层验证。

- [shadow-utils：newgidmap(1)](https://man7.org/linux/man-pages/man1/newgidmap.1.html)
- [Linux：user_namespaces(7)](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)

下一篇：[setpriv 命令详解](./06-setpriv命令详解.md)。
