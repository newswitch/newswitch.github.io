---
title: "nvidia-ctk 命令详解：容器运行时与 CDI 配置"
sidebar_label: "06. nvidia-ctk 命令详解：容器运行时与 CDI 配置"
sidebar_position: 6
description: "使用 nvidia-ctk 配置 Docker、containerd、CRI-O 与 CDI，理解配置写入、验证、回滚和 Kubernetes 边界。"
tags: [GPU, NVIDIA Container Toolkit, nvidia-ctk, CDI, containerd]
---

# nvidia-ctk 命令详解：容器运行时与 CDI 配置

`nvidia-ctk` 是 NVIDIA Container Toolkit 的配置与诊断 CLI。它负责生成/修改运行时配置、生成 CDI 设备规范和查看组件信息；真正创建容器的仍是 Docker、containerd、CRI-O、Podman 等运行时。

## 1. 版本与前置条件

```bash
nvidia-ctk --version
nvidia-ctk --help
nvidia-ctk runtime --help
nvidia-ctk cdi --help
nvidia-smi
```

先保证宿主机驱动工作。Toolkit 1.19 的 CDI 使用还受运行时版本约束；在升级文档中核对 Docker/containerd/Podman/CRI-O 的最低版本，不要仅凭 `nvidia-ctk` 成功就认定运行时支持 CDI。

## 2. 子命令模型

| 子命令 | 作用 | 风险 |
|---|---|---|
| `runtime configure` | 为指定容器运行时写入 NVIDIA 配置 | `[W]` |
| `runtime configure --dry-run` | 预览配置结果 | `[R]` |
| `cdi generate` | 生成 CDI YAML 设备规范 | `[W]` |
| `cdi list` | 列出可用 CDI 设备 | `[R]` |
| `cdi transform` | 转换或合并 CDI 规范 | `[W]` |
| `info` / `system` 等 | 查看系统与组件信息，依版本而异 | `[R]` |

## 3. 配置 Docker

```bash
sudo nvidia-ctk runtime configure --runtime=docker --dry-run
sudo cp -a /etc/docker/daemon.json /etc/docker/daemon.json.before-nvidia
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

docker run --rm --gpus all nvidia/cuda:<匹配的镜像标签> nvidia-smi
```

`restart docker` 可能影响容器，需维护窗口。不要在脚本里虚构镜像标签；选择组织已验证、驱动兼容且可追溯的 digest。

## 4. 配置 containerd

```bash
sudo nvidia-ctk runtime configure --runtime=containerd --dry-run
sudo cp -a /etc/containerd/config.toml /etc/containerd/config.toml.before-nvidia
sudo nvidia-ctk runtime configure --runtime=containerd
sudo containerd config dump
sudo systemctl restart containerd
```

Kubernetes 节点还要核对 CRI 使用的配置文件、runtime handler 名称、kubelet RuntimeClass 和 Device Plugin。配置写进了“另一个 containerd 配置文件”是常见故障。

## 5. CDI 工作流

```bash
sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
nvidia-ctk cdi list
grep -E 'name:|containerEdits:' /etc/cdi/nvidia.yaml
```

CDI 将 GPU、MIG 设备及其容器编辑描述为标准 YAML。GPU/MIG 配置变化后需要重新生成，或启用 Toolkit 提供的刷新机制。不要手工长期维护自动生成文件。

## 6. 配置变更的正确步骤

1. 记录 `nvidia-ctk`、运行时、驱动和内核版本；
2. 用 `--dry-run` 查看差异；
3. 备份确切配置文件并确认路径；
4. 执行配置，做语法检查；
5. 在维护窗口 reload/restart；
6. 用最小 CUDA 容器验证；
7. 再验证 Kubernetes/调度层；
8. 失败时恢复备份并重启验证。

## 7. 常见问题

| 现象 | 排查方向 |
|---|---|
| 宿主机可见、容器不可见 | runtime 是否使用正确配置，OCI hook/CDI 是否生效，设备请求是否正确 |
| `unknown runtime` | `--runtime` 值和 Toolkit 版本，运行时是否已安装 |
| CDI 列表为空 | 驱动发现、生成路径、YAML 权限和解析错误 |
| Docker 成功、K8s 失败 | CRI 不是 Docker；查 containerd/CRI-O、RuntimeClass、Device Plugin |
| MIG 资源过期 | MIG 重配后重新生成 CDI 并刷新 Device Plugin |
| 修改后运行时起不来 | 对比备份、运行时语法检查、journal 日志，及时回滚 |

## 8. 掌握标准

能在执行前展示配置差异；能说明 Docker 与 Kubernetes/CRI 配置不是一回事；能生成并审阅 CDI spec；能将“容器看不到 GPU”定位到宿主机驱动、设备规范、运行时或编排层。

## 9. 官方参考 {/* #官方参考 */}

- [NVIDIA Container Toolkit: Container Runtime Configuration](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html#configuring-containerd-for-kubernetes)
- [NVIDIA Container Toolkit: CDI Support](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/cdi-support.html)
- [NVIDIA Container Toolkit Release Notes](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/release-notes.html)
