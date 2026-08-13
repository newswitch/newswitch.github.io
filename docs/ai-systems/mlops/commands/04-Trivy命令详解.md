---
title: "Trivy 命令详解"
sidebar_position: 4
description: "使用Trivy扫描AI镜像、文件系统、代码仓库、Kubernetes配置、漏洞、错误配置、许可证和Secret。"
tags: [Trivy, 安全扫描, 容器镜像, SBOM, Secret, AI供应链]
---

# Trivy 命令详解

AI镜像通常包含CUDA、Python、编译器、模型服务和大量依赖，体积大且漏洞来源多。Trivy可扫描镜像、文件系统、仓库、配置与Kubernetes对象；扫描结果是风险输入，不是“存在CVE就能直接升级”的自动修复指令。

## 1. 版本与数据库 `[R/A]`

```bash
trivy --version
trivy --help
trivy image --help
trivy clean --help
```

扫描前记录Trivy版本、漏洞数据库更新时间和Java DB等附加数据库。离线环境应通过受控制品分发数据库并验证摘要；更新数据库会访问网络和写缓存。

## 2. 镜像扫描 `[R/A]`

```bash
trivy image \
  --scanners vuln,misconfig,secret,license \
  --severity HIGH,CRITICAL \
  --ignore-unfixed \
  --format json \
  --output trivy-image.json \
  registry.example/ai/vllm@sha256:<digest>
```

使用digest而非tag。核心参数：

| 参数 | 含义 |
|---|---|
| `--scanners` | 选择漏洞、misconfig、secret、license等扫描器 |
| `--severity` | 结果严重度过滤，不等于实际业务风险 |
| `--ignore-unfixed` | 隐藏暂无修复项，报告中要说明策略 |
| `--exit-code` | 命中策略时返回指定码，用于CI门禁 |
| `--format` | table、json、sarif、template、cyclonedx、spdx等 |
| `--output` | 报告文件，可能含敏感路径/Secret片段 |
| `--ignorefile` | 带原因、owner和到期时间的例外清单 |
| `--timeout` | 大型CUDA镜像需要合理超时 |
| `--cache-dir` | DB和制品缓存，CI并发需隔离/协调 |
| `--offline-scan`、`--skip-db-update` | 离线模式，确保数据库不是陈旧未知状态 |

## 3. 文件系统与仓库

```bash
trivy fs --scanners vuln,misconfig,secret --format json -o fs.json .
trivy repo --scanners vuln,misconfig,secret <repo-url>
trivy config --format sarif -o config.sarif ./deploy
```

模型权重通常不是包漏洞扫描对象，但目录中可能有自定义Python代码、pickle、Token和配置Secret。扫描不可信仓库时不要执行其构建脚本。

## 4. Kubernetes扫描

```bash
trivy k8s --report summary cluster
trivy k8s --namespace ai --report all cluster
```

需要集群读取权限且可能列举大量资源。生产使用只读ServiceAccount、限定namespace/资源并控制查询并发；报告中Secret字段必须保护。

## 5. SBOM与门禁

```bash
trivy image --format cyclonedx --output sbom.cdx.json IMAGE@DIGEST
trivy image --exit-code 1 --severity CRITICAL IMAGE@DIGEST
```

SBOM应绑定镜像digest并作为OCI artifact/attestation发布。门禁策略要区分：是否可利用、是否存在修复、组件是否运行时可达、基础镜像支持周期和临时豁免。不能长期使用无到期ignore。

## 6. Secret扫描响应

一旦报告发现真实令牌：立即撤销/轮换，而不是只删除Git当前文件；检查历史、镜像层、构建缓存、日志和Registry；重建镜像并验证旧digest不再部署。报告本身包含匹配片段，也按Secret处理。

## 7. 常见故障

| 现象 | 首要检查 |
|---|---|
| 同一镜像结果变化 | DB版本、扫描器、vendor severity与Trivy版本 |
| 拉取镜像失败 | Registry身份、代理、证书、平台架构和镜像来源 |
| CUDA镜像扫描很慢 | 镜像层大小、Java/Python数据库、缓存和timeout |
| CVE修复后仍报告 | 实际digest、残留旧包、OS EOL和DB刷新 |
| 大量误报 | 逐项验证依赖是否存在/可达，带证据建立限时例外 |
| CI泄露Secret | 报告权限、日志输出、上传Artifact和脱敏策略 |

## 掌握标准

能对digest扫描并记录DB身份；能生成SBOM；能设计有解释的门禁与例外；能处理Secret发现；能把扫描结果与运行时和修复可行性结合。

## 官方资料

- [Trivy CLI reference](https://trivy.dev/latest/docs/references/configuration/cli/trivy/)
- [Trivy documentation](https://trivy.dev/latest/docs/)
