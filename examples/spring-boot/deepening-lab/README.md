# Spring Boot 数据、消息、身份与遥测实验

固定基线：JDK 25，Spring Boot 4.1.1，Maven 3.9.x；MyBatis Starter 单独锁定为 4.0.0，其余框架依赖由 Boot BOM 管理。测试使用 JDK 25.0.4 与 Maven 3.9.14。不是生产部署模板。

## 目录

```text
deepening-lab/
├── persistence/   # Mapper、实体、真实 SQL 次数、事务与缓存
├── delivery/      # 本地事务、Outbox 领取、Relay、Inbox、Redis 和两种 Broker
├── identity/      # Bearer API、OIDC Web 客户端、JWK 与 Keycloak realm
├── telemetry/     # OTLP、ECS 日志、Prometheus、连接等待与有界压测
├── compose.yaml   # 显式 Profile 启动外部实验服务
└── pom.xml
```

从仓库根目录执行：

```bash
java -version
mvn -version
mvn -B -ntp -f examples/spring-boot/deepening-lab/pom.xml clean verify
node scripts/verify-boot-deepening.mjs
```

不依赖系统数据库、Redis、Broker 或 Keycloak，默认不运行 `BrokersIT`。测试 HTTP 只监听本机临时端口，结束关闭接收器和应用；内存数据库可丢弃。各 Maven 测试 JVM 最大堆 512MiB，模块顺序运行。

| 模块 | 默认测试数 | 实际边界 |
| --- | --- | --- |
| persistence | 15 | Boot + H2 + MyBatis/Hibernate；SQL、缓存、事务、LAZY、版本竞争 |
| delivery | 13 | Boot + H2 的事务/租约/幂等；受控 Redis 客户端错误和回源并发 |
| identity | 16 | 真实 HTTP Bearer、RSA/JWK、轮换；受控 OIDC 协议端点的换码、刷新和拒绝错 state |
| telemetry | 4 | 真实 HTTP、OTLP protobuf 接收、span 关系、导出拒绝和 Prometheus |
| 合计 | 48 | 不将未执行的外部服务测试计作通过 |

Mockito 测试扩展选择 subclass mock maker；不依赖动态 Agent 自附加来 Mock 最终类。部分框架测试监听器可能仍探测 inline 支持而打印 JDK/路径相关告警，不能通过隐藏失败或跳过测试解决。测试私钥每次生成，绝不复用到生产。

## 数据访问

```bash
mvn -B -ntp -f examples/spring-boot/deepening-lab/pom.xml -pl persistence verify
```

查看 `PersistenceTest`：一级缓存同事务 1 次 prepare、事务外 2 次、查询/更新/查询 3 次；namespace 缓存不能观察 JdbcTemplate 外部写。JPA 的 3 个 LAZY owner 产生 4 次 prepare，fetch join 为 1。H2 的结果不替代目标数据库的锁、分页和执行计划测试。

## Redis、Kafka 与 RabbitMQ

在本目录下使用 Docker Compose v2。先用 config 检查配置，确认 16379、19092、15672 是空闲的实验端口。15672 在这里映射的是 AMQP 5672，不是 RabbitMQ 管理界面。

```bash
docker compose --profile brokers config
docker compose --profile brokers up -d --wait redis kafka rabbit
mvn -B -ntp -pl delivery -Pbrokers verify
docker compose --profile brokers logs --tail=100 kafka rabbit
docker compose --profile brokers down
```

`-Pbrokers` 额外运行 3 项真实联调测试，服务缺失会失败，绝不自动跳过。测试显式启用 Spring brokers Profile；普通 verify 只编译这部分测试。此工作环境未启动 Docker 引擎，因此这 3 项未实际运行。

每种 Broker 分别执行 Relay → Broker → Consumer → Inbox；主动重发同一 eventId，等待重复计数增长并确认业务结果只有一次。两种适配器是对照，不要求生产同时双写。Redis 测试只写随机专属键并逐个清理，不使用 FLUSHALL。

发送端有时间上限。Rabbit 发送同时检查 Confirm 和 Return，消费者提交后手动 ACK，失败拒绝到 DLQ；Kafka 使用 RECORD 和有界错误处理/DLT。普通 Rabbit 队列死信与单节点 Broker 不是灾备保证。

默认数据在进程退出后消失。需要观察进程重启时，使用全新测试路径配置 H2 file；真正多进程部署换独立数据库。`Relay.once` 是可控单次迭代，没有默认无限后台任务。`TaskEvent` 仅有 TaskCreated，不承诺多事件聚合顺序；幂等请求创建见相邻 service-lab。

## Keycloak 与服务端客户端

```bash
docker compose --profile identity up -d keycloak
curl -f http://localhost:18080/realms/boot-lab/.well-known/openid-configuration
mvn -B -ntp -pl identity verify
java -Xmx384m -jar identity/target/identity-lab-1.0.0.jar --spring.profiles.active=oidc
```

统一使用 localhost。浏览器打开 `http://localhost:8082/oauth2/authorization/keycloak`；实验用户 alice，密码 `lab-alice-only-not-production`。登录后访问 `/call-api`，由服务端管理 Access/Refresh Token，API 需要 task-api audience、task:read scope 和 tenant。

访问令牌 60 秒，刷新 provider 已配置。等待过期再调用并结合 IdP 事件验证刷新；只有第二次 200 不能证明刷新。单 Session/内存授权客户端不提供多副本并发刷新协调。应用 POST logout 保留 CSRF，不等同已实现 Keycloak 单点退出。

BrowserFlowTest 另用受控 discovery、JWK、token 和 userinfo 端点实际走通 Boot 回调：检查 S256 verifier 换码、OIDC nonce、短授权生命周期触发刷新、服务端访问 API，以及错 state 不换码、Session Cookie 不能认证 Bearer API。它不处理真实用户登录，也不模拟 Keycloak 的完整撤销和刷新复用策略。

Keycloak 容器浏览器登录、刷新和管理端密钥操作未在当前 Docker 未运行环境执行；受控协议对端不冒充完整 IdP。realm、固定密码、明文 HTTP 和开发模式只能用于环回实验。结束后关闭应用并在本项目下 down。

## 遥测、等待与容量

```bash
docker compose --profile telemetry up -d collector
java -Xmx384m -jar telemetry/target/telemetry-lab-1.0.0.jar
```

另一个终端：

```bash
curl -f "http://127.0.0.1:8083/work?holdMs=80"
curl -f http://127.0.0.1:8083/actuator/prometheus
docker compose --profile telemetry logs --tail=100 collector
node telemetry/load.mjs --requests 80 --concurrency 8 --hold-ms 80
```

OTLP HTTP protobuf 导向 14318/v1/traces，Collector 是 traces-only 的 debug pipeline；指标经 Prometheus 拉取、日志写 ECS。默认测试使用真实临时 OTLP 接收器，不需要 Docker。proto Java 依赖仅用于测试解析，不加入应用运行产物。

从仓库根目录自动运行四档对照：

```bash
node scripts/verify-boot-deepening.mjs --run-http --java-home /你的/JDK25目录
```

脚本只访问 loopback，依次启动并关闭自有 JVM，每组 80 请求，预热后比较 2 连接串行、2/4 连接并发和准入 2。测量文件保存到忽略目录 `.java-article-checks/deepening-load`；示例原始统计见 `telemetry/sample-results.json`。

人为持有连接不是慢 SQL，闭环负载不是固定到达率，少量样本不是 P99/SLO 结论。快速 503 会提高“完成/秒”，不等于提高成功吞吐。真实数据库、网络、容器限额与发布/故障余量需目标环境再验证。
