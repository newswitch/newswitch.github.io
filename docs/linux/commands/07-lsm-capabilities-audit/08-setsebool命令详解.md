---
title: "setsebool 命令详解：临时与持久修改 SELinux boolean"
sidebar_label: "08. setsebool 命令详解：临时与持久修改 SELinux boolean"
sidebar_position: 8
description: "完整讲解 setsebool 的 -P/-N/-V 参数、两种赋值语法、current/persistent policy、原子多值变更、性能风险和安全验证。"
tags: [Linux, setsebool, SELinux, boolean, 安全变更]
---

# setsebool 命令详解：临时与持久修改 SELinux boolean

`setsebool` 修改一个或多个 SELinux boolean。默认只改内核当前值；`-P` 把 pending values 写入磁盘 policy 并持久化，可能触发 policy 构建/加载，明显更慢且影响更久。

## 1. 两种语法

```text
setsebool [-PNV] BOOLEAN VALUE
setsebool [-PNV] BOOL1=VALUE1 BOOL2=VALUE2 ...
```

值可用 `1/true/on` 或 `0/false/off`。多 boolean 优先 `name=value` 同一次提交，避免中间状态。

## 2. 全部参数

| 参数 | 含义 |
|---|---|
| `-P` | 写入持久 policy store，重启后保持 |
| `-N` | 写磁盘时不把 policy reload 到内核；通常与受控批量流程使用 |
| `-V` | 输出 semanage library 的详细错误 |

```bash
setsebool httpd_can_network_connect on
setsebool -P samba_create_home_dirs=on samba_enable_home_dirs=on
```

## 3. 变更前安全评审

```bash
getsebool BOOLEAN
semanage boolean -l | grep -F BOOLEAN
semanage boolean -l -C
ausearch -m AVC,USER_AVC -ts recent -i
```

回答：哪条 AVC 要求哪项 permission；boolean 会放行哪些 domain/class；是否可通过正确 file type、端口 type、服务架构或更小 policy 解决；回滚值是什么。

## 4. 临时验证再持久化

安全流程通常是：

```text
记录 current/persistent
→ 测试环境临时 setsebool
→ 最小业务复现 + 负向测试
→ 审查新增访问面
→ setsebool -P 持久化
→ policy reload/reboot 后验证
→ 记录回滚
```

临时成功不自动授权持久化；必须验证攻击路径和非目标访问仍被拒绝。

## 5. `-N` 的一致性风险

`-P -N` 可使磁盘持久值改变但当前内核仍是旧值，形成 loaded/store 不一致。它适合高级批量事务，随后必须明确 reload/commit；普通单项操作不要使用。事故排查同时查看 getsebool 与 semanage local。

## 6. 性能与并发

`-P` 可能重建/加载 policy，持续数秒并占 CPU/IO；并发多个 `setsebool -P` 会竞争 policy store。一次提交相关值，使用配置管理串行化，不在请求热路径调用。

## 7. 退出码与回滚

未知名称、非法值、权限、policy store 锁/空间/编译错误返回非零。成功后再次查询 current 和 persistent，不能只信退出码。

```bash
setsebool -P BOOLEAN off
getsebool BOOLEAN
semanage boolean -l -C
```

恢复“默认”不总等于写 off；如果原本没有本地定制，应考虑 `semanage boolean` 删除定制，让 policy default 接管。

## 8. 实验与掌握标准

在 VM 选测试 boolean，做临时 on/off、重载/重启、`-P`、多值提交和恢复原状态；观察 audit policy load 事件与耗时。不要在生产凭 `audit2allow` 建议直接打开。

掌握标准：能列出全部参数与两种语法，解释 current/persistent/loaded store、`-N` 一致性和 `-P` 成本，并完成最小权限评审和回滚。

## 9. 官方参考 {/* #官方参考 */}

- [setsebool(8)](https://manpages.debian.org/unstable/policycoreutils/setsebool.8.en.html)
- [semanage-boolean(8)](https://manpages.debian.org/unstable/policycoreutils-python-utils/semanage-boolean.8.en.html)

上一篇：[`getsebool` 命令详解](./07-getsebool命令详解.md)

下一篇：[`aa-status` 命令详解](./09-aa-status命令详解.md)
