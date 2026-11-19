---
title: "s3fs-fuse 安装挂载与配置"
sidebar_label: "02. s3fs-fuse 安装挂载与配置"
sidebar_position: 2
description: "以 v1.97 和 FUSE 3 为基线，解释源码安装、只读挂载、凭证权限、Endpoint、缓存目录、跨用户访问、systemd 与安全卸载。"
tags: [S3FS, s3fs-fuse, FUSE3, systemd, 对象存储]
---

# s3fs-fuse 安装挂载与配置

首次接入应先证明三个条件成立：同一身份可以通过 API 读取对象，Linux 能建立 FUSE 挂载，应用所需文件能经挂载路径正确读取。最后再考虑启动托管、缓存和写入需求。

本章使用 Linux Bash、s3fs-fuse v1.97 与 FUSE 3，源码安装示例采用 Ubuntu 24.04。所有桶名、域名和凭证路径都需要替换为自己的测试资源。默认演示只读挂载，不改写已有对象。

## 1. 安装前确认环境

```bash
uname -m
cat /etc/os-release
ls -l /dev/fuse
command -v fusermount3
```

需要区分几个检查结果：

- `uname -m` 决定二进制和容器镜像的目标架构；GPU 或 NPU 类型不改变这个要求。
- `/dev/fuse` 是设备入口，缺失时应由管理员检查内核模块和设备管理，不要创建一个同名普通文件替代。
- `fusermount3` 是 FUSE 3 的挂载辅助程序；旧教程中的 `fusermount` 可能属于另一套构建。
- 容器里看到设备节点，不等于具备设备访问与挂载权限。

