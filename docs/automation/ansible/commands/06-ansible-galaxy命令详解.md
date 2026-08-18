---
title: "ansible-galaxy 命令详解"
sidebar_label: "06. ansible-galaxy 命令详解"
sidebar_position: 6
description: "详解 ansible-galaxy 的 Collection 和 Role 初始化、构建、下载、安装、验证、发布、列表与供应链边界。"
tags: [Ansible, ansible-galaxy, Collection, Role, CLI]
---

# ansible-galaxy 命令详解

```text
ansible-galaxy [COMMON] {collection|role} ACTION [OPTIONS]
```

该工具管理 Role 和 Collection；官方说明 CLI 自身不适合并发运行，同一安装路径需要外部调度和锁。

## 1. Collection 子命令

| 命令 | 用途 |
| --- | --- |
| `collection init` | 创建 Collection 骨架 |
| `collection build` | 从源码构建 Tar Artifact |
| `collection install` | 从 Galaxy、URL、本地包或 Requirements 安装 |
| `collection download` | 下载 Collection 及依赖供离线安装 |
| `collection list` | 列出已安装 Collection |
| `collection verify` | 将已安装内容与服务器 Artifact 比较验证 |
| `collection publish` | 向 Galaxy/Automation Hub 发布 Artifact |

## 2. Role 子命令

| 命令 | 用途 |
| --- | --- |
| `role init` | 创建 Role 骨架 |
| `role install` | 安装 Role/Requirements |
| `role list` | 列出本地 Role |
| `role info` | 查看 Role 信息 |
| `role search` | 搜索 Galaxy Role |
| `role remove` | 删除本地 Role |
| `role import`、`delete`、`setup` | 与 Galaxy 远端 Role 管理相关 |

## 3. 常见参数族

不同 Action 参数不同，必须运行两级帮助：

```bash
ansible-galaxy collection install --help
ansible-galaxy role install --help
```

| 参数 | 常见用途 |
| --- | --- |
| `-r/--requirements-file` | 从 Requirements 安装/下载 |
| `-p/--collections-path` 或 Action 对应路径参数 | 指定安装目录 |
| `-n/--no-deps` | 不解析依赖，可能导致运行缺包 |
| `--pre` | 允许预发布版本 |
| `--force`、`--force-with-deps` | 覆盖安装，需谨慎 |
| `--offline` | 使用本地数据执行支持的操作 |
| `--server` | 指定 Galaxy/Hub Server |
| `--token/--api-key` | 发布或访问认证，不能进入日志 |
| `--timeout` | Server 操作超时 |
| `-c/--ignore-certs` | 忽略 TLS 校验，不应成为生产常态 |
| `--no-cache`、`--clear-response-cache` | 控制 Server 响应缓存 |
| `-v/--verbose` | 可叠加诊断 |

参数名称会按 Collection/Role Action 区分，以上不能跨 Action 机械套用。

## 4. 锁定安装

```yaml
collections:
  - name: ansible.posix
    version: "==<validated-version>"
  - name: community.general
    version: "==<validated-version>"
```

```bash
ansible-galaxy collection download \
  -r collections/requirements.yml \
  -p .artifacts/collections

ansible-galaxy collection install \
  -r collections/requirements.yml \
  -p .ansible/collections
```

生产使用内部镜像/Hub、摘要和不可变 Execution Environment，不在作业开始时联网解析最新版依赖。

## 5. 构建与验证

```bash
ansible-galaxy collection build
ansible-galaxy collection verify acme.platform
```

Verify 不是完整供应链证明。还需要来源审查、Artifact 摘要/签名、SBOM、漏洞和许可证扫描。

## 6. 常见误区

- Requirements 不写版本范围或使用可变分支。
- `--force` 覆盖后未记录旧版本。
- `--ignore-certs` 绕过企业 CA 配置问题。
- 不同执行节点共享路径并发安装。
- 把 Collection Verify 当成代码安全审计。
- Role 与 Collection 搜索路径在本地和 AWX 不一致。

## 7. 官方资料

- [`ansible-galaxy` CLI](https://docs.ansible.com/projects/ansible/latest/cli/ansible-galaxy.html)
