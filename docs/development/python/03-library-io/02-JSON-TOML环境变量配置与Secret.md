---
title: "JSON、TOML、环境变量、配置与 Secret"
sidebar_label: "02. JSON、TOML、环境变量、配置与 Secret"
sidebar_position: 2
description: "建立配置的解析、合并、校验和脱敏边界，区分来源优先级与运行时有效配置。"
tags: [Python, 标准库, IO]
---

# JSON、TOML、环境变量、配置与 Secret

配置是程序输入，不是可以直接信任的常量。读取成功之后，还要知道值来自哪里、是否覆盖默认值、是否符合类型与范围，以及是否可以安全输出。

## 1. 解析与验证分开

JSON 适合交换数据，TOML 适合人工维护配置。`json.loads` 或 `tomllib.loads` 得到数据结构，不证明数据满足应用契约。环境变量则是字符串，`bool("false")` 不会解析成假。

先为每种来源定义优先级，例如默认值 < 文件 < 环境变量 < CLI，再对合并后的完整结果统一校验。不要让每个模块自行读取环境，形成同一个进程里不同版本的“有效配置”。

## 2. 配置合并示例

```python title="io_config.py"
import json
import tomllib

def load_config(environment):
    raw = tomllib.loads('[server]\nport = 8000\n')
    port_text = environment.get("APP_PORT")
    port = raw["server"]["port"] if port_text is None else int(port_text)
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("invalid port")
    return {"port": port}

def main():
    print(json.dumps(load_config({}), sort_keys=True))
    print(json.dumps(load_config({"APP_PORT": "9000"}), sort_keys=True))
    try:
        load_config({"APP_PORT": "0"})
    except ValueError as error:
        print(error)

if __name__ == "__main__":
    main()
```

```text title="io_config.out"
{"port": 8000}
{"port": 9000}
invalid port
```

显式传入环境映射，让测试不必修改整个进程环境。若变量存在却为空，应按契约报错还是视为缺失，必须明确；不要无意间用 `or` 将零、空串全部丢弃。

## 3. 配置中的危险默认

JSON 默认解析对重复键和某些非标准数值的处理，未必满足严格交换协议。安全敏感输入可使用 `object_pairs_hook` 检测重复键，序列化时通过 `allow_nan=False` 拒绝非有限数值。

嵌套字典的“合并”也需要定义：覆盖整段、递归合并还是按字段更新，列表是替换还是追加。动态更新时应先构造并验证新快照，再切换；逐字段原地修改可能让并发读者观察到中间状态。

## 4. Secret 不是普通配置

密码、令牌与私钥不要写进 Git、异常文本、进程参数或完整配置快照。环境变量便于注入，但仍可能被进程、诊断转储和管理权限读取，不是加密存储。

Secret 更新还需要考虑连接池、缓存与已有会话。文件改变不等于应用已经重新加载，更不等于上游凭证已安全轮换。日志只保留来源、版本和必要摘要，避免输出原值。

## 5. 练习与答案

### 5.1 JSON 解析成功，就能直接传给业务吗？

答案：不能。还要检查必需字段、额外字段、类型、范围与权限相关约束。解析只解决格式问题。

### 5.2 配置热更新为什么不逐项修改全局字典？

答案：并发读取可能看到混合的新旧值。应生成完整、校验通过的快照，并按明确机制切换与释放旧资源。

### 5.3 环境变量中的密码能放心写进启动日志吗？

答案：不能。注入方式不改变秘密属性。配置展示与异常输出都应有明确的脱敏策略。

## 6. 参考资料

- [json](https://docs.python.org/3.14/library/json.html)
- [tomllib](https://docs.python.org/3.14/library/tomllib.html)
- [os.environ](https://docs.python.org/3.14/library/os.html#os.environ)
