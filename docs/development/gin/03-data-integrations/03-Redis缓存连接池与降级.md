---
title: "Gin 与 Redis：Cache-Aside、连接池、租户键与降级保护"
sidebar_label: "03. Gin 与 Redis：Cache-Aside、连接池、租户键与降级保护"
sidebar_position: 3
description: "缓存降低读取成本，也引入过期、失效、热点和依赖故障。必须先确定缓存哪些数据以及允许多旧，而不是给每个查询加一层 Redis。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin 与 Redis：Cache-Aside、连接池、租户键与降级保护

缓存降低读取成本，也引入过期、失效、热点和依赖故障。必须先确定缓存哪些数据以及允许多旧，而不是给每个查询加一层 Redis。

## 1. 缓存数据的边界

service-lab 只缓存演示用不可变模板，任务状态始终从数据库读取。原因是任务版本和权限状态变化快，不能把一个三十秒旧缓存误认为真实执行结果。

可变数据采用 Cache-Aside 时，需要设计写库后失效、并发回填旧值、TTL 与版本键。删除缓存失败、DB 提交成功的窗口不能靠一次 GET/SET 自动解决。

## 2. 连接池与有限退化

transport.Cache 长期复用 go-redis 客户端，连接池上限 4，连接与读写有短超时，MaxRetries=-1 明确禁止隐式重试。失败时回源也受四个并发许可限制，避免缓存宕机直接放大成数据库洪峰。

即便 Context 有预算，也应核对客户端是否对所有网络阶段遵守它；配置 Dial、Read、Write、PoolTimeout 使等待路径有界。例子允许缓存写失败不影响已取得的源结果，适用于可退化读取，不适用于认证或余额等强约束。

## 3. 隔离 key 与验证

```bash
cd examples/gin/service-lab
go test ./internal/transport -run 'TestCache' -count=1 -v -timeout=30s
```

本机测试将客户端指向刚关闭的回环端口，验证依赖失败后仍在预算内回源；这不是 Redis 命中测试。真实命中与跨租户隔离由 -tags integration 的 Redis 用例验证，未连接服务就不会假装通过。

key 由 JSON 编码的 [tenant,id] 组成，避免简单冒号拼接产生歧义。TTL 30 秒只是实验值，需按业务新鲜度与流量选择。

## 4. 热点、穿透和锁

同一 key 并发回源可用 singleflight 类机制合并，但要区分调用者取消与共享加载任务，不能让第一个请求取消所有等待者。不存在项可短暂负缓存，但需控制基数和错误类型。

Redis 分布式锁还涉及过期、续约、持有者 token 与 fencing，不应把 SETNX 成功就等同于跨系统严格互斥。生产还需 TLS、ACL、连接恢复和命中率/池等待观测。

## 5. 练习与答案

### 5.1 Redis 故障时无条件回源最安全吗

不一定，可能压垮源站，要有并发与预算限制。

### 5.2 真实 Redis 不在线时替身测试能证明缓存命中吗

不能。

### 5.3 任务状态默认缓存越久越好吗

不是，需要按一致性和新鲜度需求决定。

## 6. 参考资料

- [go-redis](https://github.com/redis/go-redis)
- [Redis 连接池](https://redis.io/docs/latest/develop/clients/go/)
