# DataX 同步与校验示例

源码基线见 `source-lock.json`。本目录不包含 DataX 运行包、JDBC JAR、数据库或账户；Python 3.10+ 的离线校验仅依赖标准库。

## 离线检查

从仓库根目录执行：

```bash
python -B examples/datax/sync-lab/sync_contract.py summarize examples/datax/sync-lab/fixtures/orders.csv
python -B -m unittest discover -s examples/datax/sync-lab -p "test_*.py" -v
```

固定数据预期：四行、四个业务键、金额总和 `30.30`、一个 NULL 金额、客户编号保留前导零。校验器对规范化字段计算集合指纹，并能发现缺失、多余、重复和字段变化。它不读取数据库，也不证明源快照和 CDC 之间没有间隙。

## 第一次运行 DataX

先按文章部署审核过的 DataX，确认运行包与插件来源，设置自己的 `DATAX_HOME`。以下 Linux/Bash 命令只在本次新建的临时目录写入任务和输出，不清理已有数据：

```bash
export DATAX_HOME=/opt/datax
python3 "$DATAX_HOME/bin/datax.py" examples/datax/sync-lab/jobs/smoke.json
datax_demo_dir=$(mktemp -d)
mkdir "$datax_demo_dir/output"
export DATAX_INPUT_FILE="$(pwd)/examples/datax/sync-lab/fixtures/orders.csv"
export DATAX_OUTPUT_DIR="$datax_demo_dir/output"
python3 examples/datax/sync-lab/render_job.py \
  examples/datax/sync-lab/jobs/file-copy.template.json \
  --out "$datax_demo_dir/file-copy.json"
python3 "$DATAX_HOME/bin/datax.py" "$datax_demo_dir/file-copy.json"
python3 examples/datax/sync-lab/sync_contract.py compare \
  "$DATAX_INPUT_FILE" "$DATAX_OUTPUT_DIR"/orders*
```

最后一个命令的退出码：0 表示本次比较无差异，1 表示存在键或字段差异，2 表示输入格式、重复键或读取错误。Writer 可以生成随机后缀与多个分片，必须把本次真实输出传给校验器。不要把日志或别的批次混入。

重新执行同一文件任务会遇到 `nonConflict` 的安全边界。新的尝试使用新的临时目录，不把 `truncate` 当成自动修复。临时输出供检查后按精确目录自行回收，不使用宽泛递归删除。

## MySQL 模板

仅在独立实验数据库执行 `prepare-lab.sql`。它创建 `datax_lab.orders` 和 `orders_stage`，插入固定四行；重复执行 INSERT 会报重复键，故意不清空旧表或掩盖旧状态。

`mysql-to-csv.template.json` 导出到本批独立目录；`mysql-to-mysql.template.json` 使用 insert 写 staging，不自动覆盖正式数据。使用后者前确认目标为空且无人并发写入；新的恢复尝试应明确隔离旧批次。

模板需要以下环境变量，按实际模板用到的部分设置：

| 环境变量 | 用途 |
|---|---|
| `DATAX_SOURCE_USERNAME` / `DATAX_SOURCE_PASSWORD` | 只读测试源账号 |
| `DATAX_SOURCE_JDBC_URL` | 测试源 JDBC URL |
| `DATAX_TARGET_USERNAME` / `DATAX_TARGET_PASSWORD` | staging 写入账号 |
| `DATAX_TARGET_JDBC_URL` | 测试目标 JDBC URL |
| `DATAX_WINDOW_START` / `DATAX_WINDOW_END` | UTC 半开窗口，格式 `YYYY-MM-DD HH:MM:SS` |
| `DATAX_OUTPUT_DIR` | CSV 输出目录，仅文件目标需要 |

例如全四行范围使用 `2026-11-01 00:00:00` 到 `2026-11-01 03:00:00`。JDBC URL 的 TLS 参数、信任链、会话时区和驱动兼容性需按已审核组合配置；不以关闭 TLS 或降级认证方式换取连接。

MySQL 模板显式设置共享类型转换时区为 UTC。运行 JVM 也应使用已核对的 UTC 配置，例如通过 `--jvm="-Duser.timezone=UTC"` 追加；还要验证 JDBC 如何解释源字段，不能靠这两个开关替代时区测试。

由可信环境注入变量后，调用 `render_job.py TEMPLATE --out NEW_PRIVATE_FILE`。渲染器不连接数据库、不执行 SQL、不通过 shell 替换口令；输出文件采用独占创建，Linux 下请求 0600 权限。Windows 的实际访问控制以 ACL 为准，不能用 POSIX mode 位证明。

不要把口令写进 README、任务模板、Git 或命令历史。环境变量仍需权限与进程范围保护，实际任务日志也必须脱敏和限权。

## 验证边界

单元测试验证 CSV 契约、Decimal、NULL、窗口边界、重复键、差异退出状态、渲染和状态推进条件。水位函数是纯函数示例，不提供持久化控制库、CAS 锁或分布式提交。

DataX JVM、MySQL/JDBC/TLS、HDFS、对象存储和 Kubernetes Job 必须在对应测试环境另行验证。本目录不声明这些外部集成已经由离线测试完成。
