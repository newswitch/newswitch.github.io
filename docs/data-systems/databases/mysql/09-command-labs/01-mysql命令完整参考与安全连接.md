---
title: "mysql 命令完整参考与安全连接"
sidebar_position: 1
tags: [MySQL, mysql客户端, 命令参考, TLS]
description: "系统整理 mysql 客户端连接、TLS、批处理、输出和交互命令，建立不泄露凭据的安全使用方式。"
---

# mysql 命令完整参考与安全连接

`mysql` 既是交互式 SQL Shell，也是脚本输入输出工具。选项会随 8.4 小版本增加或弃用，本文给出完整分类和生产高频参数；精确清单以目标二进制为准：

```bash
mysql --version
mysql --help
mysql --print-defaults
```

## 1. 安全连接模板

```bash
mysql --host=db.example.com --port=3306 \
  --user=observer --password \
  --protocol=TCP \
  --ssl-mode=VERIFY_IDENTITY \
  --ssl-ca=/secure/ca.pem \
  --connect-timeout=5 \
  --database=app
```

`--password`/`-p` 不带值会安全提示；`-pSecret` 会暴露在历史和进程列表，不要使用。也可用 `mysql_config_editor set --login-path=prod ...` 创建受保护 login path，再用 `--login-path=prod`，但它不是通用密钥保险箱，仍要保护本地文件和账户。

## 2. 连接参数

| 长参数 | 短参数 | 作用 |
|---|---|---|
| `--host` | `-h` | 主机名/IP |
| `--port` | `-P` | TCP 端口，注意大写 P |
| `--user` | `-u` | 用户 |
| `--password` | `-p` | 密码提示/凭据 |
| `--database` | `-D` | 默认数据库 |
| `--socket` | `-S` | Unix socket/Windows pipe |
| `--protocol` |  | TCP/SOCKET/PIPE/MEMORY |
| `--connect-timeout` |  | 建连超时秒数 |
| `--bind-address` |  | 绑定本地网卡 |
| `--login-path` |  | 读取 `.mylogin.cnf` 条目 |
| `--default-auth` |  | 客户端认证插件提示 |
| `--get-server-public-key` |  | 请求 RSA 公钥，先评估信任模型 |

本机写 `localhost` 可能走 socket，而 `127.0.0.1` 通常走 TCP；排障时显式指定 `--protocol`。

## 3. TLS 与压缩

| 参数 | 作用 |
|---|---|
| `--ssl-mode` | DISABLED/PREFERRED/REQUIRED/VERIFY_CA/VERIFY_IDENTITY |
| `--ssl-ca` / `--ssl-capath` | CA 文件/目录 |
| `--ssl-cert` / `--ssl-key` | 客户端证书/私钥 |
| `--ssl-cipher` | 允许的 TLS 1.2 cipher |
| `--tls-ciphersuites` | TLS 1.3 suites |
| `--tls-version` | 允许协议版本 |
| `--ssl-crl` / `--ssl-crlpath` | 吊销列表 |
| `--compression-algorithms` | zlib/zstd/uncompressed 集合 |
| `--zstd-compression-level` | zstd 级别 |

生产优先 `VERIFY_IDENTITY`；必须正确分发 CA 并匹配主机名。

## 4. 输入与执行

```bash
mysql --execute="SELECT @@version" --batch --skip-column-names
mysql --database=app < migration.sql
```

| 参数 | 短参数 | 作用 |
|---|---|---|
| `--execute` | `-e` | 执行语句并退出 |
| `--batch` | `-B` | 批处理、Tab 输出、无 history |
| `--quick` | `-q` | 流式读取，不缓存完整结果 |
| `--binary-mode` |  | 处理含 NUL/恢复输入时禁用部分转换 |
| `--force` | `-f` | SQL 错误后继续；迁移默认不建议 |
| `--init-command` |  | 建连后执行初始化 SQL |
| `--one-database` | `-o` | 仅在特定 `USE` 上下文处理输入，语义需验证 |
| `--max-allowed-packet` |  | 客户端包上限 |
| `--reconnect` / `--skip-reconnect` |  | 断线是否重连；事务脚本应谨慎 |

