---
title: "Packer Provisioner、Ansible 与配置边界"
sidebar_label: "04. Provisioner 与 Ansible"
sidebar_position: 4
description: "选择 Shell/Ansible Provisioner，保证步骤幂等、失败可见，并划分构建期和启动期配置。"
tags: [Packer, Provisioner, Ansible, Image Build]
---

# Packer Provisioner、Ansible 与配置边界

## 1. Provisioner 用途

安装稳定基础包、加固、Agent 和运行时。环境地址、业务 Secret、节点身份和动态配置留给启动期系统。

## 2. Shell Provisioner

脚本进入 Git，使用严格错误处理、非交互包管理、固定来源和清理。不要把大型脚本以内联字符串塞进 HCL。

## 3. Ansible Provisioner

复用经过测试的 Role，固定 Collection 版本和 Inventory 边界。镜像构建常只有一台临时主机，但仍应验证幂等和 Handler。

## 4. 构建期与启动期

| 构建期 | 启动期 |
| --- | --- |
| OS 补丁、基础包、驱动、Agent | 主机名、实例身份、环境配置、短期 Secret |

镜像中过多环境配置会造成镜像爆炸；过少则每次启动耗时和失败面过大。

## 5. 重启

内核/驱动更新可能要求重启。Communicator 需要等待并重新连接，不能以 SSH 断开直接判断失败。重启后验证内核、服务和设备。

## 6. 幂等与测试

Provisioner 重跑不应破坏系统。测试故障中断后重新构建，而不是依赖恢复某台污染的临时实例。
