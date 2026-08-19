---
title: "Shell 输入、权限、Secret 与注入防护"
sidebar_label: "10. 输入、权限与注入防护"
sidebar_position: 10
description: "防止参数、路径、配置和远端目标形成命令注入，控制 sudo、环境、临时文件、日志和 Secret 暴露。"
tags: [Bash, Security, Command Injection, Secret, sudo]
---

# Shell 输入、权限、Secret 与注入防护

Shell 把代码和数据写在相似的文本形式中，因此最大的安全原则是：数据永远作为参数传递，不重新解释为 Shell 代码。

## 1. 禁止拼接和 Eval

危险：

```bash
cmd="curl $user_options $url"
eval "$cmd"
```

安全方向：

```bash
curl_options=(--fail --silent --show-error --max-time 10)
curl "${curl_options[@]}" -- "$url"
```

只有程序作者定义命令和选项结构，外部输入只能填充经过校验的数据字段。

## 2. 白名单验证

```bash
case $environment in
  test|staging|production) ;;
  *) printf 'invalid environment\n' >&2; exit 2 ;;
esac

[[ $port =~ ^[0-9]+$ ]] || exit 2
((port >= 1 && port <= 65535)) || exit 2
```

不要尝试通过删除几个危险字符把任意字符串变安全。根据业务模型验证枚举、长度、字符集、数值范围和路径根。

## 3. 路径攻击

```bash
resolved=$(readlink -f -- "$requested") || exit 2
case $resolved in
  /etc/app/*) ;;
  *) printf 'path outside allowed root\n' >&2; exit 2 ;;
esac
```

还要考虑符号链接、挂载点、TOCTOU 竞争和文件 Owner。高风险写操作优先让受限特权组件执行，而不是让整个脚本以 root 运行。

## 4. Sudo 最小权限

不授予自动化账户任意 Shell：

```text
错误方向：NOPASSWD: ALL
更安全方向：固定程序、固定参数边界、固定目标目录
```

但仅在 sudoers 中写固定命令名仍可能被参数、配置文件、环境变量或可写插件目录绕过。需要分析被授权程序的完整扩展面。

## 5. Secret 生命周期

避免：

- 把密码写在命令行参数。
- `set -x` 时执行含 Secret 的命令。
- 把环境和配置完整打印到日志。
- 在共享 `/tmp` 创建宽权限文件。
- 将 Secret 写进 Git、制品或诊断包。

短时间关闭追踪也要谨慎恢复原状态：

```bash
case $- in
  *x*) xtrace_was_on=true; set +x ;;
  *)   xtrace_was_on=false ;;
esac

# 获取并使用 Secret，不输出值

[[ $xtrace_was_on == true ]] && set -x
```

更好的方案是让执行平台通过文件描述符、权限受控临时文件或短期身份提供凭据。

## 6. PATH 与命令劫持

自动化使用受控 `PATH`：

```bash
readonly PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
```

关键命令可以在启动时验证来源和版本。不要把当前目录或用户可写目录放在特权脚本 PATH 前部。

函数、Alias、`BASH_ENV`、`CDPATH`、语言运行时环境和插件路径都可能改变行为，应在执行环境中控制。

## 7. 不可信输入清单

- CLI 参数和环境变量。
- 文件名、目录名和符号链接。
- API、DNS、CMDB 和 Inventory 返回值。
- Git 分支、Tag、Commit Message 和仓库内容。
- SSH 远端输出。
- 日志和监控标签。
- CI 合并请求中的配置。

即使数据来自内部系统，也必须按接口契约验证。

## 8. 安全验收

- [ ] 没有 `eval` 和字符串命令拼接。
- [ ] 参数使用数组并正确引用。
- [ ] 写入目标位于固定允许根目录。
- [ ] 特权范围小于整个脚本。
- [ ] Secret 不进入参数、日志、Git 和长期临时文件。
- [ ] 执行环境的 PATH、解释器和依赖可验证。
- [ ] 不可信仓库不能直接取得生产凭据。
