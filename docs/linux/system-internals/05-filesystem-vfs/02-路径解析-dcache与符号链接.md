---
title: "路径解析、dcache 与符号链接：open 如何找到目标 inode"
sidebar_label: "02. 路径解析、dcache 与符号链接"
sidebar_position: 2
description: "分析绝对/相对路径、目录搜索权限、挂载点、dcache、符号链接、RCU-walk 与 TOCTOU。"
tags: [Linux, Path Walk, dcache, Symbolic Link, openat2]
---

# 路径解析、dcache 与符号链接：open 如何找到目标 inode

`open("/a/b/c")` 不是拿一个字符串查全局表。内核从起点开始逐组件遍历目录层次，处理挂载点、符号链接、权限和 Namespace，最后得到 dentry、inode 和打开实例。

## 1. 解析起点

- 绝对路径从当前进程根目录开始；chroot/Mount Namespace 可改变这个根。
- 相对路径从当前工作目录，或 `openat()` 指定的目录 fd 开始。
- `..` 受进程根和挂载边界约束，不是简单字符串删除上一段。

`openat/openat2` 让程序以稳定目录 fd 为锚点，减少全局工作目录变化和路径竞争。

## 2. 逐组件解析

```text
/srv/models/qwen/config.json
→ 从进程 root 开始
→ 查找 srv 并检查目录搜索权限
→ 处理是否跨挂载点
→ 查找 models
→ 查找 qwen
→ 解析最终组件 config.json
→ 根据 open flags 创建/打开/拒绝
```

目录的执行位代表搜索/穿越权限；拥有文件读权限但缺少任一父目录搜索权限，仍无法通过该路径打开。

## 3. dcache 与 Negative dentry

dcache 缓存“父 dentry + 名称”的查找结果：

- Positive dentry 关联 inode。
- Negative dentry 记录当前查找不到该名称。

缓存命中可以避免读取目录数据，但远端文件系统仍可能需要重新验证一致性。Negative dentry 也有失效规则，不能永久证明文件不存在。

Linux 路径查找可使用 RCU-walk 在少锁条件下快速遍历；遇到需要阻塞、重验证或复杂情况时回退到持引用/加锁路径。理解这一点有助于认识高并发路径查找为何强调对象生命周期和重试。

## 4. 符号链接解析

符号链接保存路径文本：

- 绝对目标从进程根重新解析。
- 相对目标相对符号链接所在目录解析。
- 中间组件和最终组件是否跟随受系统调用和 flag 影响。
- 内核限制递归解析次数，防止循环。

```bash
namei -l /srv/models/current/config.json
readlink /srv/models/current
readlink -f /srv/models/current/config.json
```

`readlink -f` 是用户态规范化结果，可能因权限、并发 rename 或路径不存在而与另一次内核 open 不完全相同。

## 5. Mount 如何进入路径

路径走到挂载点 dentry 时，会切换到该 mount 的根。Bind Mount 可让同一目录树从另一位置出现；Mount Namespace 决定当前进程可见哪套 mount 拓扑。

因此宿主机 `/data/model` 与容器 `/models` 可能是同一底层对象，也可能被 OverlayFS、subPath 或另一个挂载覆盖，不能只比较字符串。

## 6. TOCTOU 风险

经典错误：

```text
先 stat(path) 检查
→ 攻击者在间隙替换符号链接/目录项
→ 再 open(path) 使用了不同对象
```

应优先使用 fd 相对操作、`O_NOFOLLOW`、`openat2` 的解析限制以及打开后对 fd 做 `fstat`，避免把两次路径解析当作原子操作。

## 7. 观察与排障

```bash
namei -om /path/to/file
strace -yy -e trace=openat,openat2,newfstatat,readlink -- <command>
findmnt -T /path/to/file
lsns -t mnt
```

`ENOENT` 可能是任一中间组件、符号链接目标或解释器不存在；`EACCES` 可能来自父目录搜索权限；`ELOOP` 常与符号链接循环/上限相关。

## 8. 练习与答案

**问题：文件本身是 0644，为什么普通用户仍打不开？**

答案：路径上某个父目录可能没有搜索执行权限，Mount/LSM 也可能拒绝。必须逐层检查而不是只看最终文件 mode。

**问题：为什么安全程序应优先围绕目录 fd 操作？**

答案：目录 fd 提供稳定锚点，配合 `openat2` 等可限制符号链接和越界解析，减少路径在检查与使用之间被替换的竞争。

下一篇：[文件描述符与打开文件生命周期](./03-文件描述符与打开文件生命周期.md)
