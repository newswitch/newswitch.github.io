---
title: "Packer Golden Image 综合项目"
sidebar_label: "08. Golden Image 综合项目"
sidebar_position: 8
description: "构建 Linux Golden Image，串联 Packer、Ansible、测试、SBOM、Terraform 金丝雀和生产晋级。"
tags: [Packer, Golden Image, Ansible, Terraform, 综合项目]
---

# Packer Golden Image 综合项目

## 1. 目标

构建包含基础补丁、监控 Agent、容器运行时和安全基线的 Linux 镜像；不包含环境 Secret 和业务配置。

## 2. 流程

```text
锁定基础镜像
→ Packer 创建临时实例
→ Ansible Role 配置
→ 清理机器唯一身份
→ 生成候选镜像和 Manifest
→ 启动测试/扫描/SBOM
→ Terraform 创建金丝雀节点
→ 业务验收
→ 镜像晋级
```

## 3. 仓库

```text
image-factory/
├── packer/
├── ansible/
├── tests/
├── terraform-smoke/
└── policies/
```

## 4. 门禁

- 基础镜像发布者和 ID 允许列表。
- Provisioner 依赖锁定。
- 镜像无凭据、主机密钥和构建日志。
- 启动、网络、磁盘、时钟、Agent 和容器测试通过。
- 漏洞超过阈值阻止晋级。

## 5. 生产滚动

新建节点池，先替换一台非关键节点，验证后按故障域分批。旧节点排空前确认工作负载、存储和 GPU/网络设备状态。

## 6. 验收

- [ ] 任一镜像可追溯基础 ID、Commit、依赖和测试。
- [ ] 测试到生产使用同一产物。
- [ ] 构建失败无孤儿资源。
- [ ] 旧镜像在回滚窗口可用。
- [ ] 镜像删除不会破坏启动模板和灾备。
