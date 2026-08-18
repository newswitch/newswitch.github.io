---
title: "exportfs 命令详解：NFS 导出表、选项与安全重载"
sidebar_label: "17. exportfs 命令详解：NFS 导出表、选项与安全重载"
sidebar_position: 17
description: "以 nfs-utils 2.9.1 为基线，讲解 exportfs 与 exports、etab、参数、客户端匹配、root_squash、subtree_check、fsid、重载和排障。"
tags: [Linux, NFS, exportfs, nfs-utils, RPC]
---

# exportfs 命令详解：NFS 导出表、选项与安全重载

`exportfs` 维护 NFS server 的有效导出表。`/etc/exports` 和 `/etc/exports.d/*.exports` 是配置输入，内核/nfsd 实际状态由 nfs-utils 处理并记录在运行表中；“文件改了”不等于“导出已生效”。

## 1. 三层对象

```text
exports 配置 → exportfs 解析/etab → kernel nfsd 对客户端提供 filehandle
```

```bash
exportfs --version
exportfs -v
systemctl status nfs-server --no-pager
```

本文按 nfs-utils 2.9.1。

## 2. 参数

| 参数 | 作用与风险 |
|---|---|
| `-a, --all` | 作用于全部导出 |
| `-r, --reexport` | 重新同步 exports，删除已移除项并更新已有项 |
| `-u, --unexport` | 取消导出 `[host:]path` |
| `-i, --ignore` | 忽略 exports 文件，只用命令行选项 |
| `-o, --options OPTS` | 指定导出选项 |
| `-v, --verbose` | 查询时显示选项；变更时详细输出 |
| `-f, --flush` | 刷新 kernel export table，通常要求 nfsd 已挂载 |
| `-s, --state-directory PATH` | 指定状态目录 |
| `-h, --help` | 帮助 |

常用动作：

```bash
exportfs -v                 # [R]
exportfs -rav               # [W] 重载全部
exportfs -u client:/srv/x   # [W] 取消一项
```

`-r` 会影响现有导出集合；生产先 diff 配置、验证客户端匹配，再重载。

## 3. exports 语法

```exports
/srv/models 10.20.0.0/16(ro,sync,root_squash,sec=sys)
/srv/train  @trainers(rw,sync,root_squash)
```

路径与客户端之间必须有空格；客户端与括号之间通常不能插入空格，否则语义可能改变。客户端可为 hostname、通配、netgroup、CIDR 等，但 DNS/反向解析会引入身份与可用性风险。

关键选项：

| 选项 | 语义 |
|---|---|
| `ro/rw` | 只读/读写 |
| `sync/async` | 回复前提交稳定存储与否；async 有数据风险 |
| `root_squash` | remote uid 0 映射为匿名用户，默认安全基线 |
| `no_root_squash` | 保留 remote root，风险极高 |
| `all_squash` | 所有用户映射为匿名身份 |
| `anonuid/anongid` | 匿名 UID/GID |
| `subtree_check/no_subtree_check` | 子树 filehandle 检查与 rename/性能权衡 |
| `secure/insecure` | 是否要求传统 privileged source port，不是强认证 |
| `sec=sys/krb5/krb5i/krb5p` | 身份、完整性和隐私级别 |
| `fsid=` | 导出文件系统身份；NFSv4 pseudo root 常用 `fsid=0` |
| `crossmnt/nohide` | 跨子 mount 的可见性语义 |

## 4. 安全更新

```bash
cp --preserve=all /etc/exports /etc/exports.before-change
exportfs -v
exportfs -rav
exportfs -v
journalctl -u nfs-server --since '-5 min' --no-pager
```

变更应从独立客户端验证 mount、身份映射、读写、rename、lock 和重连。取消导出不会自动让所有已获得 filehandle 的客户端以同一种方式立即失败。

## 5. 故障排查

- access denied：最终 `exportfs -v`、客户端真实源 IP、NAT、sec flavor 和路径父级权限。
- stale file handle：文件系统/导出身份变化、failover fsid 不一致、目录替换。
- NFSv4 看不见子导出：pseudo root、crossmnt、路径和 server namespace。
- 重载后旧规则还在：检查配置分片、state/etab 和服务日志。
- 权限看似正确但写失败：UID/GID 映射、root_squash、ACL/SELinux、底层只读/满。

完成标准：能区分配置文件与有效导出表，能解释客户端匹配和 squash/security，并在重载前后保存差异与客户端验证证据。

参考：[nfs-utils 上游发布](https://www.kernel.org/pub/linux/utils/nfs-utils/)与本机 `man exportfs`、`man exports`。
