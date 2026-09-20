---
title: "kdump、vmcore 与 crash：内核崩溃后如何还原现场"
sidebar_label: "09. kdump、vmcore 与 crash"
sidebar_position: 9
description: "解释 crashkernel 预留、capture kernel、makedumpfile、匹配 vmlinux、panic CPU 和任务/内存分析。"
tags: [Linux, kdump, vmcore, crash, Kernel Panic]
---

# kdump、vmcore 与 crash：内核崩溃后如何还原现场

kdump 在正常内核崩溃后通过 kexec 启动一个小型 capture kernel，读取预留的旧内核内存并保存 vmcore。它需要故障前完整配置和恢复演练。

## 1. 数据链路

```text
启动参数 crashkernel=... 预留内存
→ 预加载 capture kernel/initramfs
→ kernel panic 触发 kexec
→ capture kernel 仅使用预留内存启动
→ /proc/vmcore 暴露旧内核内存
→ makedumpfile 过滤/压缩并写本地或远端
→ crash + 匹配 debug vmlinux 分析
```

若 capture kernel 缺少存储/网络驱动、目标盘也故障或预留不足，panic 时无法保存。

## 2. 必须匹配的文件

- vmcore。
- 对应运行内核的未压缩 debug `vmlinux`。
- 模块符号/版本信息（若栈涉及模块）。
- 内核配置、命令行和故障日志。

同版本号但不同 Build ID/发行版 rebuild 也可能不匹配。

## 3. crash 起点

```text
sys        → 内核/机器基本信息
log        → 内核 ring buffer
bt         → 当前/panic task 栈
ps         → 任务与状态
foreach bt → 批量任务栈（数据量大）
kmem       → 内存概览
files/net  → 按问题查看资源
```

先读 panic message、CPU、当前 task 和 call trace，再扩展到相关对象。不要看到最后一个函数就认定它是根因；内存破坏可能更早发生。

## 4. Dump Level

makedumpfile 可排除空页、cache、用户页等降低体积。过滤越多越可能缺失后续所需对象；应根据问题类型和存储预算测试，而不是只追求最小文件。

## 5. 演练

在维护测试机受控触发 crash 前，确认业务隔离、fencing 和数据安全；验证 vmcore 真正上传、能被 crash 打开、符号正常、自动告警和保留策略生效。

## 6. 练习与答案

**问题：vmcore 保存成功但 crash 显示大量错误，最常见先查什么？**

答案：先核对 vmlinux/Build ID/架构与 vmcore 是否匹配，再检查 dump 是否损坏或过滤过度。

**问题：kdump 能否处理整机断电？**

答案：不能依赖。断电时正常内核无法 kexec；需 BMC/硬件日志、持久存储和外部冗余。

下一篇：[内核实验报告与证据复现模板](./10-内核实验报告与证据复现模板.md)
