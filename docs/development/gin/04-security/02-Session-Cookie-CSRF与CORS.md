---
title: "Gin Session、Cookie、CSRF 与 CORS：浏览器凭证的四个边界"
sidebar_label: "02. Gin Session、Cookie、CSRF 与 CORS：浏览器凭证的四个边界"
sidebar_position: 2
description: "Cookie 存放凭证，Session 保存会话状态，CSRF 利用浏览器自动携带凭证，CORS 控制浏览器跨源读取。四者相关，但不是同一个安全开关。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin Session、Cookie、CSRF 与 CORS：浏览器凭证的四个边界

Cookie 存放凭证，Session 保存会话状态，CSRF 利用浏览器自动携带凭证，CORS 控制浏览器跨源读取。四者相关，但不是同一个安全开关。

## 1. Session 的完整生命周期

登录验证成功后生成不可预测的随机 session ID，服务端保存用户、权限版本、过期时间等状态，Cookie 只携带 ID。登录与权限提升时轮换 ID，退出时使服务端状态失效，并限制并发会话与空闲/绝对有效期。

多副本共享会话可使用受保护 Redis 或数据库；内存 Session 在重启与跨副本时不可靠。存储故障时通常不能像普通模板缓存一样无条件“降级为已登录”。

## 2. Cookie 属性实验

```bash
cd examples/gin/service-lab
go run ./cmd/webdemo -case cookie
```

```text
status=200 httpOnly=true sameSite=2
```

完整代码与断言见 [service-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/gin/service-lab)。

演示仅检查 HttpOnly 与 SameSite 属性，不实现真实登录与 Session 存储。生产 HTTPS 下应设置 Secure，谨慎限定 Path/Domain；HttpOnly 限制脚本读取 Cookie，但不阻止浏览器自动发送，也不彻底消除 XSS 的危害。

## 3. CSRF 与 CORS 分别防什么

Cookie 自动携带使跨站请求可能带上受害者身份，状态修改接口可采用与 Session 绑定的 CSRF Token、Origin 校验与 SameSite 策略。不能仅检查 Content-Type 就认为所有攻击不可能。

CORS 主要约束浏览器读取跨源响应，不是服务端认证，也不阻止所有跨源发送。允许 credentials 时不能随意用 * 作为任意可信 Origin，必须使用受控白名单并正确处理预检。

## 4. Bearer 与浏览器存储

显式 Authorization Bearer 不是传统自动 Cookie 发送路径，但 Token 存放位置会影响 XSS、持久化与泄露风险。URL query 中的长效 Token 可能进入访问日志、历史与 Referer，应避免。

选择 Cookie Session、短期 Bearer 或 BFF 架构应按客户端类型和威胁模型决定。本文不提供一个硬编码账号密码的“生产登录”，因为那会掩盖密码校验、限速、撤销与身份系统边界。

## 5. 练习与答案

### 5.1 HttpOnly 能直接防止 CSRF 吗

不能，它主要限制脚本读取 Cookie。

### 5.2 CORS 是接口认证吗

不是，非浏览器客户端不受同样约束。

### 5.3 Redis Session 故障能默认视为登录成功吗

不能，认证状态不能无条件失败开放。

## 6. 参考资料

- [Cookie RFC](https://www.rfc-editor.org/rfc/rfc6265)
- [Gin Cookie](https://gin-gonic.com/en/docs/examples/cookie/)
