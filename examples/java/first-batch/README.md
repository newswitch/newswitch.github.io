# Java 第一阶段示例

这些源文件与 `docs/development/java/` 中第一阶段文章的完整代码块对应，采用 JDK 25 正式功能。确定性输出写在各文章中。

| 目录 | 观察内容 |
| --- | --- |
| hello | 编译、Classpath、源文件模式与 JAR |
| types | 溢出、转换、引用共享和拆箱 |
| flow | 控制流、预算选择和空数组 |
| calls | 值传递、对象修改、重载和可变参数 |
| objects | 构造约束、封装、别名和状态 |
| dispatch | 接口、实现、构造注入与多态 |
| visibility | 多包、static、final 与访问控制 |
| maven-task-cli | Maven 编译、JUnit 测试、JAR 打包和运行 |

例如在 hello 目录执行：

```bash
javac -encoding UTF-8 --release 25 -d out Hello.java
java -cp out Hello Infra
```

Maven 工程在 maven-task-cli 目录执行：

```bash
mvn -B clean verify
java -jar target/task-cli-1.0.0.jar 10 3
```

版本约定：Maven 3.9.14、JUnit 6.0.3，插件固定在 POM。示例没有后台服务，不修改系统默认 JDK。

仓库维护时，可先检查所有完整代码块与源文件一致：

```bash
node scripts/verify-java-examples.mjs --check-sources
```

使用明确的 JDK 和 Maven 验证实际运行；以下路径需要替换为本机目录：

```bash
node scripts/verify-java-examples.mjs --java-home /opt/jdks/jdk-25 --maven-home /opt/tools/apache-maven-3.9.14
```

脚本检查七组 Java 程序的完整输出、Class 主版本、源文件模式、JAR、预期编译失败，以及 Maven 的四个测试和产物内容。仅使用 `--check-sources` 不会执行 Java 或 Maven。
