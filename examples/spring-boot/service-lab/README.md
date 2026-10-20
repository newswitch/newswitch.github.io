# Spring Boot 任务服务实验

基线：JDK 25、Maven 3.9.14、Spring Boot 4.1.1。依赖由 Boot parent 管理。

## 运行

在此目录执行：

```bash
mvn clean verify
java -jar target/boot-service-lab-1.0.0.jar
```

只监听 127.0.0.1:8080。端口冲突可传 `--server.port=8081`。

```bash
curl -i http://127.0.0.1:8080/actuator/health
curl -i -u alice:lab-only-alice http://127.0.0.1:8080/api/tasks
```

alice 属于 alpha，bob 属于 beta。实验密码分别为 lab-only-alice 和 lab-only-bob。只供环回教学，禁止直接用于部署。H2 是进程内存库，退出后数据丢失。

写接口保留 CSRF；只带 Basic 密码直接 POST 会被拒绝。测试使用 Spring Security 的有效 CSRF Token 完成写入，没有为方便 curl 而关闭防护。

## 代码路径

- TaskController：HTTP、DTO 与可信租户映射。
- TaskService：有界分页、幂等创建、版本/状态条件更新。
- schema.sql：任务唯一约束和同库 Outbox。
- ApiErrors：业务异常的 Problem Details。
- SecurityConfiguration：密码验证、入口权限与 CSRF。
- ServiceLabTest：31 项验证，全部有限时并发，不连接现有外部服务。

## 验证边界

真实 H2 测试验证事务回滚、唯一约束、参数和并发幂等；真实安全过滤器与 MockMvc 验证输入/授权；随机端口的真实 HTTP 请求验证健康端点。MockMvc 不是 TCP 压测，H2 不代替生产数据库。

未包含 Redis、Kafka、RabbitMQ、Nacos、JWT IdP、Relay、OTel Collector、Testcontainers、systemd、Kubernetes 或 Native Image。Outbox 实验只验证发送意图和业务同事务，不声称端到端 exactly once。

仓库根目录可用 `scripts/verify-boot-service.mjs --java-home ... --maven-home ... --maven-repo ...` 将工程复制到独立临时目录验证，成功后只清理该临时目录。
