---
title: "eBPF 执行模型、Verifier 与观测边界：程序怎样安全进入内核"
sidebar_label: "06. eBPF、Verifier 与观测边界"
sidebar_position: 6
description: "解释 BPF program、hook、map、verifier、JIT、BTF/CO-RE、ring buffer 与生产治理。"
tags: [Linux, eBPF, BTF, CO-RE, Verifier]
---

# eBPF 执行模型、Verifier 与观测边界：程序怎样安全进入内核

eBPF 是受验证的内核执行环境，不只是“高级抓包”。程序附着在 tracepoint、kprobe、cgroup、XDP、tc、LSM 等 hook，借助 map 与用户态交换数据。

## 1. 生命周期

```text
编译 BPF bytecode
→ bpf syscall 创建 map/load program
→ verifier 分析控制流、指针类型、边界和 helper
→ 可选 JIT 为本机指令
→ attach 到 hook/link
→ 事件触发执行
→ map/ring buffer 输出聚合或样本
→ detach/unpin/关闭 FD 回收对象
```

对象被 bpffs pin 后可脱离加载进程继续存在，因此脚本退出不一定停止程序。

## 2. Verifier 保证与不保证

它尝试证明有限执行、内存访问安全、引用释放和 helper 使用合法，但不证明业务逻辑正确、开销足够低或采样无偏。不同内核版本支持的指令、kfunc、loop 和状态上限不同。

## 3. Map 与并发

Hash、array、per-CPU、LRU、stack trace、ring buffer 等 map 语义不同。共享 map 更新要考虑原子性和 contention；per-CPU map 降低竞争但用户态聚合要处理 CPU hotplug 与丢事件。

## 4. BTF 与 CO-RE

BTF 描述内核类型，CO-RE relocation 让同一对象文件按目标内核字段布局调整，显著改善可移植性，但不保证语义未变。缺少 BTF 的内核可使用其他编译/符号方案，部署复杂度更高。

## 5. 生产开销

开销近似：事件频率 × 单事件指令/读取/输出成本。把每个包或每次 syscall 全量送用户态会迅速放大；优先在内核 map 聚合、按 PID/cgroup/端口过滤并采样。

```bash
bpftool prog list
bpftool map list
bpftool link list
mount | grep bpf
```

## 6. 安全与权限

unprivileged BPF、capability、LSM 和 lockdown 策略随内核/发行版不同。BPF 程序可观察敏感数据甚至改变网络/安全决策，必须有代码审查、对象清理和权限治理。

## 7. 练习与答案

**问题：Verifier 通过是否表示程序不会拖慢系统？**

答案：不表示。它主要证明安全执行属性；高频 hook、昂贵 map 操作和大量输出仍会造成显著开销。

**问题：CO-RE 程序能否在所有内核版本无修改运行？**

答案：不能保证。字段布局可重定位，但 hook、字段存在性、helper 和行为语义仍有版本边界。

下一篇：[Core Dump、SysRq、pstore 与崩溃证据](./07-Core-Dump-SysRq-pstore与崩溃证据.md)
