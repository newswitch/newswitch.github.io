---
title: "源码编译部署 MySQL 与适用边界"
sidebar_label: "06. 源码编译部署 MySQL 与适用边界"
sidebar_position: 6
description: "理解 MySQL 8.4 源码构建的依赖、CMake 配置、编译测试、制品化、运行部署以及为什么生产默认不应自行编译。"
tags: [MySQL, 源码编译, CMake, 调试, 制品]
---

# 源码编译部署 MySQL 与适用边界

源码编译适合内核学习、问题定位、调试符号、Sanitizer、实验补丁和特殊平台验证。它不是普通生产部署的默认方案：一旦自行编译，编译器、依赖、选项、安全修复、测试和制品发行的责任都转移给自己。

## 1. 什么时候值得编译

| 场景 | 是否合适 | 说明 |
| --- | --- | --- |
| 阅读源码、打断点、跟踪执行路径 | 合适 | 可构建 Debug/RelWithDebInfo 并保留符号 |
| 复现上游 Bug、验证补丁 | 合适 | 构建必须与问题版本和参数对应 |
| ASan/UBSan 等内存检查 | 合适 | 只用于隔离测试，性能不可代表生产 |
| 官方包支持的普通生产环境 | 通常不合适 | 官方制品更容易获得一致的安全和回归保障 |
| “自己编译一定更快” | 不成立 | 非标准选项可能降低性能、功能或安全性 |
| 为了修改一两个运行参数 | 不合适 | 绝大多数参数无需重新编译 |

生产若确实使用自编译版本，必须把它当成内部发行版：有源码基线、补丁队列、可重复构建、签名、SBOM、完整测试、发布负责人和紧急安全更新 SLA。

## 2. 从源码到运行实例

```text
source tag/tarball
  → compiler + CMake + dependencies
  → configure（决定功能与路径）
  → compile
  → unit/integration/mysql-test-run tests
  → install staging directory
  → package + manifest + signature
  → deploy immutable artifact
  → initialize datadir
  → systemd lifecycle
```

编译机器不应直接成为生产数据库主机。更可靠的方式是在干净构建环境产出不可变制品，再按离线二进制部署流程交付。

## 3. 选择源码基线

学习稳定版本时优先使用官方标准源码发行包或明确的 8.4.x release tag，而不是开发分支最新提交。记录：

```text
MySQL version/tag/commit
source archive SHA-256 and signature result
compiler and linker version
CMake version and full options
OpenSSL/system library versions
build OS/container digest
test suite result
```

若从开发树构建，还需要 Git、Bison 等额外工具。MySQL 8.4 源码使用 C++17，官方列出的 Linux 最低编译器基线为 GCC 10 或 Clang 12；实际选择仍以目标补丁版本官方文档为准。

## 4. 构建依赖

不同发行版包名不同，本文不提供一条跨系统的“万能安装命令”。需要的类别包括：

- CMake 与 GNU Make/Ninja；
- 支持 C++17 的 GCC/Clang；
- OpenSSL 开发库；
- ncurses 开发库；
- Perl 和测试依赖；
- 开发树构建需要的 Git、Bison 等；
- 足够的 CPU、内存和磁盘空间。

```bash
cmake --version
gcc --version
make --version
openssl version
```

将依赖版本固定在构建镜像或锁定的基础环境中。直接使用长期漂移的构建主机，会导致同一源码产出不同制品。

## 5. Out-of-source 构建

源码目录保持只读，在独立 build 目录生成中间文件：

```bash
cmake -S /build/src/mysql-8.4.x \
  -B /build/work/mysql-8.4.x \
  -DCMAKE_INSTALL_PREFIX=/opt/mysql/mysql-8.4.x-custom1 \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DWITH_SSL=system \
  -DWITH_SYSTEMD=1

cmake --build /build/work/mysql-8.4.x --parallel <jobs>
```

参数含义：

| 参数 | 作用 | 风险 |
| --- | --- | --- |
| `CMAKE_INSTALL_PREFIX` | 安装制品根目录 | 不能覆盖系统已有 MySQL |
| `CMAKE_BUILD_TYPE` | 优化和调试符号策略 | Debug/ASan 不能用于性能结论 |
| `WITH_SSL=system` | 使用系统 OpenSSL | 系统库兼容与安全更新需跟踪 |
| `WITH_SYSTEMD=1` | 构建 systemd 支持 | unit 仍要按目标环境安装和验证 |

实际 CMake 选项会随版本变化，必须以当前源码的 `CMakeLists.txt`、CMake 输出和官方配置选项为准。不要从旧博客复制已经删除或改变语义的参数。

### 5.1 构建类型建议 {/* #构建类型建议 */}

```text
Debug：断言多、便于调试、性能差
RelWithDebInfo：优化 + 符号，适合性能剖析和问题定位
Release：优化制品，仍需单独保留符号和构建信息
Sanitizer：检查内存/未定义行为，只用于隔离测试
```

同一个性能实验不能把官方 Release 和自编译 Debug 直接对比。

## 6. 测试不是“能编过”

至少分四层：

