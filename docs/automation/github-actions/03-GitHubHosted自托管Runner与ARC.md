---
title: "GitHub-hosted、自托管 Runner 与 Actions Runner Controller"
sidebar_label: "03. Runner 与 ARC"
sidebar_position: 3
description: "比较托管与自托管 Runner，设计 Runner Group、短生命周期执行器、Kubernetes ARC、网络和容量隔离。"
tags: [GitHub Actions, Runner, ARC, Kubernetes, 自托管]
---

# GitHub-hosted、自托管 Runner 与 Actions Runner Controller

## 1. 选择执行环境

| 方案 | 优点 | 主要边界 |
| --- | --- | --- |
| GitHub-hosted | 生命周期短、维护少、环境标准 | 网络接入、规格、成本和合规限制 |
| 长驻自托管 | 可访问内网/硬件、环境可控 | 残留、横向移动、补丁和容量管理 |
| Ephemeral 自托管 | 每 Job 新实例，隔离更强 | 镜像工厂、启动延迟和编排复杂度 |
| ARC/Kubernetes | 弹性、队列驱动、平台统一 | 集群安全、Pod 隔离、控制器与配额 |

## 2. 自托管 Runner 的信任问题

Job 可以执行任意仓库代码。若 Runner 长期在线，恶意任务可能读取工作目录、容器 Socket、云实例元数据、SSH Agent、缓存或其他进程。仅在 Job 结束后 `rm` 工作区不能证明环境已恢复可信。

原则：不可信 PR 使用 GitHub-hosted 或一次性隔离 Runner；生产发布 Runner 只服务受保护分支和受审工作流，并放入独立 Runner Group、网络和云账户。

## 3. Label 与 Group

Label 描述能力，如 OS、架构、GPU；Runner Group 表达组织/仓库可用范围。不要用用户可控输入拼接 `runs-on` 选择高权限 Runner。高权限发布 Runner 的仓库访问列表必须最小化。

## 4. ARC 执行链

```text
GitHub Job Queue
→ ARC Listener/Controller
→ 创建 Ephemeral Runner Pod
→ Runner 获取一个 Job
→ 执行并上传结果
→ Pod 销毁
```

Kubernetes 中仍需限制 ServiceAccount、NetworkPolicy、HostPath、特权、容器运行时 Socket、Node 污点和镜像来源。Runner Pod 不应能管理 ARC 自身或读取其他 Namespace Secret。

## 5. 容量模型

记录队列等待、启动时间、Job 时长、失败率、并发上限和每类 Runner 成本。扩容速度受节点池、镜像拉取、PVC、配额和外部 API 限制；仅增加 Pod 上限可能把压力转移到 GitHub、Harbor、编译缓存或云 API。

## 6. 运营清单

- Runner 版本、OS、工具链和基础镜像定期升级；
- 长驻 Runner 禁止跨信任域复用；
- 出站网络只允许 GitHub、制品库和必要下游；
- 运行日志、注册/注销和异常离线有监控；
- 用 Packer/容器镜像重建，不手工漂移；
- 令牌和注册材料短期化，不写入镜像。
