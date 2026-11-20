# MinIO 固定源码实验配置

阅读 `docs/storage/object-storage/minio/06-单机实验-Docker-分布式Server-Pool-systemd与负载均衡部署.md` 与第 07 篇后使用。源码基线为 `RELEASE.2025-10-15T17-29-55Z`；Operator CR 结构基线为 v7.1.1。二者是教学阅读基线，不是当前安全维护或生产兼容认证。

目录不包含二进制、镜像、密钥或已初始化数据。把编译出的、匹配 Linux 节点 CPU 架构的 `minio` 复制进独立构建目录，再复制 Dockerfile 与 entrypoint.sh 进行构建。Ubuntu 基础镜像和软件包还需按正式交付要求锁定摘要与来源。

Compose 仅在宿主机环回地址暴露明文 API/Console，内部使用容器实验网络；禁止把它当作生产 TLS 配置。八个 named volume 不代表八块物理盘。入口先以受限 root 能力读取 Secret 文件，再切换到 UID/GID 10001 执行服务；凭证仍在进程环境中，不是零暴露方案。秘密目录必须在仓库外，用受控工具准备。

systemd 模板要求四台独立实验机、相同服务账户、专用文件系统和稳定 DNS；单机本地目录不能直接套用其 mountpoint 检查。Tenant 模板要求已安装 v7.1.1 Operator、已批准的命名空间、四台带标签的节点和支持拓扑的 StorageClass。镜像地址需先替换；模板关闭自动 TLS，仅用于受限网络实验，生产应另行验证完整证书配置。

Operator 镜像使用单独的 `Dockerfile.operator`：构建目录须含二进制、同一固定源码的 `dockerscripts/docker-entrypoint.sh`（复制为 docker-entrypoint.sh）、LICENSE、CREDITS。它保留官方入口路径与文件凭证环境约定，不读取Compose的 `/run/secrets/root_user`。不能直接把Compose镜像填入Tenant。两种镜像都只是本地构建配方，不能视为已完成Operator/Server目标组合集成验收。

文档检查只解析语法与引用，不执行构建、挂载、Compose、kubectl、故障注入或真实 S3 请求。停止实验不等于删除数据；不要使用 `docker compose down -v` 或递归删除数据目录作为默认收尾。
