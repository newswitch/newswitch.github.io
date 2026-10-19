---
title: "NGC 镜像身份权限与制品生命周期"
sidebar_label: "02. NGC 镜像身份权限与制品生命周期"
sidebar_position: 2
description: "区分 NGC Catalog、私有仓库、用户和服务身份，理解镜像引用、平台选择、授权与凭据轮换。"
tags: [NGC, 容器, 镜像, 身份, 权限]
---

# NGC 镜像身份权限与制品生命周期

NGC 不只是一个 `nvcr.io` 地址，还包括软件目录、组织与团队权限、私有制品和相关服务。看到公开页面、成功登录 Registry 和有权读取某个镜像，是不同条件。

## 1. 身份与授权分开

用户身份说明是谁，组织和服务授权决定可访问什么，API Key 是客户端使用的凭据。Personal、Service 和旧式 Key 的生命周期与权限模型不同，应按当前服务支持选择；不要把个人管理员 Key 复制到所有计算节点。

拉取自动化只授予所需仓库和读取权限。镜像拉取凭据与模型下载、对象存储访问、业务 API 密钥也应分别管理，一个凭据成功不证明其他服务已授权。

### 1.1 账户成员 组织角色与服务资格

[NGC 用户指南](https://docs.nvidia.com/ngc/latest/ngc-user-guide.html)区分 NVIDIA Cloud Account 的成员记录与 NGC 的角色、服务访问：加入前者不自动授予后者。NGC Org UI 管理 NGC 用户与角色；从 NGC 组织移除用户会撤销该组织的 NGC 角色及服务访问，即使账户成员记录仍在。

团队可划分私有仓库命名空间，但仓库隔离不等于每个云服务都支持相同的团队粒度。应按“服务、动作、目标范围”检查授权，不能从 CLI 出现 `--team` 就推导该服务具有逐站点权限。Fleet Command 的会话与站点边界见[边缘身份与安全](../../serverless-edge/edge/07-Fleet-Command对象注册身份与安全边界.md)。

教学反例：用户能登录账户、拉取团队 A 的镜像，却不能操作边缘站点。可能缺的是目标组织中的服务资格或操作角色；反复更换 Registry 密码不会补出这些授权。反过来，拥有边缘发布权也不证明站点拉取者能访问私有制品。

## 2. 镜像名称的层次

一个镜像引用包含 Registry、路径和 Tag 或 Digest。Tag 是可读标记，Digest 固定内容；多架构索引与具体平台镜像又可以具有不同 Digest。应记录实际节点选择的平台与内容，而不是只保存一个字符串 Tag。

下载成功不证明驱动兼容、应用依赖完整或具备正确 GPU。先验证平台架构，再核对运行时、CUDA 与宿主驱动，最后执行最小计算和目标应用。

## 3. 凭据如何到达拉取者

Docker 命令由本地客户端和 Daemon 使用配置，Kubernetes 通常由节点侧运行时发起镜像拉取。交互用户登录成功，并不自动让每个节点或 ServiceAccount 获得相同凭据。

`imagePullSecrets` 等配置应位于正确 Namespace，并被目标 Pod 或 ServiceAccount 引用。认证材料不应出现在公开 YAML、构建日志或命令行 `-p` 参数中；使用受控凭据存储及客户端支持的安全输入方式。

## 4. 轮换的重叠窗口

只有目标服务和 Key 类型允许新旧凭据并存时，才可采用“创建并验证新凭据、更新消费者、验证新拉取、撤销旧凭据”的重叠轮换。不能假定 Legacy、Personal、Service Key 都有相同的并存与撤销规则；不支持重叠时，需要预先盘点全部消费者并安排受控切换窗口。

已运行容器不会持续通过 Registry 验证身份，节点缓存也可能让错误凭据暂时不暴露。还要区分撤销人的访问、撤销某把 Key 和终止已建立的会话；一个管理动作不能无条件替代另外两个。

教学反例：撤销旧 Key 后现有服务正常，不代表轮换成功。下一次节点重建或扩容需要重新下载镜像时，才可能暴露未更新的 Secret。验证应包含获授权测试环境中的新拉取，不应删除生产缓存强迫验证。

## 5. 掌握检查

能把“未授权”“制品不存在”“平台不匹配”“镜像已拉取但应用失败”分开；能解释哪个身份在何处发起请求；能在不打印密钥的情况下验证轮换后的消费者。

继续阅读[拉取和离线分发](./03-NGC拉取故障离线分发与运行验证.md)。

镜像内容身份继续进入 [OCI 索引、Digest 与离线信任链](./04-OCI索引Digest与离线镜像信任链.md)，区分顶层索引、平台清单、内容完整性和签名者授权；不要把正确 Digest 当成来源可信的充分条件。

## 6. 参考资料

- [NGC 用户与 API Key](https://docs.nvidia.com/ngc/latest/ngc-user-guide.html)
- [NGC Private Registry](https://docs.nvidia.com/ngc/latest/ngc-private-registry-user-guide.html)
- [Kubernetes 私有镜像拉取](https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/)