1. 编译期测试和静态检查；
2. MySQL 项目测试套件，保存失败、跳过和耗时；
3. 新建实例的初始化、启停、SQL、崩溃恢复和升级测试；
4. 目标业务回归、基准、复制、备份恢复和故障注入。

开发树的测试方式和依赖可能变化，应使用所选源码版本随附的测试说明。不能因为测试耗时长就直接跳过，然后把制品放入生产。

## 7. 安装到 staging，而不是污染构建机

```bash
cmake --install /build/work/mysql-8.4.x \
  --prefix /staging/opt/mysql/mysql-8.4.x-custom1
```

对 staging 目录执行：

- 列出所有文件、所有者和权限；
- 扫描动态库依赖与 RPATH；
- 生成 SHA-256、SBOM 和构建 manifest；
- 分离并安全保存调试符号；
- 对制品签名并上传内网仓库；
- 在干净运行主机验证，不依赖构建目录残留。

`mysqld --version` 只能证明程序能加载，不能证明功能完整。还要检查插件、字符集、SSL、认证、备份工具和连接器兼容性。

## 8. 运行部署

运行阶段复用[通用二进制包离线部署](./04-通用二进制包离线部署与systemd托管.md)的模型：

```text
root 持有不可变 basedir
mysql 用户持有 datadir/log/tmp
显式 defaults-file
安全 initialize
systemd 单一托管
交互或 Secret 系统轮换初始密码
监控、备份和恢复验收
```

使用独立端口、socket、配置和数据目录进行源码实验，绝不能覆盖现有生产安装：

```ini
[mysqld]
basedir = /opt/mysql/mysql-8.4.x-custom1
datadir = /srv/mysql-custom/data
port = 13306
socket = /run/mysql-custom/mysqld.sock
```

初始化：

```bash
/opt/mysql/mysql-8.4.x-custom1/bin/mysqld \
  --defaults-file=/etc/mysql-custom/my.cnf \
  --initialize --user=mysql
```

只有空的专用目录才能执行初始化。

## 9. 怎样证明自编译没有退化

同一硬件、同一数据、同一配置、同一负载分别运行官方制品和自编译制品：

| 维度 | 指标 |
| --- | --- |
| 正确性 | 测试通过率、查询结果、恢复后校验 |
| 性能 | 吞吐、P50/P95/P99、CPU/事务、I/O/事务 |
| 稳定性 | 崩溃、错误日志、内存增长、长稳测试 |
| 兼容性 | 驱动、Shell、Router、备份与监控工具 |
| 可运维性 | core、符号化栈、升级和回滚耗时 |
| 安全 | TLS、认证插件、漏洞扫描、补丁时效 |

性能提高但恢复失败，或者吞吐略高但 CPU/事务翻倍，都不能叫更好的制品。

## 10. 补丁生命周期

内部补丁应维护为可重放、可审查的小补丁队列：

```text
上游 8.4.x tag
  + patch-001（问题链接、测试和回滚）
  + patch-002
  → custom build N
```

每次上游安全/稳定补丁发布时，需要重新应用补丁、解决冲突并运行全套测试。长期停在自定义旧版本的风险，通常远大于补丁本身带来的收益。

## 11. 升级与回滚

新构建放入新的版本目录，永远不原地覆盖旧程序。先用生产备份在隔离环境完成数据升级和业务验证。若生产升级后需要回退，旧二进制不一定能打开新数据目录；可靠回滚仍是恢复升级前备份/快照到旧版本兼容环境并切换流量。

源码补丁还应有功能开关或明确撤销提交，但数据库文件格式和元数据变化不能只靠代码回退解决。

## 12. 常见故障

| 现象 | 原因方向 | 处理思路 |
| --- | --- | --- |
| CMake 找不到库 | dev 包、路径或版本不满足 | 查看 CMake 日志，不用未知库硬凑 |
| 编译器内部错误/进程被杀 | 内存不足或并行度过高 | 系统日志、降低 jobs、增加构建资源 |
| 构建成功但目标机启动失败 | 运行库/RPATH/CPU 基线不一致 | 在干净目标镜像做 `ldd` 和启动测试 |
| 插件加载失败 | 构建选项或 ABI/路径不匹配 | manifest、`plugin_dir`、错误日志 |
| 性能异常 | 构建类型、断言、Sanitizer 或编译选项 | 核对 manifest，与官方制品对照 |
| 无法快速修复 CVE | 自维护发行流程不完整 | 建立上游跟踪、重构建和紧急发布 SLA |

## 13. 官方资料

- [MySQL 8.4：Installing from Source](https://dev.mysql.com/doc/refman/8.4/en/source-installation.html)
- [MySQL 8.4：Source Installation Prerequisites](https://dev.mysql.com/doc/refman/8.4/en/source-installation-prerequisites.html)
- [MySQL 8.4：Source Configuration Options](https://dev.mysql.com/doc/refman/8.4/en/source-configuration-options.html)

完成单实例交付方式后，下一篇进入拓扑部署：[主从与半同步复制生产部署](./07-主从半同步复制生产部署.md)。
