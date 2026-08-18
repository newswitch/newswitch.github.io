---
title: "Higress Wasm Plugin：SDK、生命周期、发布与安全"
sidebar_label: "09. Higress Wasm Plugin：SDK、生命周期、发布与安全"
sidebar_position: 9
description: "理解 Higress Wasm 插件怎样进入 Envoy Filter Chain，并掌握开发、配置、发布、灰度、性能和故障边界。"
tags: [Higress, Wasm, Proxy-Wasm, Plugin, Go]
---

# Higress Wasm Plugin：SDK、生命周期、发布与安全

Wasm 插件适合在网关请求路径中实现认证、转换、审计和 AI 治理。它比修改 Envoy/Higress 源码更易发布，但仍运行在数据面的关键路径，任何阻塞、内存膨胀和错误都可能影响全部请求。

## 1. 插件怎样工作

```text
WasmPlugin CR / Console
→ Controller 翻译并通过 xDS/ECDS 下发
→ Gateway 拉取固定版本 OCI 中的 wasm
→ Wasm VM / root context 初始化
→ stream context 处理 request headers/body
→ optional async call + pause/resume
→ response headers/body
→ log / metrics / cleanup
```

`defaultConfig` 可作为全局配置，`matchRules` 可按域名或路由覆盖。匹配范围、插件执行阶段和优先级共同决定 Filter Chain 中的实际顺序；“配置已保存”不代表插件已成功拉取、实例化并作用于目标路由。

## 2. 开发边界

Go、Rust 等 SDK 最终遵守 Proxy-Wasm ABI；具体支持语言和构建链应以当前 Higress 版本文档为准并固定版本。处理函数只做有界计算：

- Header 阶段适合身份、路由元数据和快速拒绝；
- Body 可能分块到达，完整缓冲会放大内存；
- 外部调用必须有超时、并发上限、失败策略和异步恢复；
- 不在请求回调中做阻塞 DNS、磁盘或无超时网络调用；
- 为配置解析做 Schema 校验，错误配置应拒绝或保留上一版本。

插件需要产生低基数指标和带采样的日志，禁止记录密钥、完整 Prompt、Authorization 和敏感响应。

## 3. 最小开发过程

1. 定义输入、输出、失败策略和延迟预算；
2. 在 Header/Body/Response 中选择最早且信息足够的回调；
3. 用单元测试覆盖空值、超大值、分块、取消和外部超时；
4. 构建 wasm，生成 SBOM/哈希并推送到受信 OCI 仓库；
5. 使用不可变 tag 或 digest，先匹配测试域名，再按 Route 灰度；
6. 观察 VM 创建失败、插件异常、P99、内存和外部依赖错误；
7. 保留上一个 digest 和一键禁用路径。

## 4. 配置示意

```yaml
apiVersion: extensions.higress.io/v1alpha1
kind: WasmPlugin
metadata:
  name: tenant-guard
  namespace: higress-system
spec:
  url: oci://registry.example.com/gateway/tenant-guard@sha256:REPLACE_ME
  defaultConfig:
    failOpen: false
  matchRules:
    - domain: ["canary.example.com"]
      config:
        allowedTenants: ["lab"]
```

示例只表达对象关系。上线前必须核对目标版本 CRD、镜像拉取凭据、阶段、优先级和字段定义。

## 5. 性能和安全

对比“无插件、只解析 Header、读取 Body、带外部调用”四组基准。记录 CPU/请求、内存/并发、P50/P99、失败率和暂停中的请求数。插件不得无限增长 Map、用请求值创建高基数指标或把大 Body 长期保存在 VM 内存。

供应链要固定来源、digest、签名与漏洞扫描；限制插件可访问的 Host Function/外部服务。多插件组合时验证顺序，例如认证必须早于按 Consumer 限流，脱敏必须早于日志输出。

## 6. 常见故障

| 现象 | 定位 |
| --- | --- |
| 配置存在但插件未生效 | matchRules、阶段、xDS、OCI 拉取和 Gateway 日志 |
| 所有请求突然变慢 | 阻塞外调、Body 缓冲、锁竞争或日志过量 |
| 新版本部分 Pod 生效 | 镜像 tag 漂移、拉取失败、滚动状态或配置版本 |
| SSE 中途断流 | Response Body 回调、缓冲、超时和异常处理 |
| 插件禁用后仍异常 | 配置尚未 ACK、旧连接/旧实例或根因在上游 |

## 7. 掌握标准

你应能把一个插件放到准确的请求阶段，说明暂停/恢复和配置生命周期，完成 digest 灰度、性能预算、失败注入与回滚，而不是只写出能编译的 wasm。

## 8. 参考资料 {/* #参考资料 */}

- [Higress Plugin Usage Guide](https://higress.cn/en/docs/latest/plugins/intro/)
- [Higress Go Wasm Plugin](https://higress.cn/en/docs/latest/user/wasm-go/)
