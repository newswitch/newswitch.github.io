---
title: ceph 命令详解：集群健康、服务、PG、OSD、配置与认证
sidebar_position: 21
description: 以 Ceph Tentacle 20.2.2 为基线，讲解 ceph CLI 的动态命令模型、全局参数、健康证据链、服务/PG/OSD/容量/配置/auth/orchestrator 命令和安全变更。
tags: [Ceph, ceph CLI, RADOS, OSD, PG, 故障排查]
---

# `ceph` 命令详解：集群健康、服务、PG、OSD、配置与认证

`ceph` 是向 Monitor/Mgr/daemon 提交集群控制命令的通用 CLI。子命令由当前集群和启用模块动态注册，不存在一张跨版本永久不变的“全部命令表”。

## 1. 版本、身份和配置

```bash
ceph version
ceph versions
ceph status
ceph help
ceph tell mon.* version
```

本文以 Ceph Tentacle 20.2.2 为基线；mixed-version 升级时客户端、MON/MGR/OSD 命令能力可能不同。

```text
CLI → ceph.conf/mon address + keyring/client identity → MON quorum
    → monitor command / mgr module / daemon command
```

## 2. 全局参数

| 参数 | 作用 |
|---|---|
| `-c, --conf FILE` | 指定配置文件 |
| `--cluster NAME` | 集群名 |
| `--id ID`, `--user ID` | 使用 `client.ID` |
| `-n, --name TYPE.ID` | 完整实体名 |
| `-k, --keyring FILE` | 指定 keyring |
| `-m, --mon-host ADDR` | 直接指定 monitor |
| `--format plain|json|json-pretty|xml|...` | 输出格式 |
| `--connect-timeout SEC` | 建连超时 |
| `--status/-s` | status 快捷方式 |
| `-w, --watch` | 观察 cluster log；还有 info/sec/audit/warn/error 过滤 |
| `--admin-daemon SOCKET` | 通过本机 admin socket 命令 daemon |
| `--daemon TYPE.ID` | 定位 daemon admin socket |
| `--version/-v` | 客户端版本 |

凭据不要放进 shell history、命令参数或博客示例。优先最小 capability 的 client 和受控 keyring。

## 3. 第一层：健康摘要到详情

```bash
ceph status --format json-pretty
ceph health detail
ceph report --format json-pretty > ceph-report.json
```

`HEALTH_WARN` 是聚合结论，不是根因。记录 health check code、受影响对象、首次/当前时间，再进入对应子系统。`ceph report` 信息量大且可能含拓扑/配置，归档需权限保护。

## 4. 服务与 daemon

```bash
ceph mon stat
ceph quorum_status --format json-pretty
ceph mgr stat
ceph osd stat
ceph mds stat
ceph fs status
ceph orch status
ceph orch ps --format json-pretty
```

区分：daemon 进程是否运行、map 中是否 up/in、服务是否 active/standby、业务数据是否 healthy。`systemctl active` 不能替代 Ceph map 状态。

## 5. OSD、PG 与数据恢复

只读证据：

```bash
ceph osd tree
ceph osd df tree
ceph osd utilization
ceph pg stat
ceph pg dump pgs_brief
ceph pg ls-by-pool POOL
ceph pg map PGID
```

高风险控制命令包括 `osd out/in/down/lost`、`osd purge/destroy`、`pg repair`、修改 CRUSH、reweight、recovery/backfill flags。不要把 `pg repair` 当成通用按钮：先定位 inconsistent object、主副本、checksum 和底层设备，保存 `rados list-inconsistent-*` 证据。

## 6. 容量与 Pool

```bash
ceph df detail
ceph osd pool ls detail
ceph osd pool get POOL all
ceph osd pool autoscale-status
```

RAW、stored、used、max avail、replication/EC overhead、PG autoscaler、full ratio 是不同层。`MAX AVAIL` 受 CRUSH failure domain 和最满 OSD 限制，不是所有空闲盘简单相加。

创建/删除 pool 属于集群变更：

```text
osd pool create/set/delete/rename
```

删除需要双重确认仍可能不可恢复。必须核对 RBD/CephFS/RGW/CSI 使用关系，而不只看对象数。

## 7. 配置

```bash
ceph config dump
ceph config get osd.0 OPTION
ceph config show osd.0
ceph config assimilate-conf -i FILE --dry-run
```

`config get` 看配置数据库某层，`config show` 看 daemon 最终运行配置，两者可能受 local config/default/override 影响。`ceph config set/rm` 是持久变更；先保存 who/mask/level/source 和回滚值。

## 8. CephX

```bash
ceph auth ls
ceph auth get client.reader
ceph auth get-key client.reader   # 输出 secret，慎用
```

`auth get-or-create/caps/del/import` 会改变访问权限。cap 应按 mon/osd/mds/mgr 最小化，并明确 pool/namespace/path/network 限制。日志和工单不得记录 key。

## 9. Orchestrator

```bash
ceph orch host ls
ceph orch device ls --wide
ceph orch ls
ceph orch ps --refresh
```

`apply/daemon add/rm/redeploy/reconfig/host drain` 会触发编排变更。先读 spec、dry-run（若命令支持）、failure domain、service count 和 maintenance 状态。

## 10. 固定排障模板

```bash
date -Is
ceph version
ceph versions
ceph status --format json-pretty
ceph health detail
ceph mon stat
ceph quorum_status --format json-pretty
ceph osd tree
ceph osd df tree
ceph pg stat
ceph df detail
ceph orch ps --format json-pretty
```

先收集全局事实，再进入单个 daemon：

```bash
ceph daemon osd.0 perf dump
ceph tell osd.0 dump_historic_ops
```

admin socket/tell 输出可能很大，部分命令有性能影响；先查看 `help`。

完成标准：能从 status 分解到 quorum/service/OSD/PG/capacity/config，知道 up/down 与 in/out 不同，任何 repair/out/purge/pool delete/config set 都有证据和回滚。

继续阅读：[Ceph 学习路线](../ceph/00-Ceph学习路线.md)；参考：[Ceph 官方文档](https://docs.ceph.com/en/latest/)。
