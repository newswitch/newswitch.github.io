# 数据集成学习配套材料

本目录对应 SeaTunnel、NiFi、Airbyte 三个系列，不替代产品发行包或生产部署配置。

| 路径 | 用途 | 边界 |
| --- | --- | --- |
| `seatunnel/smoke.conf` | JSON 语法 HOCON，FakeSource → Console | 需要 SeaTunnel 3.0.0、JDK 与两个插件；随机值不是业务数据基准 |
| `nifi/orders.json` | 三笔合成订单 | 无真实用户信息；金额保留十进制文本 |
| `nifi/recipe.json` | UI 搭建参数和预期 | 不是 NiFi flow export，不能导入流程接口 |
| `airbyte/source-messages.jsonl` | 传统 STDIO RECORD/STREAM STATE 的结构示例 | 合成 State，不属于某个真实 Connector，不得覆盖生产进度 |
| `source-baselines.json` | 资料与版本核对记录 | Airbyte 平台、Chart、工具与 Connector 分别版本化 |
| `test-contracts.mjs` | Node 标准库离线测试 | 只校验本文数据与计算，不模拟或认证产品实现 |

仓库根目录执行：

```bash
node --test examples/data-integration/test-contracts.mjs
npm run check:integration
```

第二条还检查 21 页元数据、MDX、84 个练习答案、6 张 Mermaid 图、JSON/YAML/JSONL 与示例一致性。两条命令都不启动 SeaTunnel、NiFi、Airbyte、数据库、Docker 或 Kubernetes，不下载连接器，也不声明已验证 JDBC、TLS、CDC、HA 或真实 State 恢复。

## 实际运行前

SeaTunnel 按文章安装包与插件，然后用 `seatunnel.sh --config /absolute/path/smoke.conf -m local` 执行；NiFi 根据文章手工建立组件并用 Run Once 运行单份输入；Airbyte 按选定 Chart/平台/Connector 文档准备隔离源目标。真实运行应单独保存版本、配置摘要、退出状态、数据校验与失败恢复结果。

密钥不进入本目录。不要为了演示关闭 TLS、清空生产队列、删除恢复状态，或让新旧任务竞争写入同一目标。
