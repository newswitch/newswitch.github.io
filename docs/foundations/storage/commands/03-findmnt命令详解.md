---
title: findmnt 命令详解：挂载树、fstab、传播属性与配置验证
sidebar_position: 3
description: 讲解 findmnt 的内核 mountinfo、fstab/mtab 数据源、目标与源查询、树/JSON/轮询、选项匹配、传播关系、验证，以及容器挂载排障。
tags: [Linux, findmnt, mount, fstab, Namespace, util-linux]
---

# `findmnt` 命令详解：挂载树、fstab、传播属性与配置验证

`findmnt` 查询挂载表并结构化输出。它比解析 `mount` 文本或 `/proc/mounts` 更可靠，能够区分当前内核运行状态、`/etc/fstab` 期望和指定 namespace 的挂载视图。

## 1. 三份事实

```text
/proc/self/mountinfo  当前进程 mount namespace 的内核事实
/etc/fstab            开机/管理员期望，不保证已经生效
/etc/mtab             通常链接到 /proc/self/mounts，历史系统可能是普通文件
```

```bash
findmnt --version
findmnt
findmnt --fstab
findmnt --kernel
```

## 2. 选择数据源和对象

| 参数 | 作用 |
|---|---|
| `-k, --kernel` | 查询内核 mountinfo，通常为默认 |
| `-s, --fstab` | 查询 `/etc/fstab` |
| `-m, --mtab` | 查询 mtab |
| `-F, --tab-file file` | 使用指定 fstab/mtab 文件 |
| `-N, --task tid` | 查询目标进程 mount namespace |
| `-M, --mountpoint path` | 精确按挂载点匹配 |
| `-S, --source spec` | 按设备、UUID=、LABEL= 等 source 匹配 |
| `-T, --target path` | 找出包含该路径的文件系统 |
| `-t, --types list` | 按文件系统类型过滤；`no` 前缀可排除 |
| `-O, --options list` | 按 mount option 过滤 |
| `-U, --uniq` | 忽略目标重复项 |
| `-A, --all` | 关闭默认兼容过滤，显示全部 |
| `--real` | 只显示有真实 source 的文件系统 |
| `--pseudo` | 只显示 pseudo filesystems |

`-M` 是“这个路径就是 mountpoint”，`-T` 是“这个普通路径属于哪个 mount”，两者不要混用。

## 3. 输出、树和验证参数

| 参数 | 作用 |
|---|---|
| `-o, --output list` | 指定 TARGET/SOURCE/FSTYPE/OPTIONS/PROPAGATION 等列 |
| `-J, --json` | JSON 输出 |
| `-P, --pairs` | key-value pairs |
| `-r, --raw` | 原始输出 |
| `-n, --noheadings` | 去标题 |
| `-l, --list` | 平铺输出 |
| `-R, --submounts` | 包含目标下所有子挂载 |
| `--shadowed` | 显示被同一位置后续 mount 遮蔽的条目 |
| `--evaluate` | 把 LABEL=/UUID= 转换成设备路径 |
| `--verify` | 验证 fstab 可解析性和可用性 |
| `--verbose` | 验证时给详细诊断 |
| `--df` | 类似 `df` 的空间列 |
| `--poll[=list]` | 监听 mount/umount/remount/move 事件 |
| `--first-only` | 只输出第一个匹配 |

版本还可能支持 smartcols filter/counter。脚本先运行 `findmnt --list-columns` 或 `--help` 获取本机列名。

## 4. 常用证据

```bash
# 路径属于谁
findmnt -T /var/lib/kubelet/pods -o TARGET,SOURCE,FSTYPE,OPTIONS,PROPAGATION

# fstab 是否正确，并解析 UUID
findmnt --verify --verbose
findmnt --fstab --evaluate -o TARGET,SOURCE,FSTYPE,OPTIONS

# 一个块设备挂到哪里
findmnt -S /dev/mapper/vg0-data

# 容器/Kubernetes 常见传播问题
findmnt -o TARGET,SOURCE,FSTYPE,OPTIONS,PROPAGATION /var/lib/kubelet

# 机器读取
findmnt --json --kernel --output TARGET,SOURCE,FSTYPE,OPTIONS,FSROOT
```

`SOURCE` 可能带 `[subvolume]`；overlay 会显示 lowerdir/upperdir/workdir；NFS source 是 `server:/export`。不要假定 source 总是 `/dev/...`。

## 5. Namespace 与传播

```bash
findmnt -N 1
findmnt -N "$(pgrep -n containerd)" -T /var/lib/containerd
```

`shared/slave/private/unbindable` 决定 mount 事件是否跨 namespace 传播。Kubernetes CSI “宿主机挂了、容器看不到”时，必须比较 kubelet 和目标进程 namespace，而不是重复执行 mount。

## 6. 常见误区

- fstab 有条目不等于已挂载；比较 `--fstab` 与 `--kernel`。
- `findmnt /path` 的位置参数匹配规则可能有歧义；脚本显式用 `-M/-T/-S`。
- bind mount 的 source/FSROOT 需要联合判断，不能只看 TARGET。
- 已删除目录仍可能作为 mountpoint 存在，进入 namespace 检查实际引用。
- 网络文件系统卡顿时 `findmnt` 只证明挂载表状态，不证明服务端 I/O 健康。

## 7. 完成标准

```bash
findmnt --verify --verbose
findmnt -T / -o TARGET,SOURCE,FSTYPE,OPTIONS,PROPAGATION
findmnt --json -R /var/lib/kubelet | jq .
```

能解释内核状态、fstab 期望、namespace 和传播关系的差异，才算掌握。

参考：[util-linux/libmount 上游](https://github.com/util-linux/util-linux)与本机 `man findmnt`。
