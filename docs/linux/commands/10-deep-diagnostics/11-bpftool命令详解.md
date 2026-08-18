---
title: "bpftool 命令详解：Program、Map、Link、BTF、cgroup 与 net 对象治理"
sidebar_label: "11. bpftool 命令详解：Program、Map、Link、BTF、cgroup 与 net 对象治理"
sidebar_position: 11
description: "讲清 bpftool 全局选项和 prog/map/link/btf/cgroup/net/perf/feature/struct_ops/iter/gen 子命令的查询与高风险变更。"
tags: [Linux, bpftool, eBPF, BTF, cgroup]
---

# bpftool 命令详解：Program、Map、Link、BTF、cgroup 与 net 对象治理

`bpftool` 是内核树配套的 eBPF 管理器，直接操作 program、map、link、BTF、cgroup attachment、网络 attachment 和 pinned object。它不仅只读：load、attach、detach、map update/delete、pin/unpin 都会改变内核状态。

## 1. 顶层对象与通用选项

```text
bpftool [OPTIONS] OBJECT COMMAND
OBJECT := prog | map | link | cgroup | perf | net | feature | btf |
          gen | struct_ops | iter
```

| 选项 | 含义 |
|---|---|
| `-j, --json` | JSON 输出 |
| `-p, --pretty` | pretty JSON |
| `-d, --debug` | 打印 libbpf/verifier 调试信息 |
| `-f, --bpffs` | 显示 bpffs pin 信息（依子命令） |
| `-m, --mapcompat` | 兼容旧 map 输出 |
| `-n, --nomount` | 不自动挂载 bpffs |
| `-L, --use-loader` | 使用 loader program（依版本） |
| `-V, --version` | 版本、libbpf 与 feature 信息 |

## 2. 只读资产盘点

```bash
sudo bpftool -j prog show
sudo bpftool -j map show
sudo bpftool -j link show
sudo bpftool btf show
sudo bpftool cgroup tree /sys/fs/cgroup
sudo bpftool net show
sudo bpftool feature probe kernel
```

| 对象 | 关键字段 |
|---|---|
| prog | ID/type/name/tag、load_time、UID、map_ids、BTF ID、JIT/memlock |
| map | ID/type/key/value/max_entries、flags、owner prog、pinned path |
| link | ID/type、关联 prog、attachment target；link 生命周期通常更可靠 |
| BTF | 内核/模块/程序类型元数据 |
| cgroup/net | 附着点、attach type、program ID |

ID 会复用，不是永久身份；长期管理优先 pinned path、tag/build/version 与所有者 metadata。

## 3. 查询与调试

```bash
sudo bpftool prog show id 42
sudo bpftool prog dump xlated id 42 linum
sudo bpftool map dump id 17
sudo bpftool map lookup id 17 key hex 01 00 00 00
sudo bpftool btf dump id 1 format c
```

map key/value 是按声明布局和本机端序解释的字节；盲目 hex update 会破坏控制面状态。per-CPU map 值、LRU、ringbuf 等类型还有特殊语义。

## 4. 写操作安全边界

以下均为 `[W/D]`：`prog load/loadall`、`link create/detach/pin`、`cgroup attach/detach`、`net attach/detach`、`map update/delete/freeze`、`object pin`。操作前：

1. 保存 JSON inventory 和精确 attachment。
2. 确认对象由 CNI、systemd、security agent 还是人工拥有。
3. 准备控制器重建行为和回滚。
4. 避免只按可能复用的 ID 删除。
5. 修改后验证业务数据面和 owner reconciliation。

## 5. 权限与验收

能力要求随内核从通用 `CAP_SYS_ADMIN` 演进到 `CAP_BPF/CAP_PERFMON/CAP_NET_ADMIN` 等组合，也受 lockdown/LSM/token 影响。容器 Namespace 不一定看到宿主 bpffs/cgroup/netns。

掌握标准：能把 prog—map—link—attachment—pinned path 串起来，区分对象存在与真正附着，安全找出遗留对象而不误删 CNI/安全策略。

## 6. 官方参考

- [Linux Kernel：bpftool](https://docs.kernel.org/bpf/bpftool.html)
- [bpftool man pages](https://man7.org/linux/man-pages/man8/bpftool.8.html)

深度诊断模块完成。下一模块进入 Shell 与安全自动化。
