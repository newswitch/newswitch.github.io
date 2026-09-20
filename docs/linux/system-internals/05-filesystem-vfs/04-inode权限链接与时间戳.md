---
title: "inode、权限、链接与时间戳：文件元数据如何决定访问和生命周期"
sidebar_label: "04. inode、权限、链接与时间戳"
sidebar_position: 4
description: "解释 inode mode、目录权限、硬链接、符号链接、umask、ACL、时间戳和 rename 原子边界。"
tags: [Linux, inode, 权限, Hard Link, ACL]
---

# inode、权限、链接与时间戳：文件元数据如何决定访问和生命周期

文件名属于目录项，inode 保存对象元数据。理解这一点，就能解释硬链接为何没有“原始文件”、rename 为什么通常不搬运数据，以及删除名称后打开进程为何仍能读写。

## 1. inode 保存什么

典型元数据包括：

- 文件类型与 mode 权限位。
- UID、GID。
- 文件大小和块分配信息。
- 硬链接计数。
- atime、mtime、ctime、btime（若文件系统支持）。
- ACL、xattr 和安全标签的关联。

文件名由父目录数据保存，不是 inode 的固有字段。

## 2. 文件和目录权限语义不同

| 权限 | 普通文件 | 目录 |
|---|---|---|
| read | 读取内容 | 列出目录项名称 |
| write | 修改内容 | 创建、删除、重命名目录项（还受其他规则影响） |
| execute | 作为程序执行 | 搜索/穿越路径 |

删除文件通常检查父目录权限，而不是要求对文件内容有写权限。Sticky Bit 目录（如 `/tmp`）进一步限制谁能删除或重命名其中条目。

## 3. umask 和默认权限

umask 从应用请求的 mode 中屏蔽权限；它不会给权限做简单十进制减法。目录和文件的初始请求 mode 通常不同，默认 ACL 还会参与结果计算。

```bash
umask
stat -c '%A %a %U:%G %n' /path
getfacl -p /path
```

ACL 可能让 `ls -l` 的三组位不足以解释最终访问，尾部 `+` 常提示存在扩展 ACL。

## 4. 硬链接与符号链接

```text
硬链接：dentry A ─┐
                  ├→ inode X
        dentry B ─┘

符号链接：dentry L → inode L（内容是目标路径）→ 再次路径解析
```

硬链接通常不能跨文件系统，因为 inode 属于具体文件系统；普通用户也不能随意给目录建立硬链接，以避免目录图出现循环和安全问题。

## 5. rename 的原子边界

同一文件系统中的 rename 通常对目录项切换提供原子可见性：观察者看到旧名或新名，不应看到半个名字。它不自动保证内容和目录项已落到持久介质，也不保证跨文件系统 rename。

常见安全发布模式：

```text
写临时文件
→ fsync 临时文件
→ rename 到目标名
→ 按一致性要求 fsync 父目录
```

实际保证取决于文件系统和应用协议，不能只说“rename 原子所以绝不会丢”。

## 6. 四类时间戳

- mtime：文件内容最后修改时间。
- ctime：inode 状态变化时间，不是创建时间。
- atime：最后访问时间，受 noatime/relatime 等策略影响。
- btime：创建时间，仅在文件系统和工具支持时可用。

修改权限会更新 ctime，不一定更新 mtime。备份与增量同步不能把 ctime 当创建时间。

## 7. 权限检查不止 mode

完整访问还可能受：

- ACL。
- Capability 和进程凭证。
- SELinux/AppArmor 等 LSM。
- 只读/noexec/nosuid 等挂载选项。
- idmapped mount、User Namespace。
- immutable/append-only inode flag。

```bash
namei -om /path
getfacl -p /path
lsattr /path
findmnt -T /path -o TARGET,FSTYPE,OPTIONS
```

## 8. 练习与答案

**问题：文件 mode 为 0444，用户为何仍可能删除它？**

答案：删除是修改父目录项，主要由父目录写和搜索权限、Sticky Bit、LSM 及 inode flag 等决定，不是文件内容写权限。

**问题：ctime 是创建时间吗？**

答案：不是。ctime 是 inode 状态变化时间；创建时间若支持通常称 btime/birth time。

下一篇：[Buffered Read 与预读](./05-Buffered-Read与预读.md)
