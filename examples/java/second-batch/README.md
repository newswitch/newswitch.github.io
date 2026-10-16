# Java 语言与标准库示例

18 个独立程序分别对应 Java 语言专题第 9 至 12 篇，以及标准库专题第 1 至 14 篇。使用 JDK 25 正式功能，无第三方依赖，不需要 Maven。

从仓库根目录执行，替换为自己的 JDK 25 路径：

```powershell
node scripts/verify-java-standard-library.mjs --java-home 'C:/Java/jdk-25'
```

Linux 同样传入对应目录：

```bash
node scripts/verify-java-standard-library.mjs --java-home /opt/jdk-25
```

脚本校验文章代码与源文件一致，逐一编译并核对文章所列输出，验证 4 个预期编译失败案例，以及空输入、不可修改集合和精确除法等边界。编译产物使用独立临时目录，全部通过后清理；单次子进程有超时限制。

只检查正文与源码一致性：

```bash
node scripts/verify-java-standard-library.mjs --check-sources
```

单独运行时进入相应示例目录，按文章的 javac/java 命令执行。`http` 示例额外需要 `--add-modules jdk.httpserver`：只绑定 127.0.0.1 临时端口，并在 finally 中停止服务和线程池。`files` 与 `nio` 示例只删除自己创建的临时文件。

| 目录 | 主题 |
| --- | --- |
| equality、exceptions、models、design | 对象相等、异常与资源、类型建模、依赖边界 |
| generics、text | 类型参数、Unicode 与正则 |
| lists、maps、sorted、queues、views | 集合结构、顺序与视图 |
| lambdas、streams | 行为参数化、流与缺失结果 |
| values-time | 精确十进制与时间语义 |
| files、nio、http | 文件、缓冲与网络调用 |
| reflection | 注解、反射与接口代理 |

示例用于验证明确的语言与 API 行为，不是性能基准或生产持久化实现。
