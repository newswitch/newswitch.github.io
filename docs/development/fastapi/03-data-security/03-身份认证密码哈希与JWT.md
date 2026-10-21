---
title: "身份认证、密码哈希与 JWT"
sidebar_label: "03. 身份认证、密码哈希与 JWT"
sidebar_position: 3
description: "理解密码验证、令牌签发与验证，明确算法、签发者、受众、过期和密钥生命周期。"
tags: [FastAPI, SQLAlchemy, 安全]
---

# 身份认证、密码哈希与 JWT

认证回答调用者是谁，JWT 只是携带已签名声明的一种格式。常见签名 JWT 不加密载荷，不能放入密码、私钥或本不该让持有者看到的秘密。

## 1. 从登录到访问

密码存储使用适当的自适应哈希方案与参数，而不是明文或普通快速哈希。认证成功后签发短期访问令牌，资源服务验证签名与必要声明，再执行授权。

公共浏览器/移动端通常应优先采用适合场景的 OIDC/OAuth 授权流程，不能把教学中的密码交换接口直接当作通用 SSO 设计。

## 2. 受控的令牌实验

```python title="api_auth.py"
from datetime import UTC, datetime, timedelta
import secrets
import jwt
from pwdlib import PasswordHash

def main():
    passwords = PasswordHash.recommended()
    stored = passwords.hash("lesson-password")
    print("password:", passwords.verify("lesson-password", stored))
    key = secrets.token_bytes(32)
    now = datetime.now(UTC)
    token = jwt.encode({
        "sub": "user-1", "iss": "lesson-issuer", "aud": "jobs-api",
        "iat": now, "exp": now + timedelta(minutes=2),
    }, key, algorithm="HS256")
    claims = jwt.decode(
        token, key, algorithms=["HS256"], issuer="lesson-issuer",
        audience="jobs-api", options={"require": ["sub", "iss", "aud", "exp"]})
    print("subject:", claims["sub"])
    try:
        jwt.decode(token, key, algorithms=["HS256"], audience="other",
                   issuer="lesson-issuer")
    except jwt.InvalidAudienceError:
        print("wrong audience rejected")

if __name__ == "__main__":
    main()
```

```text title="api_auth.out"
password: True
subject: user-1
wrong audience rejected
```

随机密钥只用于这次独立实验，进程退出后不可恢复；实际系统使用受控 Secret/密钥服务和轮换机制。示例不打印哈希、令牌或密钥。

## 3. 验证必须由服务端决定

允许的算法、issuer、audience 应来自可信配置，不从令牌头任意选择。验证 exp/nbf 等时间声明，并明确哪些字段必须存在；校验签名本身不表示声明完整。

HS256 的验证方掌握共享秘密，也拥有签发能力；跨服务场景可采用合适的非对称签名和受控 JWKS 分发。kid 只能作为受限键选择信息，不能任意变成 URL 或文件路径。

过期、撤销、用户禁用、权限变更和密钥轮换需要独立策略。短有效期降低风险但不自动解决撤销；刷新令牌还需要存储、轮换与重放检测等设计。

## 4. FastAPI 集成边界

HTTPBearer/OAuth2PasswordBearer 提取凭证，不自动验证所有 JWT 业务规则。依赖函数完成验证并返回受信任身份，路由再做资源授权。

401 通常表达缺失/无效认证，并按协议提供 WWW-Authenticate；403 表达身份已知但操作不允许。避免把内部验证原因原样全部暴露给攻击者，服务器端保留脱敏关联证据。

### 4.1 令牌过期、刷新与撤销不是一个操作

访问令牌过期后，客户端不能只是自己改 exp；必须通过受控身份流程取得新凭证。刷新令牌通常是高价值凭证，服务端保存可验证的指纹、用户、到期、令牌族和使用状态，而不是把明文刷新令牌写进日志。

轮换式刷新可以在事务中完成“确认未使用 → 标记旧令牌已使用 → 创建后继令牌”。并发刷新要由唯一约束或条件更新仲裁，不能两边都成功。旧令牌再次出现时，应按令牌族策略识别重放并撤销相应后继；网络重试与恶意重放如何区分，也要由身份系统协议明确。

撤销刷新令牌并不自动让已签发的自包含访问 JWT 立即失效。需要短有效期、用户/会话版本检查、撤销列表或在线校验等策略，选择依据是失效时效、可用性与查询成本。权限缓存也有相同的新鲜度问题。

### 4.2 密钥轮换的重叠窗口

签发者启用新密钥前先让验证者能够取得它，再切换签发；旧验证密钥通常保留到已签发访问令牌失效和允许时钟偏差之后。kid 只在受控密钥集合中选择，不能成为任意网络取钥地址。共享密钥泄露与普通轮换不同，需要重新评估所有可签发者和令牌的信任。

密码登录还需防暴力尝试、处理账号状态，并避免用不同响应泄露账号存在性。公共浏览器/移动端接入优先采用适当的 OIDC 授权流程；不要为演示一个 JWT 自行发明完整 SSO。

综合工程把签发限制在本地 CLI，用于可重复学习 API 验证、权限与租户过滤；真实登录/刷新由可信身份组件负责。测试应分别覆盖签名错误、过期、错误受众、缺字段、权限不足和跨租户，而不是只测正常解码。

## 5. 练习与答案

### 5.1 JWT 签名后，别人还能读载荷吗？

答案：常见签名 JWT 可以被解码读取，签名用于完整性与来源验证，不等于加密。

### 5.2 只验证签名，不检查 audience 有什么风险？

答案：其他服务合法签发的令牌可能被错误接受。资源服务需要校验与自身契约匹配的受众和签发者。

### 5.3 HTTPBearer 已解析字符串，就表示用户登录成功吗？

答案：不是。提取与验证是不同步骤，还要检查令牌、用户状态和授权。

## 6. 参考资料

- [FastAPI JWT 与密码哈希](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)
- [PyJWT Usage](https://pyjwt.readthedocs.io/en/stable/usage.html)
- [JWT Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725.html)
