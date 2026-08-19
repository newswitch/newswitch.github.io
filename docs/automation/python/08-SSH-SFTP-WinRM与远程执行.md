---
title: "Python SSH、SFTP、WinRM 与远程执行"
sidebar_label: "08. SSH、SFTP、WinRM 与远程执行"
sidebar_position: 8
description: "设计安全的 Linux/Windows 远程执行适配器，处理主机身份、认证、超时、命令边界、文件传输和结构化结果。"
tags: [Python, SSH, SFTP, WinRM, Remote Execution]
---

# Python SSH、SFTP、WinRM 与远程执行

远程执行库解决连接协议，不自动解决命令幂等、提权、目标选择和回滚。多主机配置治理优先使用 Ansible；Python 适合构建诊断工具、特殊协议适配器或平台控制面。

## 1. 先定义结果契约

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class RemoteResult:
    target: str
    command_name: str
    exit_code: int | None
    stdout: bytes
    stderr: bytes
    duration_seconds: float
    transport_error: str | None = None
    timed_out: bool = False
```

传输失败与远端命令非零必须分开。文本解码在上层按协议约定完成，避免错误编码让诊断程序崩溃。

## 2. 系统 SSH 还是 Python 库

| 方式 | 优势 | 代价 |
| --- | --- | --- |
| `subprocess` 调用系统 `ssh` | 复用 OpenSSH 配置、Agent 和 ProxyJump | 输出、超时和进程组需自行管理 |
| Paramiko 等库 | Python 内控制连接与 SFTP | 单独管理算法、Host Key、连接池和升级 |
| AsyncSSH 等异步库 | 大量并发连接 | 需要 asyncio 架构和更严格取消管理 |

选择后固定并测试版本，跟踪加密算法和安全公告。

## 3. 系统 SSH 示例

```python
import subprocess

def run_ssh(host: str, remote_script: str, timeout: float) -> subprocess.CompletedProcess[bytes]:
    command = [
        "ssh",
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=yes",
        "--",
        host,
        "bash", "-s", "--",
    ]
    return subprocess.run(
        command,
        input=remote_script.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )
```

使用参数列表而不是 `shell=True` 和字符串拼接。`subprocess` 超时后还要验证子进程及其派生进程是否被正确终止。

## 4. 主机身份

- 预先管理可信 Host Key。
- Host Key 变化触发阻断和核验，不自动接受。
- 资产名、连接地址和主机身份建立明确映射。
- 跳板机和代理配置也进入版本与审计。

关闭 Host Key 校验会让凭据和命令暴露给中间人，不是自动化便利设置。

## 5. 认证和提权

- 使用专用自动化身份。
- 优先短期 SSH Certificate 或受管密钥。
- 私钥不写入代码、日志和证据包。
- Sudo 只授权固定管理动作。
- 远端环境不依赖交互密码提示。

Python 进程不能因为隐藏了密码输入就绕过权限治理。

## 6. 远端命令边界

SSH 协议最终可能把命令交给远端 Shell。不要把外部数据拼成命令字符串。可选方案：

- 传输固定脚本，数据使用 JSON/stdin。
- 调用远端预安装的受限 Agent/API。
- 对固定命令使用经过验证的参数编码。
- 多主机状态管理交给 Ansible 模块。

远端脚本输出带版本的 JSON，stderr 保存诊断，退出码保存分类。

## 7. SFTP 文件传输

安全发布流程：

```text
上传到目标目录候选文件
→ 校验摘要、Owner 和 Mode
→ 远端语法验证
→ 同文件系统原子切换
→ Reload
→ 健康检查
→ 失败回退
```

不要直接覆盖服务正在读取的正式文件。传输成功也不等于配置生效。

## 8. WinRM

Windows 自动化需要同时处理：

- HTTPS Listener、证书和主机身份。
- 身份验证机制与域策略。
- PowerShell 编码、对象序列化和退出状态。
- UAC、权限提升和双跳问题。
- 连接、操作和读取超时。

禁止为方便测试启用不安全的明文传输或全局可信主机。批量 Windows 配置可使用 Ansible WinRM/PSRP 或组织标准平台。

## 9. 并发和容量

连接数受本机文件描述符、线程/Task、跳板机、SSH 服务和认证后端共同限制。采用分批、有界并发和失败阈值；一个目标超时不能占用 Worker 永久等待。

## 10. 故障分类

```text
DNS/路由
→ TCP 连接
→ SSH/WinRM 握手
→ 主机身份
→ 认证
→ 授权/提权
→ 远端解释器
→ 命令执行
→ 文件传输
→ 业务验收
```

每层保留有限、脱敏证据，避免把所有问题都报告成“SSH 执行失败”。
