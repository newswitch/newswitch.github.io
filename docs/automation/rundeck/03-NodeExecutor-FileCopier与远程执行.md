---
title: "Rundeck Node Executor、File Copier 与远程执行"
sidebar_label: "03. 远程执行与文件传输"
sidebar_position: 3
description: "理解 Node Executor 与 File Copier，安全使用 SSH、WinRM、API 和插件执行远程命令。"
tags: [Rundeck, Node Executor, SSH, WinRM, Remote Execution]
---

# Rundeck Node Executor、File Copier 与远程执行

## 1. 两类插件

Node Executor 决定如何在目标执行命令；File Copier 决定如何传输脚本或文件。两者可独立配置，凭据、Host Key、代理和超时必须匹配。

## 2. SSH 安全

- 使用专用账户和最小 sudo 规则，不共享 Root 私钥；
- 强制验证 Host Key，主机替换有受控更新流程；
- 私钥/证书从 Key Storage 或短期 CA 获取；
- 限制跳板、来源网络和可执行命令；
- 连接、握手、命令和空闲超时分别设置；
- 禁止把密码放在 Node 属性、Option 默认值和命令参数。

## 3. 命令构造

Option 或 Node 属性属于不可信输入。优先调用参数化脚本/API；Shell 中使用参数数组/严格引用和允许列表，不拼接 `sh -c "...${option}..."`。

## 4. 脚本传输

脚本生成校验和和版本，上传到受限临时目录，设置最小权限，执行后清理。目标不可执行或网络中断时，清理也必须幂等；不要把 Secret 嵌入脚本文件。

## 5. Windows 与 API

WinRM 需明确 TLS、认证和 PowerShell 编码/退出码。API 型 Executor 使用 HTTPS、短期 Token、请求超时、幂等键和状态查询；HTTP 200 不一定代表异步任务完成。

## 6. 退出结果

Rundeck 主要根据插件/进程状态判断 Step 成败。脚本必须正确返回非零退出码，并将结构化结果写到受控输出；只打印“FAILED”再返回 0 会被当成功。

## 7. 排障

按 DNS/TCP/TLS、认证、Host Key/权限、传输、远端 Shell、sudo/环境、命令退出码和日志回传逐层定位。用同一服务身份在隔离节点复现，不复制生产私钥到个人主机。
