---
title: "Arthas：类加载与在线方法观测"
sidebar_label: "06. Arthas：类加载与在线方法观测"
sidebar_position: 6
description: "沿实际加载类、方法、调用者、耗时和有限结果观测学习 Arthas，明确字节码增强、表达式、端口和结束清理的风险。"
tags: [Java, JVM, Arthas, 类加载, 在线诊断]
---

# Arthas：类加载与在线方法观测

日志不足又不方便重启时，Arthas 可以查看实际加载的类，并对指定方法做有限观测。它并非运行在目标之外的无成本旁观者：Attach 会加载诊断组件，部分命令会增强字节码，表达式还可能执行 Java 行为。

本篇以官方发布的 Arthas 4.1.9 命令体系为参照；4.x 支持 JDK 25 的说明见 [项目主页](https://github.com/alibaba/arthas)与[发布记录](https://github.com/alibaba/arthas/releases)。示例命令依据官方文档，输出形态为教学示意；本文配套自动验证覆盖目标 Java 程序与 JDK 工具，不把未进行的 Arthas Attach 声称为实测。

## 1. 先判断是否需要动态增强

只想知道 JDK、堆或线程，先用 jcmd/JFR；想确认某个类从哪个 JAR 加载，可以先做类信息查询；确实需要方法调用时的参数、返回或局部耗时，才考虑增强。

不要把 Arthas 的“能做到”当成“生产应该马上做”。先获得目标环境诊断权限，选一个副本，限制范围和持续时间，并记录启停时间。

## 2. 下载、连接与版本确认

从官方发布页获取并校验固定版本的完整包，解压到独立诊断目录。使用与目标兼容的 JDK，在目标同机、相应用户与 namespace 中启动包内的 bootstrap：

```bash
java -jar arthas-boot.jar --help
java -jar arthas-boot.jar --target-ip 127.0.0.1 12345
```

`12345` 为实验目标 PID；具体版本选择、下载行为和端口按当前包的 help 确认。内网应预置完整发行包与所需文件，不在生产临时执行来源不明的下载脚本。

连接后先执行：

```text
version
jvm
help
```

不要对公网开放控制端口；如需远程接入，使用组织批准的隧道、鉴权及访问控制。两个进程或多个诊断会话还需核对端口占用，不能不断重试后留下未知 agent。

## 3. 从“源码是什么”转为“实际加载了什么”

以 [DiagnosticTarget](./01-JDK诊断工具Attach与证据采集.md)为目标，查询：

```text
sc -d DiagnosticTarget
sm -d DiagnosticTarget work
classloader -t
jad DiagnosticTarget
```

`sc -d` 关注 classLoaderHash、code-source、类型等；`sm` 确认方法；`jad` 观察运行时字节码恢复出的 Java 表达。反编译不等于原始源码，行号和变量名可能缺失。

若出现多个同名类，先按 `help sc`、`help jad` 等确认如何限定目标加载器，再继续。不要为了“终于看到了一个同名类”就忽略其实查错了实例。

## 4. trace、stack、watch 各回答什么

| 命令 | 主要问题 | 不能替代 |
| --- | --- | --- |
| `trace` | 指定方法内可观察子调用的耗时路径 | 全链路分布式 Trace |
| `stack` | 谁调用了这个方法 | 完整时间分布 |
| `watch` | 选定时点的入参、返回或异常 | 无风险的数据浏览 |
| `monitor` | 时间窗口内方法统计 | 精确端到端请求指标 |

例如只对实验目标的一个方法观察三次：

```text
trace DiagnosticTarget work -n 3
stack DiagnosticTarget work -n 3
watch DiagnosticTarget work '{params[0],returnObj}' -s -n 3 -x 1
```

一次只运行一种，确认结束后再换下一种。DiagnosticTarget 本来就每隔一段时间调用 work，不需要向生产接口注入请求。`-n` 限制匹配输出次数，不代表高频方法上的增强成本只发生三次；条件不匹配时仍要评估判断成本与持续时间。

## 5. 输出怎么读，为什么不能直接信耗时

`watch` 的示意结果可能包含：

```text
method=DiagnosticTarget.work location=AtExit
result=@ArrayList[
    @Integer[4],
    @Integer[131],
]
```

4 与 131 说明观察到一次满足 `4 * 31 + 7` 的结果；实际输入随采样时刻变化。`-s` 只看正常返回，异常情况需另行选择观察时点。`-x` 控制展开深度，不是敏感字段过滤器。

trace 的成本会受增强、JIT 变化、采样时刻、调用范围及输出影响；短方法被观测后的耗时不能直接当作原始性能。它也不会自动展开所有深层调用、异步任务或远端处理。语义和限制见 [trace 官方说明](https://arthas.aliyun.com/doc/trace.html)与 [watch 官方说明](https://arthas.aliyun.com/doc/en/watch)。

## 6. 表达式、热点范围与数据风险

不要用包级大通配符增强整个应用，不在高频基础类上盲目 trace；优先精确到一个业务方法与必要条件。不要通过 OGNL 调用有副作用的方法来“查看”，getter 也不保证没有外部调用、懒加载或状态改变。

完整 params/target 可能保留或打印大量对象和凭据。优先观察允许公开的标量、结果类别和必要字段，控制输出量；不把 `tt` 长期保存调用上下文或重放有副作用业务作为默认手段。

## 7. 结束不是只关终端

完成后先停止当前前台观测，检查自己的后台任务，按需恢复本次增强：

```text
jobs
reset DiagnosticTarget
stop
```

`reset` 的范围应与本次操作一致，别随意影响其他人在做的诊断。`stop` 关闭目标中的 Arthas 服务并断开客户端；不会关闭业务 JVM。`quit` 只退出客户端，不等于清除所有增强或停止 agent。具体行为见 [命令列表](https://arthas.aliyun.com/doc/commands.html)。

如有其他诊断会话共用目标，应先协调再停整个 agent。最后确认服务健康、负载和后台进程恢复到预期。

## 8. 练习与答案

### 8.1 trace 里没有慢子调用，是否能证明网络没问题

不能。可能调用不在当前展开范围、发生在异步线程或远端，也可能等待发生在其他阶段。要关联完整请求与网络/客户端证据。

### 8.2 watch 打印对象，是否一定只是读取内存

不是。表达式求值可能调用方法并产生副作用，输出和对象展开也有成本。选择明确允许的简单字段和标量，避免任意调用。

### 8.3 达到 -n 3 后是否可以直接不管了

不应。还要确认观测已结束、没有自己的后台任务、增强和 agent 按计划处理，记录结束时间并验证业务指标。

## 9. 继续阅读

- [JDK 诊断工具、Attach 与证据采集](./01-JDK诊断工具Attach与证据采集.md)
- [JFR 事件、采样与性能画像](./02-JFR事件采样与性能画像.md)
- [Java 与 JVM 学习路线](../00-Java与JVM学习路线.md)
