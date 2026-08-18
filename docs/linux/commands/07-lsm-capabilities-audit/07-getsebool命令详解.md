---
title: "getsebool 命令详解：查询 SELinux boolean 当前值"
sidebar_label: "07. getsebool 命令详解：查询 SELinux boolean 当前值"
sidebar_position: 7
description: "完整讲解 getsebool 的指定名称与 -a 参数、current/persistent 区别、条件策略语义、查询失败和 boolean 安全评审。"
tags: [Linux, getsebool, SELinux, boolean, policy]
---

# getsebool 命令详解：查询 SELinux boolean 当前值

SELinux boolean 是 policy 预先设计的条件开关，用来启停一组 allow 规则。`getsebool` 查询内核当前值，不直接解释这些规则的全部访问面，也不保证值重启后保持。

## 1. 语法与全部参数

```text
getsebool -a
getsebool BOOLEAN...
```

| 参数 | 含义 |
|---|---|
| `-a` | 列出全部 boolean 当前值 |
| `BOOLEAN...` | 查询一个或多个明确名称 |

没有其他通用参数；以 policycoreutils 3.11 为基线。

```bash
getsebool httpd_can_network_connect
getsebool -a | grep '^httpd_'
```

脚本优先查询精确名字，不解析全量 grep；名字随安装 policy modules/发行版变化。

## 2. current 与 persistent

`getsebool` 显示当前内核值。持久本地定制查看：

```bash
getsebool httpd_can_network_connect
semanage boolean -l -C
semanage boolean -l | grep -F httpd_can_network_connect
```

不带 `-P` 的 `setsebool` 只改 current；policy reload/reboot 后恢复 persistent/default。事故调查要同时记录两者和变更时间。

## 3. boolean 不是“功能开关”这么简单

例如“允许 Web 服务联网”的 boolean 可能给多个 domain、多个 socket class/permission 放行，影响比单个目的地址更大。名称和描述是入口，最终安全评审需用 policy 查询工具查看条件规则，并结合 firewall、服务身份和网络 namespace。

```bash
semanage boolean -l | grep -F httpd_can_network_connect
# 进阶：sesearch -A -C -b BOOLEAN
```

不要为了消除 AVC 搜索一个名字相似的 boolean 就打开；先确认 AVC 的 source/target/class/permission 与业务需求。

## 4. 常见误判

| 误判 | 修正 |
|---|---|
| 显示 on 就一定允许 | 仍要满足其他 SELinux 规则和所有安全层 |
| 显示 off 就是故障根因 | 需要 AVC/policy 条件证据 |
| boolean 只影响当前服务 | 可能被多个 domain/规则引用 |
| getsebool 是持久配置 | 它显示 current |
| 找不到名字说明 SELinux 坏了 | policy/module/发行版可能没有该 boolean |

## 5. 退出码与实验

成功查询全部给定名称返回 0；未知 boolean、SELinux/policy 接口问题返回非零。自动化不要忽略 stderr 后使用空值。

在 VM 选一个无害测试 boolean：记录 current/persistent；临时切换后比较；policy reload/重启验证恢复；持久切换后再恢复原值。全程记录 AVC 和业务行为。

掌握标准：能说明唯一 `-a` 参数、current/persistent 分离和条件 allow 的扩大面，不基于名称猜测做生产放宽。

## 6. 官方参考 {/* #官方参考 */}

- [getsebool(8)](https://manpages.debian.org/unstable/policycoreutils/getsebool.8.en.html)
- [booleans(8)](https://manpages.debian.org/unstable/policycoreutils/booleans.8.en.html)

上一篇：[`semanage` 命令详解](./06-semanage命令详解.md)

下一篇：[`setsebool` 命令详解](./08-setsebool命令详解.md)
