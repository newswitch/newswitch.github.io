---
title: "挂载、Mount Namespace 与传播：同一文件系统为何出现不同目录视图"
sidebar_label: "08. 挂载、Mount Namespace 与传播"
sidebar_position: 8
description: "解释 mount 对象、挂载点、bind mount、递归挂载、传播类型、容器视图和卸载 busy。"
tags: [Linux, Mount, Mount Namespace, Bind Mount, 容器]
---

# 挂载、Mount Namespace 与传播：同一文件系统为何出现不同目录视图

挂载不是把文件复制到目录，而是把一个文件系统树连接到当前 Namespace 的目录树。不同进程可以处在不同 Mount Namespace，看见不同挂载拓扑。

## 1. 设备、文件系统、mount 与目录

```text
块设备/远端资源
→ 文件系统实例（superblock）
→ mount 对象
→ 挂接到某个 dentry
→ 当前 Mount Namespace 中形成路径视图
```

同一文件系统可以通过 Bind Mount 或多个 mount 视图出现在多个路径，挂载选项也可能分为文件系统级和 mount 级语义。

## 2. Bind Mount

Bind Mount 把已有目录树在另一路径再次暴露：

```bash
mount --bind /srv/models /opt/app/models
findmnt -T /opt/app/models
```

它不会创建数据副本。容器 volume mount、Kubernetes hostPath 和某些 subPath 机制都会利用 mount 组合，但还叠加 Namespace、传播和安全策略。

## 3. Mount Namespace

创建/复制 Mount Namespace 后，进程拥有独立的挂载视图。后续挂载是否传播到其他 Namespace，取决于 shared/private/slave/unbindable 等传播关系。

```bash
lsns -t mnt
readlink /proc/<PID>/ns/mnt
nsenter -t <PID> -m findmnt
```

必须进入目标进程 Namespace 检查，宿主机路径存在不能证明容器内可见，反之亦然。

## 4. 传播模式

- shared：同一 peer group 间传播挂载/卸载事件。
- private：不向外传播，也不接收传播。
- slave：接收 master 传播，但不反向传播。
- unbindable：除 private 性质外，不能被 bind 复制。

Kubernetes 中 HostToContainer/Bidirectional 等挂载传播配置最终依赖这些内核语义。Bidirectional 会扩大宿主机影响面，需要谨慎授权。

## 5. 为什么 umount 显示 busy

可能仍有：

- 进程 cwd/root 位于挂载内。
- 打开的文件或 mmap。
- 子挂载。
- 另一 Namespace 中的引用。
- loop/设备映射或网络文件系统请求。

```bash
findmnt -R /mountpoint
fuser -vm /mountpoint
lsof +f -- /mountpoint
```

Lazy unmount 只把挂载从当前路径视图分离，等引用消失后清理，不是强制让所有底层 IO 立即结束。误用可能把问题隐藏到后台。

## 6. OverlayFS 视图

OverlayFS 把 lowerdir、upperdir 和 workdir 组合成统一视图。首次修改 lower 文件可能触发 copy-up；删除可通过 whiteout 表示。容器内看到的 inode、空间和路径，可能与宿主机某一层不同。

完整容器原理将在隔离模块展开，这里要记住：VFS 解析的是当前进程的组合挂载视图。

## 7. 练习与答案

**问题：宿主机 `/models/a` 存在，Pod 中 `/models/a` 不存在，是否说明文件被删了？**

答案：不能。Pod 可能位于不同 Mount Namespace，目标路径被其他 volume/Overlay 层覆盖，或传播未发生。

**问题：lazy umount 是否等于安全停止存储？**

答案：不是。它主要解除路径可见关系，已有引用和 IO 仍可能继续；应先处理使用者和数据一致性。

下一篇：[ext4、XFS、日志与崩溃一致性](./09-ext4-XFS日志与崩溃一致性.md)
