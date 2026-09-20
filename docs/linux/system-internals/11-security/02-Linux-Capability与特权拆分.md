---
title: "Linux Capability 与特权拆分：root 权限怎样被拆成集合"
sidebar_label: "02. Linux Capability 与特权拆分"
sidebar_position: 2
description: "解释 permitted/effective/inheritable/bounding/ambient 集合、file capability、exec 转换和 Namespace 作用域。"
tags: [Linux, Capability, Privilege, setcap, User Namespace]
---

# Linux Capability 与特权拆分：root 权限怎样被拆成集合

Linux 把传统 root 特权拆为多项 capability，但它们不是细粒度到单个对象的完整授权系统。某些 capability，尤其 `CAP_SYS_ADMIN`，覆盖面仍很广。

## 1. 五个集合

| 集合 | 含义 |
|---|---|
| Permitted | 线程可放入 Effective 的上限集合 |
| Effective | 当前执行权限检查实际使用 |
| Inheritable | 跨 exec 参与继承计算的候选 |
| Bounding | 进程及后代通过 exec 可获得能力的上界 |
| Ambient | 非特权程序 exec 时可保留的能力，受严格条件约束 |

```bash
grep -E '^Cap(Inh|Prm|Eff|Bnd|Amb):' /proc/<PID>/status
capsh --decode=<hex>
getpcaps <PID>
```

## 2. File capability 与 exec

文件 `security.capability` xattr 可在 exec 时参与新 credential 计算：

```bash
getcap -r /usr/bin 2>/dev/null
setcap cap_net_bind_service=ep /path/to/program
```

实际结果还受 bounding、no_new_privs、User Namespace、LSM、文件系统/xattr 和挂载条件影响。复制/打包文件可能丢失 xattr，升级覆盖二进制也可能改变 capability。

## 3. Capability 不是“给容器管理员权限”

检查通常问进程在管理目标对象的 User Namespace 中是否具有相应 capability。容器自身 User Namespace 的 `CAP_SYS_ADMIN` 不等于初始 Namespace 的同名能力。

## 4. 高影响 capability

- `CAP_SYS_ADMIN`：挂载、Namespace 和大量管理接口，范围非常广。
- `CAP_SYS_MODULE`：加载/卸载内核模块，近似获得内核代码执行。
- `CAP_SYS_PTRACE`：跨进程检查/注入，可能读取凭据。
- `CAP_BPF`、`CAP_PERFMON`：拆分部分 BPF/perf 权限，但版本和 LSM 仍影响。
- `CAP_NET_ADMIN`：在适用 NetNS 管理路由、防火墙、接口。

最小权限应从 drop all 开始按行为添加，并记录为何需要。

## 5. 练习与答案

**问题：添加 `CAP_NET_BIND_SERVICE` 能否让程序监听任意宿主端口？**

答案：它只处理低端口特权检查；端口仍受所属 Network Namespace、占用状态、LSM 和应用绑定地址约束。

**问题：把 capability 放进 Permitted 就一定生效吗？**

答案：不一定。多数检查使用 Effective；不同集合在 exec 和运行时转换中有严格关系。

下一篇：[LSM Hook 与安全决策链](./03-LSM-Hook与安全决策链.md)
