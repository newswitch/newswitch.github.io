# Gin service-lab

配套 [Gin 学习路线](https://newswitch.github.io/docs/development/gin/Gin学习路线/)。Go 1.27.3、Gin 1.12.0，依赖固定在 go.mod/go.sum。

这个实验不执行任意用户脚本。任务只完成一个有限字符串处理，用于验证 HTTP、事务、租约、事件与重启边界。默认 SQLite，可切换 pgx/PostgreSQL；Redis 和 Kafka 不影响第一轮本机任务实验。

## 1. 本机测试与路由实验

```bash
go version
go mod download
go mod verify
go test ./... -count=1 -timeout=60s
go vet ./...
go run ./cmd/webdemo -case middleware
go run ./cmd/webdemo -case upload
```

webdemo 的案例：routing、middleware、abort、binding、json、context、copy、upload、sse、cookie、proxy、recovery。它们是有限 Recorder 实验，不留下服务器。Cookie 案例只说明属性，不是登录系统。

## 2. PowerShell 完整请求实验

在本目录构建：

```powershell
go build -trimpath -o out/taskd.exe ./cmd/taskd
```

终端 A（仅回环隔离实验）：

```powershell
.\out\taskd.exe -demo -listen=127.0.0.1:8084 -dsn=tasks.db
```

终端 B（同一目录）：

```powershell
$labToken = .\out\taskd.exe -mode=token -demo
$labHeaders = @{ Authorization = "Bearer $labToken"; 'Idempotency-Key' = 'first-task' }
$labTask = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8084/api/tasks -Headers $labHeaders -ContentType application/json -Body '{"name":"first-task"}'
$labTask
.\out\taskd.exe -mode=worker -dsn=tasks.db
Invoke-RestMethod -Uri "http://127.0.0.1:8084/api/tasks/$($labTask.id)" -Headers $labHeaders
```

预期创建 NEW，独立 Worker 后 SUCCEEDED，result=completed:first-task。重复相同键/正文返回同一 ID，不同正文返回 409。用 `-tenant=beta` 签发另一个实验 Token，读取 alpha 的任务应返回 404。

停止 API 后用同一路径重启，结果仍存在。API 与 Worker 相对工作目录必须一致，或使用确定的绝对数据库路径。Linux 构建 `out/taskd` 并运行 `./out/taskd`；通过 curl 的步骤见综合文章。

`-demo` 使用公开实验签名 key，CLI 禁止远端监听；不可部署到生产。真实使用设置随机 LAB_JWT_KEY，至少 32 字节；环境变量也需要权限保护，不要输出到日志。

## 3. 进程模式与配置

| 模式/配置 | 含义 |
| --- | --- |
| serve | API 与独立回环管理 Listener；不会自动启动 Worker |
| worker | 默认领取一次，`-watch` 持续轮询直至信号 |
| relay | 默认发送一条可领取 Outbox，确认后标记 sent |
| consume | Kafka 消费、Inbox+通知同事务，再提交 offset |
| token | 实验签发，不是公开登录端点 |
| LAB_DB_DRIVER | sqlite 或 pgx，默认 sqlite |
| LAB_DB_DSN | 数据库连接信息，优先于默认值；避免通过启动参数泄露密码 |
| LAB_JWT_KEY | HMAC 实验密钥；生产可替换为受信 OIDC 验证 |
| LAB_OTLP_ENDPOINT | OTLP HTTP URL，空路径补 `/v1/traces` |
| -redis | 可选 Redis 地址，仅缓存不可变演示模板 |
| -kafka / -topic | 隔离 Broker 地址与 Topic |

API：`POST /api/tasks`、`GET /api/tasks`、`GET /api/tasks/:id`、`POST /api/tasks/:id/cancel`、`GET /api/tasks/:id/events`、`GET /api/templates/:id`。取消正文为 `{"version":0}`，仅 NEW 可取消。

管理默认 `127.0.0.1:9091`，含 `/metrics`、`/debug/pprof/`；公开 API 不挂载这些路径。SSE 为最多三秒的状态快照流，不支持 Last-Event-ID 历史重放。浏览器原生 EventSource 不能直接设置任意 Bearer Header，需选择合适客户端或会话方案。

## 4. 真实中间件联调

只在专门的本机实验环境执行。Compose 密码公开且监听回环，没有生产 TLS/ACL，不用于生产。固定镜像用于实验，不声称是所有产品的最新推荐；真实采用前拉取验证并记录 digest。

```powershell
docker compose -f compose.yaml up -d
docker compose -f compose.yaml ps
docker compose -f compose.yaml exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --create --topic go-lab-events --partitions 1 --replication-factor 1
$env:GO_LAB_PG_DSN = 'postgres://lab:isolated-lab-only@127.0.0.1:15432/gin_lab?sslmode=disable'
$env:GO_LAB_REDIS_ADDR = '127.0.0.1:16379'
$env:GO_LAB_KAFKA_ADDR = '127.0.0.1:19092'
$env:GO_LAB_KAFKA_TOPIC = 'go-lab-events'
go test -tags=integration ./integration -count=1 -timeout=90s
```

等待各服务真正就绪后测试；Topic 已存在时检查是否为空，或创建新的独立 Topic 并更新环境变量。PostgreSQL 测试只接受回环 gin_lab，需无其他 Worker 竞争；只清理自己随机 tenant 的业务行，不执行 DROP/TRUNCATE。Redis 测试 key 使用随机 ID 并有 TTL。Kafka 测试验证真实确认与落库，不能用 Fake 通过替代。

可选 Collector：`$env:LAB_OTLP_ENDPOINT = 'http://127.0.0.1:14318'` 后重新启动 API；检查 Collector 日志。当前 Collector 只输出 debug，没有持久追踪后端。

只停止本实验资源并保留卷：

```powershell
docker compose -f compose.yaml down
```

`down` 停止并移除这个 Compose 项目的容器与网络，不带 `-v`。不要把它用于无关目录或已有共享项目。

## 5. 验证边界

仓库根目录运行：

```powershell
node scripts/verify-go-gin-labs.mjs --go D:/Go/bin/go.exe
```

示例路径需指向 Go 1.27.3；如果系统路径仍是较旧 Go，传入独立工具链路径，不需要替换系统安装。

脚本测试、vet、校验依赖、构建二进制、运行独立实验、有限 profile/Fuzz/Benchmark，启动 API → 独立 Worker → 重启读取并自动关闭所建进程。结果写入忽略目录 `.go-article-checks/verification.json`。

本地已验证真实回环 HTTP/SSE 与 OTLP Protobuf 父子 Span。外部 PostgreSQL/Redis/Kafka、Docker/Collector/K8s、Race、Linux SIGTERM 排空需要具备环境后分别执行；编译 integration 测试不计作服务联调。Windows 强制终止也不计作 Linux 优雅退出。

## 6. 明确的工程限制

- 自动 DDL 只为隔离实验，不是生产迁移器；多副本生产需版本化迁移与最小权限。
- SQLite 单连接及本地文件不代表高并发多副本共享数据库；使用 PostgreSQL 并单独验证。
- Worker 最多三次领取，过期预算耗尽转 FAILED；长任务需续租、取消和时间源设计。
- Relay 至少一次发送，消费去重，不保证通用外部副作用恰好一次。
- 随机事件 ID 排序未保证同任务按 version 发布；当前通知消费不是有序状态投影。
- 毒消息停止并报错，没有自动 DLT；需隔离与受控重放，不能静默提交跳过。
- 不承担完整 OIDC 身份提供方、任意脚本执行、持久 SSE 历史与自动任务调度平台；SQL Session、密钥轮换与迁移由下面的独立模块演示。

## 7. 深化实验

```bash
go test ./internal/session ./internal/keyauth ./internal/migrate -count=1 -v -timeout=30s
go test ./internal/app -run TestPoolWaitDiagnosisAndRecovery -count=1 -v -timeout=10s
```

| 模块 | 实际验证 |
| --- | --- |
| session | 本机 TLS + Cookie Jar 登录、CSRF、ID 轮换、旧凭证失效、退出、idle/absolute 过期、有界清理、独立连接池共享状态、存储故障失败关闭 |
| keyauth | RS256 旧新公钥重叠、过期、仍未过期旧凭证的密钥退役、错误更新保留旧集合、Gin 请求 |
| migrate | 固定连接、连续版本与 checksum、并发协调、DDL/ledger 一起回滚、兼容可空列扩展 |
| app pool case | 借出唯一连接，记录请求 504 和池等待；仅归还连接后恢复 200，检查 InUse 与许可归零 |

Session 的身份验证回调由调用方提供，测试身份不是生产账号系统。Handler 要求同源 HTTPS；Session/RS256 与原 taskd HMAC 入口保持独立，不能无条件混合算法和凭证模型。

session.New 不自动建表，需在明确的迁移步骤调用 migrate.Up 后装配。迁移器只支持本实验的事务 DDL，不处理通用在线索引、百万行回填或自动破坏性 down。原 Task Store 的便捷自动建表仍仅用于基础实验。

PurgeExpired 是显式批量操作，调度由所有者管理；认证请求不会自动启动永久清理进程。Cookie Jar 测试不替代真实浏览器的跨源、安全属性与代理链验证。

外部 integration 集合新增 PostgreSQL Session/迁移用例，只有实际连接隔离 gin_lab 运行后才算该数据库验证通过。普通测试只覆盖 SQLite 与本机 HTTPS，不能替代此项。

## 8. 请求取消与 Context 生命周期

```bash
go test ./internal/requestflow -v -count=1 -timeout=30s
go test ./internal/app -run 'TestHealth|TestDependencyFailureChangesReadinessNotLiveness' -v -count=1
```

requestflow 使用 Gin 1.12.0 与 x/sync v0.23.0，验证 fallback 开关、Copy 容器隔离与嵌套引用、Request Context 共享、Next/Abort/return 的调度差异。真实回环 HTTP 对照同样返回 504 时后台任务仍活动或已经 Join 的两种情况；负面实验由测试拥有者主动解除并 Join，不留下后台进程。

健康检查测试关闭本机实验 DB，确认 live=200、ready=503。当前 taskd 的 readiness 不维护独立 draining 状态，信号 Context 也没有直接作为全部请求的 BaseContext；不能把这些测试等同于 Linux 信号或 Kubernetes 摘流已验证。

## 9. 绑定、协议与响应提交

```bash
go run ./cmd/protocol-lab -mode binding
go run ./cmd/protocol-lab -mode response
go test ./internal/protocol -v -count=1 -timeout=20s
```

默认 Gin 1.12.0 codec 使用 encoding/json，不在请求中切换全局 Decoder 选项。绑定实验验证 Should/Must 的响应控制、默认 binder 的未知字段与尾部行为、消费型 Body、缓存重绑与零值验证。独立 ReadInput 示例限制 64 字节，仅接受 JSON，检查 EOF、null 和字段规则，按 400/413/415 分类；测试包括恰好上限、超长尾部与缓存前上限。

原 taskd 仍采用 4096 字节及输入错误统一 400 的现有契约；protocol 没有改变其公开 API，也没有声称额外拒绝重复键。

响应实验用真实回环 HTTP/1.1 对照待发送状态、Flush 提交、提交后修改、编码错误无策略/有策略和 204。状态记录用 Mutex 同步，自建服务与连接在结束时关闭。它不替代反向代理、HTTP/2 或生产网络断连测试；c.Errors 中有错也不意味着框架自动生成 500。

## 10. 路由、Recovery 与 multipart

```bash
go test ./internal/requestflow -run 'TestMiddlewareRegistration|TestMethodTrees|TestRecoveryOrder|TestMultipartMemory' -v -count=1 -timeout=20s
go test ./internal/transport -run TestCache -v -count=1 -timeout=20s
```

验证全局 Use 不追溯改写已注册业务链、405/Allow、HEAD 不自动继承 GET、GET/POST 尾斜杠 301/307，以及 Recovery 内层普通 after 与 defer 的不同。已提交 202 后 panic 不能改成干净 500。

multipart 用正常 128 字节文件、1 字节内存阈值和独立 1024 字节正文上限，证明内存阈值不是总上传上限；显式关闭句柄并清理本实验解析产生的临时文件。

go-redis v9.23.0 的 PoolSize 是基础规模，当前普通 GET/SET 池同时设置 MaxActiveConns=4，并启用 ContextTimeoutEnabled；配置测试直接断言。新增 Pipeline 等用法时应另查其池与预算，不能把普通池参数扩大为全客户端所有连接的总保证。真实 Redis、Kafka 与 PostgreSQL 联调仍独立执行。
