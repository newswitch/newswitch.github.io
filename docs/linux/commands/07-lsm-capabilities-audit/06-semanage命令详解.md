---
title: "semanage 命令详解：SELinux 本地策略定制与持久映射"
sidebar_label: "06. semanage 命令详解：SELinux 本地策略定制与持久映射"
sidebar_position: 6
description: "系统讲解 semanage 的全部对象子命令、通用 CRUD 参数，以及 fcontext、port、login、boolean、permissive、module、network、InfiniBand 和 import/export 工作流。"
tags: [Linux, semanage, SELinux, fcontext, port, boolean, policy]
---

# semanage 命令详解：SELinux 本地策略定制与持久映射

`semanage` 修改 policy store 中的本地定制，不需要直接重编基础策略。它管理“期望映射/策略记录”，通常不会自动把现有文件 xattr 改好，也不会自动重启使用者。

## 1. 顶层语法与全部对象

```text
semanage [-h] COMMAND ...
```

| 子命令 | 对象 |
|---|---|
| `import` / `export` | 导入/导出全部本地定制 |
| `login` | Linux login/group → SELinux user 映射 |
| `user` | SELinux user 的 role/range/prefix |
| `port` | tcp/udp/dccp/sctp port → type/range |
| `interface` | network interface context |
| `module` | policy modules priority/enabled 状态 |
| `node` | IPv4/IPv6 node context |
| `fcontext` | 路径 regex/file type → file context |
| `boolean` | persistent boolean customization |
| `permissive` | 特定 process domain permissive |
| `dontaudit` | 全局启用/禁用 dontaudit 规则 |
| `ibpkey` | InfiniBand subnet/pkey context |
| `ibendport` | InfiniBand device/port context |

顶层只有 `-h, --help`；每个对象有独立完整参数，必须运行 `semanage COMMAND -h`。

## 2. 多数对象共用 CRUD 参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-a` | `--add` | 增加本地记录 |
| `-m` | `--modify` | 修改已有记录 |
| `-d` | `--delete` | 删除指定本地记录 |
| `-D` | `--deleteall` | 删除该类全部本地定制，高风险 |
| `-l` | `--list` | 列出记录 |
| `-C` | `--locallist` | 与 list 联用，仅本地定制 |
| `-E` | `--extract` | 以可导入命令/事务格式提取定制 |
| `-n` | `--noheading` | 列表无表头 |
| `-N` | `--noreload` | commit 后不 reload policy |
| `-S STORE` | `--store STORE` | 选择替代 policy store |
| `-h` | `--help` | 子命令帮助 |

不是所有对象都支持全部 CRUD；例如 boolean 主要 modify/list/extract/deleteall。`-D` 不问“是否删除别人的规则”，变更前先 export。

## 3. fcontext 全部专用参数

| 参数 | 含义 |
|---|---|
| `-t, --type TYPE` | 目标 type |
| `-s, --seuser USER` | SELinux user 字段 |
| `-r, --range RANGE` | MLS/MCS range |
| `-f, --ftype a|f|d|c|b|s|l|p` | 全部/普通/目录/字符/块/socket/symlink/pipe |
| `-e, --equal TARGET` | 让目标路径前缀复用源路径的标签映射；两者必须是路径前缀，非 regex |

```bash
semanage fcontext -a -t httpd_sys_content_t '/srv/site(/.*)?'
restorecon -nRv /srv/site
restorecon -Rv /srv/site
```

FILE_SPEC 是完整路径或 PCRE2 regex，按 bytes 匹配；local 记录优先于 policy module，且最近添加优先。正则必须尽量具体并引用，避免 shell 展开。

## 4. port、interface、node 与 InfiniBand

`port` 专用：`-t TYPE`、`-r RANGE`、`-p, --proto tcp|udp|dccp|sctp`，对象为端口或 `START-END`。它只让 policy 把端口归类到 type，不开放 firewall、不让进程自动监听。

```bash
semanage port -l -C
semanage port -a -t http_port_t -p tcp 8081
```

`interface/node` 使用 type、range，以及 node 的 protocol/mask；`ibpkey` 使用 subnet prefix、pkey range；`ibendport` 使用设备名/端口。高速网络集群修改前必须与 NetworkManager/RDMA/Kubernetes policy 共同验证。

## 5. login 与 user

`login` 常用 `-s, --seuser` 和 `-r, --range`；Linux group 以 `%group` 表示。`__default__` 是默认映射。`user` 管理 SELinux user 的 roles/range/level/prefix；它不是 `/etc/passwd` 用户管理。

```bash
semanage login -l
semanage login -l -C
semanage user -l
```

错误映射可能使管理员无法登录或进入意外 domain。先保留现有会话和带外控制台，在测试用户验证 PAM/login transition。

## 6. boolean、permissive 与 dontaudit

`boolean` 支持 `-m --on|-1`、`--off|-0`、list/local/extract/deleteall。`permissive -a TYPE/-d TYPE/-l` 管理特定 domain；`dontaudit --on/--off` 会改变隐藏拒绝的策略行为，可能产生大量日志。

```bash
semanage boolean -l -C
semanage permissive -l
semanage dontaudit --off   # 仅受控短窗口诊断
```

这些都不是“修复权限”的捷径；记录业务目的、暴露面和回滚。

## 7. module 与 import/export

`semanage module` 可列模块、启停本地 module 状态及处理优先级；复杂模块安装常由 `semodule` 完成。全量迁移优先：

```bash
semanage export > selinux-local-before.txt
semanage import < reviewed-customizations.txt
```

导出可能包含用户映射和内部网络策略，应保护。目标主机 policy/version/type 不同会导致导入冲突，必须先审阅和 dry-run/测试环境验证。

## 8. 事务、`-N` 与验证

`-N` 让多次变更不立即 reload，可减少反复编译，但中途磁盘 store 与内核 loaded policy 不一致。完成后要用正常 commit/reload 工具并验证；不要让 `-N` 留在无人知晓的脚本路径。

```bash
semanage export
semanage fcontext -l -C
matchpathcon /srv/site/file
restorecon -nvv /srv/site/file
ausearch -m MAC_POLICY_LOAD,CONFIG_CHANGE -ts recent -i
```

## 9. 实验与掌握标准

在 VM 完成 fcontext add/modify/delete+restorecon、port add/delete、boolean persistent 改回、测试 login 映射、单域 permissive 加删；每步先 export、只列 local、验证 loaded 行为，禁止 `-D` 清空共享主机。

掌握标准：能列出全部顶层对象和共用参数，解释 fcontext/port/login/user 的对象差异，知道 semanage 只修改 policy store 的边界，并具备 export→change→apply→verify→rollback 流程。

## 10. 官方参考 {/* #官方参考 */}

- [semanage(8)](https://manpages.debian.org/unstable/policycoreutils-python-utils/semanage.8.en.html)
- [semanage-fcontext(8)](https://manpages.debian.org/unstable/policycoreutils-python-utils/semanage-fcontext.8.en.html)
- [semanage-port(8)](https://manpages.debian.org/unstable/policycoreutils-python-utils/semanage-port.8.en.html)

上一篇：[`restorecon` 命令详解](./05-restorecon命令详解.md)

下一篇：[`getsebool` 命令详解](./07-getsebool命令详解.md)
