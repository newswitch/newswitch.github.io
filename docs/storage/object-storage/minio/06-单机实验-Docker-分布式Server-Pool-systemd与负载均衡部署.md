---
title: "单机实验、Docker、分布式 Server Pool、systemd 与负载均衡部署"
sidebar_label: "06. 多种部署方式与 Server Pool"
sidebar_position: 6
description: "从单机学习环境到多节点多盘 Server Pool，讲清节点身份、Drive、DNS、TLS 和负载均衡。"
tags: [MinIO, Docker, systemd, Server Pool, Load Balancer]
---

# 单机实验、Docker、分布式 Server Pool、systemd 与负载均衡部署

单机单盘适合学习 S3 API，不具备生产冗余。生产分布式部署要求稳定的节点 Endpoint、独占 Drive、低延迟网络、时间同步和一致配置。

本章以社区源码 `RELEASE.2025-10-15T17-29-55Z` 讲解隔离实验。社区仓库已归档，不能把旧 tag 当作当前安全维护版本；新生产系统应另外确认发行来源、漏洞修复和支持。AIStor 的发行、许可和安装方法不直接适用于该社区源码，见[社区状态](https://github.com/minio/minio)。

## 1. 形态边界

| 形态 | 用途 | 不能证明 |
| --- | --- | --- |
| 单机二进制 | API/权限实验 | Drive/Node 容错 |
| 单容器 | 客户端集成 | 持久化和调度可靠性 |
| Compose 多节点 | 本地拓扑实验 | 真实故障域和磁盘性能 |
| systemd 多节点多盘 | 固定生产环境 | 仍需 LB、监控、灾备 |

### 1.1 从源码准备可追踪的实验制品

在专用 Linux 构建机操作，Go 工具链应满足该 tag 的 `go.mod`，并采用经过审核的补丁版本。记录源提交、工具链及二进制摘要，而不是下载一个没有版本约束的 `latest` 镜像。

```bash
SOURCE_DIR="$(mktemp -d)"
git clone --depth 1 --branch RELEASE.2025-10-15T17-29-55Z \
  https://github.com/minio/minio.git "$SOURCE_DIR/source"
cd "$SOURCE_DIR/source"
git rev-parse HEAD
go version
MINIO_LAB_LDFLAGS="$(MINIO_RELEASE=RELEASE go run buildscripts/gen-ldflags.go 2025-10-15T17:29:55Z)"
CGO_ENABLED=0 go build -trimpath -ldflags "$MINIO_LAB_LDFLAGS" -o "$SOURCE_DIR/minio" .
sha256sum "$SOURCE_DIR/minio"
"$SOURCE_DIR/minio" --version
```

上述生成器注入固定源码日期、ReleaseTag和Git提交，避免普通go build缺少版本元数据。版本字符串是构建参数，不是官方签名或分发证明；交付仍需注明自建来源、工具链和摘要。构建成功也不表示漏洞审核完成。见[构建标识生成器](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/buildscripts/gen-ldflags.go)与[go.mod](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/go.mod)。

### 1.2 单机先建立一次对象读写

为新实验目录准备受限权限；通过受控环境设置非默认的 `MINIO_ROOT_USER` 和 `MINIO_ROOT_PASSWORD`，不把真实值写入参数。根身份仅用于本次隔离环境初始化，业务身份在[安全篇](./08-Access-Key-Policy-STS-OIDC-TLS-KMS-SSE与审计.md)单独建立。

```bash
LAB_DATA="$(mktemp -d)"
"$SOURCE_DIR/minio" server "$LAB_DATA" \
  --address 127.0.0.1:19000 --console-address 127.0.0.1:19001
```

进程前台运行是正常的。第二个终端通过受保护配置准备 AWS CLI Profile `minio-lab` 后，创建自己拥有的全新测试桶：

先在第二个终端创建独立客户端配置目录，再交互输入本次实验身份；不把真实值放在参数里：

```bash
umask 077
CLIENT_DIR="$(mktemp -d)"
export AWS_SHARED_CREDENTIALS_FILE="$CLIENT_DIR/credentials"
export AWS_CONFIG_FILE="$CLIENT_DIR/config"
aws configure --profile minio-lab
aws configure set s3.addressing_style path --profile minio-lab
```

交互时填写本次实验Access Key、Secret、us-east-1和json；不录屏或打印配置内容。临时身份还需对应Token，不能只输入前两项。这个目录与服务数据目录用途不同，重开终端要恢复正确配置路径，不能误用默认生产Profile。

```bash
export AWS_PROFILE=minio-lab
export AWS_REGION=us-east-1
export AWS_PAGER=''
S3_ENDPOINT=http://127.0.0.1:19000
BUCKET="object-lab-$(date -u +%Y%m%d%H%M%S)-$$"
LOCAL_DIR="$(mktemp -d)"
printf 'ready\n' > "$LOCAL_DIR/ready.txt"
aws --endpoint-url "$S3_ENDPOINT" s3api create-bucket --bucket "$BUCKET"
aws --endpoint-url "$S3_ENDPOINT" s3api put-object \
  --bucket "$BUCKET" --key health/ready.txt --body "$LOCAL_DIR/ready.txt"
aws --endpoint-url "$S3_ENDPOINT" s3api head-object \
  --bucket "$BUCKET" --key health/ready.txt --query ContentLength
aws --endpoint-url "$S3_ENDPOINT" s3api get-object \
  --bucket "$BUCKET" --key health/ready.txt "$LOCAL_DIR/download.txt"
cmp "$LOCAL_DIR/ready.txt" "$LOCAL_DIR/download.txt"
```

HEAD 应返回 `6`，`cmp` 相同则返回 0 且不打印差异。明文 HTTP 只限本机环回教学；跨主机访问必须配置可信 TLS。这里首次打通的是 API，不是磁盘容错。

### 1.3 四个容器观察分布式启动

配套文件在仓库 [minio-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/storage/minio-lab)。将二进制、Dockerfile、entrypoint.sh 放到新的独立构建目录，准备位于仓库之外的私有 Secret 目录，其中 `root-user`、`root-password` 分别只含一项凭证；限制目录与文件权限，不输出内容。

```bash
docker build -t object-minio-lab:source-20251015 /path/to/private/build-context
export MINIO_LAB_SECRET_DIR=/path/to/private/minio-secrets
docker compose -f examples/storage/minio-lab/compose.yaml config --quiet
docker compose -f examples/storage/minio-lab/compose.yaml up -d
docker compose -f examples/storage/minio-lab/compose.yaml ps
docker compose -f examples/storage/minio-lab/compose.yaml logs --tail=80 minio1
```

四个服务使用同一组完整 Endpoint：`http://minio{1...4}:9000/data{1...2}`。花括号交给 MinIO 解析，不能让某个容器只配置自己的两条路径。八个 named volume 可以同落一块宿主机盘，这个实验只能模拟进程拓扑，不能证明硬件容错或真实吞吐。

使用前一节的环回 Endpoint 完成相同读写；再执行 `compose stop` 保留数据。不要顺手加 `-v` 删除卷。二进制、容器、systemd、Operator 是不同实验形态，不可同时占用同一个端口和数据目录。

## 2. Server Pool

Server Pool 是一组协同提供容量和纠删码保护的 Server/Drive Endpoint。扩容通常添加新的 Pool，而不是随意给现有节点插入单盘并期待数据自动均衡。具体扩容规则以部署版本为准。

```text
Load Balancer
├─ minio1:9000 → drives 1..N
├─ minio2:9000 → drives 1..N
├─ minio3:9000 → drives 1..N
└─ minio4:9000 → drives 1..N
```

## 3. Drive 基线

- 每个 Endpoint 对应独立、稳定、专用文件系统；
- 使用 UUID/受控挂载，禁止设备名漂移；
- MinIO 启动前 Mount 已就绪，否则可能在根盘创建目录；
- 所有 Drive 容量和性能尽量一致；
- 不叠加未经验证的硬件 RAID/共享盘抽象；
- 监控 SMART、内核 I/O、文件系统和 inode。

## 4. systemd 与配置

环境文件保存 Server URL、Console 地址和根凭据引用，权限严格限制。Service 设置 Mount 依赖、文件描述符、重启策略和优雅终止。凭据不出现在进程参数和仓库。

### 4.1 四台主机使用相同拓扑

假设四台隔离实验机的名称为 `minio1.lab.internal` 至 `minio4.lab.internal`，每台有 `/srv/minio/disk1`、`disk2` 两个专用文件系统。所有主机必须解析到相同地址集合，使用相同二进制及环境文件。

配套 `minio.service` 中 `RequiresMountsFor` 等待挂载依赖，两个 `ExecStartPre=mountpoint -q` 进一步防止挂载失败时写入系统盘。环境文件 `/etc/minio/server.env` 由管理员受限保存，包含本实验的根身份环境变量；systemd 读取后传给进程，仍需防止高权限进程、诊断与备份泄露环境。

```bash
findmnt -T /srv/minio/disk1 -o TARGET,SOURCE,FSTYPE,OPTIONS
findmnt -T /srv/minio/disk2 -o TARGET,SOURCE,FSTYPE,OPTIONS
sudo systemd-analyze verify examples/storage/minio-lab/minio.service
sudo install -m 0644 examples/storage/minio-lab/minio.service /etc/systemd/system/minio.service
sudo systemctl daemon-reload
sudo systemctl enable --now minio.service
sudo journalctl -u minio.service --since '10 minutes ago'
```

安装之前，管理员须准备 `minio` 用户、专用挂载的所有权、二进制 `/opt/minio/bin/minio` 和配置文件。`mountpoint` 失败应先修挂载，不能删除检查来“恢复启动”。此模板的主机间 HTTP 只用于受限实验网；生产还要在各节点准备证书并统一修改为 HTTPS。

## 5. 负载均衡

LB 暴露统一 S3 Endpoint 和 TLS 证书，健康检查应确认节点可服务而非只开端口。支持大对象流式传输，关闭不必要缓存，设置足够连接/Idle Timeout，并保留客户端源和 Request ID 便于追踪。

Console 与 S3 API 可使用不同域名和访问策略。分布式节点间流量不应绕公网 LB。

### 5.1 API 反向代理配置

下面是 Nginx `http` 上下文中的结构示例，后端名称必须替换；证书文件与信任由独立流程准备。

```nginx
upstream object_api {
    least_conn;
    server minio1.lab.internal:9000;
    server minio2.lab.internal:9000;
    server minio3.lab.internal:9000;
    server minio4.lab.internal:9000;
}
server {
    listen 443 ssl;
    server_name s3.lab.example.com;
    ssl_certificate /etc/nginx/tls/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/private.key;
    client_max_body_size 0;
    location / {
        proxy_set_header Host $http_host;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_pass http://object_api;
    }
}
```

保留 Host 是为了不破坏签名输入，禁止在入口随意去掉 Key 路径前缀。关闭缓冲避免把整个大对象先写满代理临时盘，但仍需限制并发与总请求预算；300 秒是示意值，不是所有模型通用超时。`proxy_pass http` 表示回源明文，生产若要求端到端加密，应另外配置后端 HTTPS、SNI 和可信 CA，不能仅改一个 URL 就算完成。

## 6. 验收

上传大/小对象和 Multipart，记录基线；停止一个 Drive、一个节点和一个 LB 后端，验证客户端重试、Quorum、Healing 与 TLS；重启全部节点时确认 Drive 挂载顺序和数据一致。

## 7. 练习与答案

### 7.1 四个容器是否等于四个硬件故障域

答案：不是。它们可能共享宿主机、电源、网卡和磁盘。实验可观察成员退出，不能用来认证坏主机或坏机架的可用性。

### 7.2 systemd active而API失败应如何分层

答案：先看启动日志和实际挂载，再检查成员 DNS/端口、集群 Quorum、TLS/LB，最后用已知对象验证身份与数据。active 只表示跟踪的进程仍在。

### 7.3 为什么用八个数据目录却仍可能没有八块盘

答案：目录和 named volume 是逻辑路径。必须用 findmnt、设备标识及宿主机拓扑确认底层介质，不能由路径数量推断故障隔离。

### 7.4 HTTP实验配置能否直接上线

答案：不能。它仅用于环回或受限实验网，还缺生产 TLS、受限业务身份、维护支持、物理故障域、备份恢复和完整负载验收。

参考：[固定社区源码](https://github.com/minio/minio/tree/RELEASE.2025-10-15T17-29-55Z)、[Nginx代理模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)。