发行版包可先用 `apt-cache policy s3fs` 查询版本，再按批准的软件源安装。包版本与本文不同，不能直接假定所有参数相同。v1.97 的 Linux 构建依赖 FUSE 3，见 [configure.ac](https://github.com/s3fs-fuse/s3fs-fuse/blob/v1.97/configure.ac)。

## 2. 固定版本源码安装

以下步骤会安装编译依赖，并把程序安装到专用版本目录，不覆盖发行版的 `/usr/bin/s3fs`：

已有 FUSE 2 工作负载时，应先检查软件包变更计划和依赖，不在生产节点直接替换正在使用的辅助工具。也可以在隔离构建环境中生成并审核制品。

```bash
sudo apt-get update
sudo apt-get install -y build-essential automake autoconf libtool pkg-config \
  git ca-certificates libfuse3-dev fuse3 libcurl4-openssl-dev \
  libxml2-dev libssl-dev media-types

SRC_DIR="$(mktemp -d -t s3fs-src.XXXXXXXX)"
git clone --depth 1 --branch v1.97 \
  https://github.com/s3fs-fuse/s3fs-fuse.git "$SRC_DIR/source"
cd "$SRC_DIR/source"
git rev-parse HEAD
./autogen.sh
./configure --prefix=/opt/s3fs/1.97 --with-openssl
make -j2
sudo make install
/opt/s3fs/1.97/bin/s3fs --version
```

`git rev-parse HEAD` 记录实际源码提交，`make -j2` 限制编译并发。正式交付还应记录依赖软件包与制品摘要；固定 Git tag 不等于编译环境完全可复现。

版本输出应包含 v1.97 对应版本信息，具体编译标记和库版本以本机为准。随后查看：

```bash
/opt/s3fs/1.97/bin/s3fs --help
fusermount3 --version
```

## 3. 准备身份与本地目录

### 3.1 先用API验证

准备一个专用测试桶及 `health/ready.txt`，用同一访问身份验证限定前缀列举和已知对象读取。使用 AWS CLI 时可参考[寻址签名与授权](../fundamentals/03-S3访问寻址签名与授权.md)。

列举与读取通常需要不同权限。能够列举桶，不保证能读取对象；反过来也一样。若挂载额外发出探测请求，应根据真实操作补充最小权限，不直接授予所有管理权限。

### 3.2 凭证文件不是命令行参数

简单测试可以使用受限 Access Key 对应的 passwd 文件，其内容格式为：

```text
<access-key-id>:<secret-access-key>
```

通过受控编辑器或 Secret 系统准备该文件，例如保存在 `/run/s3fs-lab.passwd`，只允许挂载身份读取。不要把真实值放进终端示例、进程参数或 Git。

```bash
stat -c '%a %U %G' /run/s3fs-lab.passwd
chmod 600 /run/s3fs-lab.passwd
```

这里假定当前用户有权管理自己的文件。s3fs 会检查文件权限，过宽时可拒绝启动。`600` 是八进制的所有者读写权限，不是访问 S3 的授权策略。具体检查见 [v1.97 凭证实现](https://github.com/s3fs-fuse/s3fs-fuse/blob/v1.97/src/s3fs_cred.cpp)。

使用临时凭证时还需要 Session Token 及续期。不要把第三段 Token 随意追加到上述简单格式中。v1.97 支持相应环境变量及 AWS credentials 格式，但不能假定它与任意 SDK 的 SSO、外部进程或身份联合链完全相同；应核对实际凭证来源及刷新方式。

### 3.3 挂载目录与缓存目录分开

下面使用固定实验路径。请管理员先准备空的 `/mnt/s3-lab`，并让挂载用户能够管理它和对应缓存目录；没有管理员权限时，统一换成自己有权使用的路径。不要改变已有业务目录的所有权。

```bash
mkdir -p /mnt/s3-lab
mkdir -p /var/tmp/s3fs-lab/data /var/tmp/s3fs-lab/tmp
mountpoint /mnt/s3-lab
ls -A /mnt/s3-lab
df -h /var/tmp/s3fs-lab
```

非 root 用户应选择自己有权创建和管理的空目录，或由管理员预先创建 `/mnt/s3-lab` 并授权。`mountpoint` 在尚未挂载时返回非零，这是预期检查结果。已有其他挂载或业务文件时，应另选路径，不使用 `nonempty` 覆盖已有目录；v1.97 的 FUSE 3 构建也不应依赖该选项。

缓存目录不要被不可信用户共享。它可能保存从私有桶读取的正文，因此也需要本地权限和容量管理。

## 4. 前台只读挂载

把下面的桶名、Endpoint、Region 和凭证文件替换后，在第一个终端运行：

```bash
/opt/s3fs/1.97/bin/s3fs your-owned-test-bucket /mnt/s3-lab -f \
  -o ro -o passwd_file=/run/s3fs-lab.passwd \
  -o url=https://s3.lab.example.com -o endpoint=us-east-1 \
  -o use_path_request_style -o sigv4 \
  -o complement_stat -o default_permissions -o umask=027 \
  -o use_cache=/var/tmp/s3fs-lab/data -o tmpdir=/var/tmp/s3fs-lab/tmp \
  -o stat_cache_expire=30 -o disable_negative_cache \
  -o ensure_diskfree=1024 -o max_thread_count=4
```

这是支持 Path-style 的实验入口示例，不是所有后端通用的连接字符串。使用正式云服务时，应按其 Endpoint、Region 和寻址要求调整；内部 CA 应加入正确的系统信任链，不使用 `no_check_certificate` 或关闭主机名验证。

### 4.1 参数按职责理解

| 参数 | 在这个例子中的作用 | 边界 |
| --- | --- | --- |
| `-f` | 前台运行，便于观察和托管进程 | 不是日志详细级别开关 |
| `ro` | 建立只读文件系统视图 | 服务端也应使用只读身份 |
| `passwd_file` | 明确凭证文件位置 | 路径可见，真实密钥不能出现在参数里 |
| `url` 与 `endpoint` | 服务入口与签名地域 | 两者不是同一个设置 |
| `use_path_request_style` 与 `sigv4` | 使用本例需要的寻址与签名方式 | 仍需后端支持 |
| `complement_stat` | 补全普通对象可能缺少的文件属性信息 | 不会增加服务端权限 |
| `default_permissions` 与 `umask` | 进行本地权限检查并限制显示的访问权限 | 不替代对象策略 |
| `use_cache` 与 `tmpdir` | 指定数据缓存和临时文件位置 | 都需要本地可写空间 |
| `stat_cache_expire` 与 `disable_negative_cache` | 降低属性及不存在结果带来的观察延迟 | 不承诺所有缓存最多只旧 30 秒 |
| `ensure_diskfree` | 设置本地空间保护阈值 | 不是缓存容量硬配额 |
| `max_thread_count` | 限制相应并行请求数量 | 更大不一定更快 |

具体定义见 [v1.97 手册](https://github.com/s3fs-fuse/s3fs-fuse/blob/v1.97/doc/man/s3fs.1.in)。示例数值用于理解职责，不是模型服务的统一性能模板；缓存与并发取值在下一篇进一步分析。

### 4.2 在第二个终端验证

```bash
findmnt -T /mnt/s3-lab -o TARGET,FSTYPE,OPTIONS
cat /mnt/s3-lab/health/ready.txt
```

若测试对象正文是 `ready` 加换行，第二条命令应打印 `ready`。这只是预期示例，不是某个环境的实测输出。还应确认第一条结果确实为 FUSE 挂载，并通过独立 API 下载比较同一个测试文件。

`-f` 进程占据第一个终端是正常现象。不要把终端没有退出当作启动失败，也不要在验证过程中随意关闭它。

## 5. 跨用户访问需要两层权限

默认 FUSE 访问范围与挂载用户有关。业务用户不同于挂载用户时，可能在远端鉴权之前就遇到本地访问限制。

`allow_other` 放开其他本地用户参与访问的限制；非 root 挂载用户通常还需要管理员允许 `/etc/fuse.conf` 中的 `user_allow_other`。随后仍应通过 `default_permissions`、UID/GID 和文件权限控制实际访问。参见 [FUSE 访问限制](https://docs.kernel.org/filesystems/fuse/fuse.html)。

特别注意：远端看到的通常仍是这次挂载使用的对象身份，而不是每个本地用户自动映射成各自的 IAM 身份。一个高权限挂载加 `allow_other`，可能把同一组远端权限暴露给多个本地用户。

因此，单用户实验不默认开启 `allow_other`。是否跨用户共享，应按本地用户隔离、服务端权限和审计需求单独设计。

## 6. 使用systemd托管

配套文件位于仓库 [s3fs-readonly.service](https://github.com/newswitch/newswitch.github.io/blob/main/examples/storage/s3fs-lab/s3fs-readonly.service)。它使用前台模式及独立账户，主要设置如下：

```ini
[Service]
Type=simple
User=s3reader
Group=s3reader
ExecStop=/usr/bin/fusermount3 -u /srv/s3fs-models
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
```

完整文件中的 `ExecStart` 指向 `/opt/s3fs/1.97/bin/s3fs`，挂载 `/srv/s3fs-models`。部署前需要管理员准备：

1. 独立账户 `s3reader`，以及由它拥有的空挂载目录。
2. `/var/cache/s3fs-models/data` 与 `tmp` 两个受限本地目录。
3. 由该账户拥有、权限为 `0600` 的 `/etc/s3fs-models.passwd`。
4. 已替换的桶名、地址、地域，以及正确的 CA 信任。

确认没有其他进程占用同一挂载点，再安装并启动：

```bash
sudo install -m 0644 examples/storage/s3fs-lab/s3fs-readonly.service \
  /etc/systemd/system/s3fs-readonly.service
sudo systemctl daemon-reload
sudo systemctl enable --now s3fs-readonly.service
sudo systemctl status s3fs-readonly.service
sudo journalctl -u s3fs-readonly.service --since '10 minutes ago'
sudo -u s3reader cat /srv/s3fs-models/health/ready.txt
```

`Type=simple` 表示 systemd 跟踪前台主进程，不表示业务文件已经可读。`network-online.target` 也不是对象存储可达和凭证有效的证明；依赖挂载的应用还应有自己的就绪检查。具体语义见 [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)。

不要同时让 fstab、systemd 服务和手动命令管理同一个挂载点。也不要机械增加 `PrivateMounts` 或阻止挂载辅助程序提权的设置，再把隔离后的路径不可见误判为远端存储故障。

## 7. 卸载先处理使用者

手动实验应先停止读取该目录的进程，再执行正常卸载：

```bash
fusermount3 -u /mnt/s3-lab
findmnt -T /mnt/s3-lab
```

卸载后，目录本身仍存在，`findmnt -T` 可能显示承载它的父文件系统；应核对精确 TARGET 和类型，不把“仍有一行输出”当成卸载失败。

若提示 busy，先检查进程工作目录、打开文件及其他挂载关系。由 systemd 管理的实例通过 `systemctl stop s3fs-readonly.service` 停止，不能一边自动重启、一边手工反复挂载。

延迟卸载不是数据已上传的证明。写入场景必须另行确认提交、处理错误和保留必要证据，不能把强杀进程或删除缓存当成常规修复。

## 8. 练习与答案

### 8.1 为什么包安装成功还要核对版本

答案：软件包可能是较旧版本，FUSE 主版本、参数名和默认缓存行为可能不同。应记录程序及库版本，并使用对应版本手册；安装成功只证明包管理过程完成。

### 8.2 ro是否可以代替只读对象身份

答案：不能。ro 限制这次文件系统访问，但凭证若仍有写权限，持有者可能通过其他客户端写入。服务端最小权限和本地只读视图应分别设置。

### 8.3 allow_other是否让每个人使用自己的S3身份

答案：不是。它处理本地 FUSE 访问限制，通常仍共享挂载时使用的远端身份。必须结合本地权限、远端权限和审计设计，不能当成多租户身份隔离功能。

### 8.4 systemd显示active是否代表模型已准备好

答案：不代表。Type=simple 主要反映主进程生命周期。应用还应验证挂载类型、目标文件及完整性，必要时确认固定 revision 的模型已经准备完成。

### 8.5 为什么卸载后findmnt仍可能有输出

答案：`findmnt -T` 可以返回承载当前路径的父文件系统。应比较 TARGET、FSTYPE 和精确挂载关系；同名目录存在也不意味着远端仍然挂载。

## 9. 参考资料

- [v1.97 发布说明](https://github.com/s3fs-fuse/s3fs-fuse/releases/tag/v1.97)
- [v1.97 构建依赖](https://github.com/s3fs-fuse/s3fs-fuse/blob/v1.97/configure.ac)
- [v1.97 手册](https://github.com/s3fs-fuse/s3fs-fuse/blob/v1.97/doc/man/s3fs.1.in)
- [v1.97 凭证处理](https://github.com/s3fs-fuse/s3fs-fuse/blob/v1.97/src/s3fs_cred.cpp)
- [FUSE 内核文档](https://docs.kernel.org/filesystems/fuse/fuse.html)
- [systemd 服务](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)
