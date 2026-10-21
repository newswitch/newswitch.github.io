---
title: "Go Race、Fuzz 与属性测试：在执行路径之外寻找边界"
sidebar_label: "03. Go Race、Fuzz 与属性测试：在执行路径之外寻找边界"
sidebar_position: 3
description: "示例测试适合固定场景，Fuzz 适合探索输入空间，Race 适合观察已执行路径中的数据竞争。三者各有边界，不能混成一个“全部验证通过”。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Race、Fuzz 与属性测试：在执行路径之外寻找边界

示例测试适合固定场景，Fuzz 适合探索输入空间，Race 适合观察已执行路径中的数据竞争。三者各有边界，不能混成一个“全部验证通过”。

## 1. 属性先于随机输入

Fuzz 应检查始终成立的性质，例如编码解码往返、规范化幂等、长度与大小限制、租户不串数据。只有“不能 panic”通常不足以证明业务正确。

core-lab 的 FuzzSum 是最小入门例子：对两个 int64，sum 的结果与相同溢出规则下的 a+b 一致。它教会运行与保存语料，不宣称覆盖了复杂算法。

## 2. 有限 Fuzz 实验

```bash
cd examples/go/core-lab
go test ./internal/demos -run '^$' -fuzz FuzzSum -fuzztime=2s -parallel=2
```

一次 Windows/amd64、Go 1.27.3 本机运行摘要：

```text
fuzz: elapsed: 2s, execs: 36296 (17375/sec), new interesting: 1 (total: 2)
PASS
```

执行数取决于机器和当次负载，不应硬编码成验收门槛。发现失败后应把最小化语料纳入回归，不要只删除触发输入。

## 3. Race 与平台条件

```bash
go test -race ./... -count=1 -timeout=60s
```

需要支持 Race 的目标平台和相应工具链。本机无合适 C 编译器，未完成 -race 执行；普通测试、Fuzz seed 通过均不替代该项。CI 可在已配置的 Linux runner 上独立运行。

Race 只发现被执行的竞争路径，不检测所有死锁和分布式重复副作用。并发设计仍需所有权与 happens-before 依据。

## 4. 输入与资源安全

Fuzz 目标不能对随机路径任意写文件、无限分配或连接外部服务。先验证输入大小，再进行解析；使用临时目录与有限时间，错误语料不能含真实凭证。

随机失败要记录版本、种子/语料和构建选项。并发时间相关错误可通过注入时钟、控制通知顺序与有限等待提高可复现性，不能单靠 sleep。

## 5. 把属性写成与实现不同的判定

FuzzSum 对相同加法规则的比较适合学习工具，但算法太小，能发现的差异有限。更有意义的属性要从契约推导：例如 Unicode 前缀始终是输入的字节前缀、保持合法 UTF-8、码点数量不超过指定上限。

配套 FuzzPrefixRunes 不逐行复写截断循环，而是检查上述三个性质；固定测试再补缺失边界和组合音标。属性不能悄悄强于协议：截断按码点时，不应要求它自动保留所有可见字形。

生成输入前就限制长度，避免解析器实验演变成无限内存或外部文件操作。Fuzz 目标不连接真实数据库，不使用随机值作为任意路径，不包含真实凭证。

## 6. Seed、探索与最小化是三种运行阶段

```bash
go test ./internal/foundation -run FuzzPrefixRunes -v
go test ./internal/foundation -run '^$' -fuzz FuzzPrefixRunes -fuzztime=2s -parallel=2
go test ./internal/foundation -count=1
```

普通 go test 会运行已登记 seed 与保存的语料；带 -fuzz 才主动探索新输入。失败时工具尝试缩小语料，便于理解触发条件；修复后把该语料纳入普通回归，避免只在某次随机运行中发现过问题。

执行次数、语料数量与速度受机器和当次负载影响，不能作为“覆盖了全部输入”的证据。带有时间、并发交错或外部状态的性质还需要额外设计。

## 7. Race 发现的是已执行的内存访问冲突

Race 插桩观察没有适当同步的并发访问，普通测试通过不能替代它。反过来，只有 atomic 更新却破坏多字段不变量的逻辑，可能没有 Race 但仍错误；死锁与分布式重复处理也不属于同一个检测目标。

运行时应使用支持的平台和所需工具链，保留实际命令、版本与结果；不具备条件就单独列出未验证。不要为了得到一行 PASS 而移除有竞争风险的执行分支。

即使配置了 -race，也需要足够的并发场景和清晰的所有权证明。随机重复很多次不能替代确定的同步协议，报告中也不应把无告警等同于所有交错都已证明安全。

## 8. 把失败转换成可维护的回归

先判断是输入契约、实现、测试前置条件还是环境导致失败，再缩小场景。记录输入、语言版本、构建标签、随机源和必要交错；保留可重放的最小证据，而不需要保存一大段无关日志。

测试应有总超时，并在失败时关闭自建监听、文件和后台任务。使用 Cleanup 或 defer 仍要确认释放信号不会自己阻塞；对通知与 Join 设置可解释的预算。

回归集合中同时保留正常输入、边界输入和此前失败输入。不能把 fuzz 修复成“对见过的坏值硬编码跳过”，也不能仅扩大超时掩盖泄漏。

## 9. 练习与答案

### 9.1 Fuzz 运行两秒等于覆盖所有输入吗

不等于，只是有限探索。

### 9.2 Race 通过能证明没有死锁吗

不能，它不是死锁与业务一致性验证器。

### 9.3 遇到导致失败的语料能删除吗

应先定位修复并保留为回归样本。

## 10. 参考资料

- [Go fuzzing](https://go.dev/doc/security/fuzz/)
- [Race detector](https://go.dev/doc/articles/race_detector)
- [Go 构建与测试命令](https://pkg.go.dev/cmd/go)
- [基础与属性实验](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab/internal/foundation)
