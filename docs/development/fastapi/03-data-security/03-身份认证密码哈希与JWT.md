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
