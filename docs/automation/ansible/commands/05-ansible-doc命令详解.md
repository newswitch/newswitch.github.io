---
title: "ansible-doc 命令详解"
sidebar_label: "05. ansible-doc 命令详解"
sidebar_position: 5
description: "详解 ansible-doc 的插件类型、列表、来源文件、Snippet、JSON、Role 入口点和模块搜索参数。"
tags: [Ansible, ansible-doc, Module, Plugin, CLI]
---

# ansible-doc 命令详解

`ansible-doc` 查询当前环境实际安装的模块和插件文档，比只查看网页更能反映锁定版本的参数与返回值。

## 1. 基本用法

```bash
ansible-doc ansible.builtin.copy
ansible-doc -s ansible.builtin.template
ansible-doc -t inventory -l
ansible-doc -t connection ssh
```

## 2. 参数

| 短参数 | 长参数 | 含义 |
| --- | --- | --- |
| `-t` | `--type` | 插件类型，如 module、inventory、connection、lookup、filter、callback、strategy、role、keyword 等 |
| `-l` | `--list` | 列出可用插件，可附命名空间/Collection 过滤 |
| `-F` | `--list_files` | 列出插件名和源文件路径，隐含 List |
| `-s` | `--snippet` | 为 inventory、lookup、module 输出示例片段 |
| `-j` | `--json` | JSON 输出，便于工具处理 |
| `-M` | `--module-path` | 追加模块库路径，可重复 |
| `-r` | `--roles-path` | Role 搜索路径，可重复 |
| `-e` | `--entry-point` | 选择 Role 的入口点 |
|  | `--playbook-dir` | 为 Roles/Group Vars 等提供基准目录 |
|  | `--metadata-dump` | 内部用途：转储全部条目 JSON 元数据 |
|  | `--no-fail-on-errors` | 仅与 Metadata Dump 配合，将错误写入 JSON |
| `-v` | `--verbose` | 详细诊断，可叠加 |
| `-h` | `--help` | 当前版本帮助 |
|  | `--version` | 版本、配置与路径 |

位置参数 `plugin ...` 是一个或多个 FQCN/插件名称。

## 3. 阅读模块文档

重点区域：

```text
SYNOPSIS/DESCRIPTION：状态模型
OPTIONS：参数类型、默认、互斥和版本
ATTRIBUTES：Check/Diff/Platform 支持
NOTES：权限和边界
EXAMPLES：语法示意，不等于生产模板
RETURN：Register 结果字段契约
```

## 4. 查来源与冲突

```bash
ansible-doc -F community.general
ansible-doc -t module -l | rg 'copy|template'
```

如果短名指向非预期 Collection，改用 FQCN，并检查 Collection 搜索路径与版本。

## 5. 机器读取

```bash
ansible-doc -j ansible.builtin.file > .artifacts/file-module-doc.json
```

JSON Schema 可能随版本变化；工具必须固定 ansible-core 并测试字段，不能抓取终端文本。

## 6. 常见误区

- 只看最新版网页，实际 EE 安装的是旧版 Collection。
- 从 Example 推断所有参数和 Check Mode 能力。
- 忽略 RETURN，硬编码不存在的 `stdout/rc`。
- 使用短模块名导致同名冲突。
- 把 `--metadata-dump` 当日常稳定 API。

## 7. 官方资料

- [`ansible-doc` CLI](https://docs.ansible.com/projects/ansible/latest/cli/ansible-doc.html)
