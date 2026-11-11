---
title: "showmount 命令详解：mountd 查询与 NFSv3/NFSv4 边界"
sidebar_label: "18. showmount 命令详解：mountd 查询与 NFSv3/NFSv4 边界"
sidebar_position: 18
description: "讲解 showmount 参数、MOUNT protocol、导出与客户端列表、端口可达性、NFSv4 限制、信息泄露和常见错误排查。"
tags: [Linux, NFS, showmount, mountd, RPC]
---

# showmount 命令详解：mountd 查询与 NFSv3/NFSv4 边界

`showmount` 查询远端 mount daemon 的 MOUNT protocol。它主要反映 NFSv2/v3 时代的 export/mount 记录，不是 NFSv4 服务是否正常的最终检测器。

## 1. 语法与参数

```bash
showmount --version
showmount [OPTION]... [HOST]
```

| 参数 | 作用 |
|---|---|
| `-e, --exports` | 显示 export list |
| `-a, --all` | 显示 `client:directory` mount 记录 |
| `-d, --directories` | 只显示被客户端挂载的目录 |
| `--no-headers` | 不显示标题 |
| `-h, --help` | 帮助 |
| `-v, --version` | 版本 |

```bash
showmount -e nfs.example.com
showmount -a nfs.example.com
```

## 2. 协议边界

NFSv3 常涉及：

```text
rpcbind(111) → mountd(动态/固定端口) → nfsd(2049)
```

NFSv4 核心文件操作通常只需 TCP 2049，并使用 pseudo filesystem，不要求客户端调用 MOUNT protocol。因此：

- NFSv4-only server 可能正确工作，但 `showmount -e` 失败或列表不完整；
- `showmount -e` 成功不证明 2049、身份映射、文件权限和实际 I/O 正常；
- mount record 并不是可靠的“当前在线客户端”清单，客户端可能未主动 umount 或记录已过期。

## 3. 正确的联合检查

服务端：

```bash
exportfs -v
rpcinfo -p localhost
ss -lntup | grep -E ':111|:2049'
```

客户端：

```bash
rpcinfo -T tcp server.example.com nfs 4
mount -v -t nfs4 -o ro server.example.com:/ /mnt/nfs-test
nfsstat -m
```

不要为了测试在生产随意挂载 root export；使用批准的只读测试导出和临时 mountpoint。

## 4. 超时和错误

- `RPC: Program not registered`：mountd 未注册、NFSv4-only、rpcbind/端口或服务未启动。
- `RPC: Timed out`：网络、防火墙、NAT、动态 mountd 端口或 server 过载。
- 列表为空：不等于没有 export；查 `exportfs -v` 和 NFSv4 pseudo tree。
- hostname 很慢：反向 DNS/名称解析，使用 IP 做对照但最终仍需核对身份策略。

## 5. 安全

showmount 会主动访问远端 RPC 服务；export/client 列表可能泄露目录结构和客户端名称。限制 rpcbind/mountd 管理面访问，不要把“隐藏 showmount”误当成 NFS 授权；真正安全依赖网络边界、export rule、身份映射和 Kerberos/TLS 等机制。

完成标准：知道 showmount 观察的是 MOUNT protocol，能解释 NFSv4-only 下的假阴性，并会用 exportfs/rpcinfo/真实只读 mount 联合验证。

参考：[nfs-utils 上游](https://www.kernel.org/pub/linux/utils/nfs-utils/)与本机 `man showmount`。
