---
title: mount 命令详解：文件系统、bind、remount 与生产安全
sidebar_position: 4
description: 讲解 mount 的 VFS 语义、fstab/libmount、源与目标、通用参数、bind/rbind、传播、remount、loop、网络文件系统、systemd 集成和故障排查。
tags: [Linux, mount, VFS, fstab, Namespace, util-linux]
---

# `mount` 命令详解：文件系统、bind、remount 与生产安全

`mount` 请求内核把一个文件系统树附着到当前 mount namespace 的目录。它不“把磁盘复制到目录”，也不会自动证明文件系统健康。现代 util-linux `mount` 通过 libmount 解析 fstab、标签、helper、utab 和 namespace。

## 1. 基本模型

```text
source             filesystem driver           target
/dev/vg0/data  --  xfs/ext4            -->     /srv/data
server:/export --  nfs4                -->     /mnt/nfs
目录 A          --  bind                -->     目录 B
```

```bash
mount --version
findmnt --kernel
findmnt --verify --verbose
```

直接运行 `mount` 列表输出只为兼容；查询请用 `findmnt`。

## 2. 调用形式

```bash
mount -t TYPE -o OPTIONS SOURCE TARGET
mount TARGET                 # 从 fstab 找条目
mount SOURCE                 # 从 fstab 找条目
mount -a                     # 挂载 fstab 中符合条件的全部条目
mount --bind OLD NEW
mount --move OLD NEW
mount --make-shared TARGET
```

## 3. 通用参数

| 参数 | 作用与风险 |
|---|---|
| `-a, --all` | 挂载 fstab 全部符合项；生产范围大 |
| `-t, --types list` | 指定/筛选文件系统类型；`noTYPE` 排除 |
| `-o, --options list` | 逗号分隔选项，后者覆盖/合并规则需看 libmount 版本 |
| `-O, --test-opts list` | 与 `-a` 配合按 option 筛选 |
| `-r, --read-only` | 请求只读挂载 |
| `-w, --rw` | 请求读写，通常为默认 |
| `-L, --label label` | 以文件系统 LABEL 作为 source |
| `-U, --uuid uuid` | 以文件系统 UUID 作为 source |
| `--source spec` / `--target dir` | 显式指定 source/target |
| `-B, --bind` | bind mount 单个树 |
| `-R, --rbind` | 递归包含子挂载 |
| `-M, --move` | 移动挂载到新位置 |
| `--make-shared/slave/private/unbindable` | 修改传播类型 |
| `--make-rshared/rslave/rprivate/runbindable` | 递归修改传播类型 |
| `-N, --namespace ns` | 在指定 mount namespace 操作 |
| `-n, --no-mtab` | 不写用户态 mount table |
| `-f, --fake` | 不调用 mount syscall，用于有限测试，不等于完整 dry-run |
| `-v, --verbose` | 详细过程 |
| `-s, --sloppy` | 容忍未知 mount option，容易掩盖拼写错误 |
| `-i, --internal-only` | 不调用 `/sbin/mount.TYPE` helper |
| `--no-canonicalize` | 不规范化路径 |
| `--mkdir[=mode]` | 若版本支持则创建 target |
| `--options-mode mode` | 控制 fstab 与命令行 option 合并方式 |
| `--onlyonce` | 防止同一 fs 再次挂载到同一 target |

文件系统专有选项必须查看 `man mount.<type>`，例如 `mount.nfs`、`mount.cifs`、ext4/xfs 内核文档。不能把 `hard/soft`、`vers`、`nconnect` 等 NFS 选项当成 mount 通用参数。

## 4. 关键选项语义

```text
ro/rw         读写请求
nosuid        不执行 setuid/setgid 效果
nodev         不解释设备特殊文件
noexec        禁止直接 exec；不是完整脚本/解释器隔离
relatime      常见 atime 策略
noatime       不更新访问时间，可能影响依赖 atime 的应用
sync/async    I/O 语义与性能影响大，不可凭名称盲调
discard       在线 discard，和周期 fstrim 取舍需压测
nofail        启动时该 mount 失败不作为硬依赖
_netdev       告诉用户态这是网络相关挂载
x-systemd.*   systemd mount/automount/timeout/dependency 扩展
```

安全选项是纵深防御，不是容器沙箱。`noexec` 仍可能被解释器读取，bind mount remount 的属性继承也必须现场验证。

## 5. Bind、remount 与传播

```bash
mount --bind /srv/model /mnt/model
mount -o remount,bind,ro /mnt/model
mount --rbind /var/lib/kubelet /mnt/debug/kubelet
mount --make-rslave /mnt/debug/kubelet
```

历史内核/libmount 对 bind 后修改 VFS attributes 的行为不同。每次用 `findmnt -o TARGET,VFS-OPTIONS,FS-OPTIONS,PROPAGATION` 验证，而不是相信命令行字符串。

remount：

```bash
mount -o remount,ro /srv/data
```

remount 可能因打开写句柄、内核/文件系统限制而失败；也可能保留或重置未显式写出的 options。远程操作根文件系统和管理组件数据目录风险极高。

## 6. fstab 与 systemd

```fstab
UUID=... /srv/data xfs defaults,nofail 0 2
server:/models /mnt/models nfs4 ro,hard,_netdev,x-systemd.automount 0 0
```

```bash
findmnt --verify --verbose
systemctl daemon-reload
systemctl status srv-data.mount
```

systemd 会从 fstab 生成 `.mount/.automount` unit。修改 fstab 后只运行 `mount -a` 不能验证启动依赖、超时和 automount 行为。

## 7. 故障排查

```bash
findmnt -T /srv/data -o TARGET,SOURCE,FSTYPE,OPTIONS,PROPAGATION
blkid /dev/mapper/vg0-data
journalctl -k --since '-10 min'
```

- `wrong fs type/bad superblock`：确认外层加密/LVM/RAID是否已激活，多签名和正确 helper。
- `special device does not exist`：检查 UUID、udev settle、initramfs 和网络依赖。
- `permission denied`：查内核日志、SELinux/AppArmor、NFS export 与 capability。
- 已挂载但目录为空：可能被后续 mount 遮蔽，使用 `findmnt --shadowed`。
- 容器不可见：比较 mount namespace 和 propagation。

## 8. 安全实验

只在临时目录做 bind mount：

```bash
mkdir -p /tmp/mount-lab/src /tmp/mount-lab/dst
touch /tmp/mount-lab/src/probe
sudo mount --bind /tmp/mount-lab/src /tmp/mount-lab/dst
findmnt -T /tmp/mount-lab/dst
sudo umount /tmp/mount-lab/dst
```

完成标准：能区分 source、superblock、mount、VFS option、fstab 与 namespace，并在变更前给出精确 target、影响进程和卸载回滚。

参考：[util-linux/libmount 上游](https://github.com/util-linux/util-linux)与本机 `man mount`、`man mount.<type>`。
