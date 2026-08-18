---
title: "export 命令详解：进程环境、函数导出与作用域边界"
sidebar_label: "09. export 命令详解：进程环境、函数导出与作用域边界"
sidebar_position: 9
description: "完整讲解 Bash export 的 -f/-n/-p、NAME=VALUE、后代继承、环境快照、密钥泄露与 systemd/container 边界。"
tags: [Linux, Bash, export, 环境变量, 安全]
---

# export 命令详解：进程环境、函数导出与作用域边界

`export` 给 shell variable 加 export 属性；Bash 随后启动外部程序时把名称和值复制进其 environment。子进程不能反向修改父 Shell，也不能靠 `export` 改变已经运行的 sibling/service。

## 1. 全部参数

```text
export [-fn] [NAME[=VALUE] ...]
export -p
```

| 参数 | 含义 |
|---|---|
| `-f` | 作用于 Shell function，而非变量 |
| `-n` | 删除 export 属性，不删除变量 |
| `-p` | 以可作为输入重用的格式列出 exported names |

```bash
export LANG=C.UTF-8
export -n DEBUG
export -p
```

赋值和导出同一条命令更清楚。`NAME=value command` 只为那次命令临时加入环境，通常比全局 export 更小作用域。

## 2. 继承与快照

外部进程在 `execve` 时得到环境快照；之后父子各自修改互不回传。Shell function 和 builtin 在当前 Shell 运行时可能看到未 export 的变量，这就是“脚本内有效、外部程序看不到”的常见根因。

systemd unit、容器、Kubernetes Pod 的环境通常在服务/容器创建时固定。修改登录 Shell 的 export 不会改变它们，需通过对应 manager 变更并重建/重启。

## 3. 安全边界

- token 放环境比 argv 稍好但并非秘密存储：同权限进程、core dump、`/proc/PID/environ`、诊断包可能读取。
- `export -f` 通过特殊环境编码传 Bash function，跨信任边界应清理，非 Bash 程序也不需要它。
- 不要 `export $(cat .env)`：会错误分词、执行展开并泄露内容。使用明确解析器和 allowlist。
- 调试 `env`/`export -p` 前脱敏。

## 4. 验收与参考

能预测变量是否进入外部命令，解释父子环境快照，使用最小临时环境，并识别 secret 泄露路径。

- [Bash Bourne Shell Builtins：export](https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html)

下一篇：[readonly 与 unset 命令详解](./10-readonly-unset命令详解.md)。