脚本应检查退出码、开启明确超时和事务边界。`--force` 可能把半失败迁移伪装为完成。

## 5. 输出控制

| 参数 | 短参数 | 作用 |
|---|---|---|
| `--table` | `-t` | 表格输出 |
| `--vertical` | `-E` | 纵向输出 |
| `--auto-vertical-output` |  | 宽结果自动纵向 |
| `--html` | `-H` | HTML |
| `--xml` | `-X` | XML |
| `--raw` | `-r` | 不转义字段 |
| `--silent` | `-s` | 更简洁，可重复 |
| `--skip-column-names` | `-N` | 不输出列名 |
| `--column-type-info` |  | 显示字段元数据 |
| `--binary-as-hex` |  | 二进制十六进制显示 |
| `--pager` |  | 交互分页器 |
| `--tee` |  | 复制输出到文件，注意敏感数据 |

生成 TSV/CSV 时要考虑 NULL、换行、Tab、字符集和转义，不能仅用文本替换冒充可靠 CSV。

## 6. 字符集与客户端行为

| 参数 | 短参数 | 作用 |
|---|---|---|
| `--default-character-set` |  | 客户端字符集 |
| `--auto-rehash` / `--no-auto-rehash` | `-A` 为 no-auto-rehash | 补全元数据速度权衡 |
| `--show-warnings` |  | 每条语句显示 warning |
| `--safe-updates` | `-U` | 限制无键更新/删除等交互误操作 |
| `--select-limit` |  | safe-updates 默认结果上限 |
| `--max-join-size` |  | safe-updates 扫描上限 |
| `--commands` |  | 是否允许本地 client commands，8.4 小版本需确认 |
| `--system-command` |  | 是否允许 `system` 命令 |

安全模式是辅助保护，不能替代权限、审批和备份。

## 7. Option File 控制

`--no-defaults`、`--defaults-file`、`--defaults-extra-file`、`--defaults-group-suffix` 必须放在命令行规定位置。用 `--print-defaults` 检查实际读入，但输出可能包含敏感项，注意终端记录。

## 8. 交互命令

| 命令 | 短命令 | 作用 |
|---|---|---|
| `help` | `\h` / `\?` | 帮助 |
| `clear` | `\c` | 清除未发送语句 |
| `go` | `\g` | 执行 |
| `ego` | `\G` | 纵向执行 |
| `use db` | `\u db` | 切库 |
| `source file` | `\.` | 执行文件 |
| `delimiter` | `\d` | 改分隔符 |
| `status` | `\s` | 连接状态 |
| `warnings` | `\W` | 开启 warning |
| `pager` / `nopager` | `\P` / `\n` | 分页器 |
| `tee` / `notee` | `\T` / `\t` | 会话记录 |
| `quit` | `\q` | 退出 |
| `system` | `\!` | 执行本机命令，高风险 |

`delimiter` 是客户端命令，不是发送给服务器的 SQL。

## 9. 排障顺序

```bash
mysql --version
mysql --no-defaults --protocol=TCP -h HOST -P PORT -u USER -p \
  --ssl-mode=VERIFY_IDENTITY --ssl-ca=CA.pem
```

分别验证 DNS/TCP、TLS、认证、授权、默认库和 SQL；不要用 root 无 TLS“试一下”而绕过真正问题。

## 参考资料

- [mysql Client](https://dev.mysql.com/doc/refman/8.4/en/mysql.html)
- [mysql Client Options](https://dev.mysql.com/doc/refman/8.4/en/mysql-command-options.html)
- [mysql Client Commands](https://dev.mysql.com/doc/refman/8.4/en/mysql-commands.html)

