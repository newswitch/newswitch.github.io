---
title: "Tokenizer、Chat Template 与工具调用链路"
sidebar_label: "02. Tokenizer、模板与工具调用"
sidebar_position: 2
description: "从messages JSON到最终Token，解释Chat Template、特殊Token、Reasoning Parser与Tool Call Parser的职责边界。"
tags: [Tokenizer, Chat Template, Tool Calling, Reasoning Parser, LLM]
---

# Tokenizer、Chat Template 与工具调用链路

聊天模型最终接收的不是`messages`数组，而是一串Token ID。OpenAI兼容请求需要经过：

```text
messages / tools / documents
→ 请求Schema校验
→ Chat Template渲染文本和控制Token
→ Tokenizer编码
→ 模型生成Token ID
→ Detokenizer恢复文本
→ Reasoning Parser拆分思考内容
→ Tool Call Parser提取函数名与参数
→ OpenAI兼容响应
```

模板、Tokenizer和Parser属于同一个接口契约。只升级模型权重、不固定它们，可能让模型“能生成但不会正确说话”。

## 1. Tokenizer做什么

Tokenizer维护：

- 文本规范化；
- 子词切分算法和词表；
- Token字符串与整数ID映射；
- BOS、EOS、PAD、UNK及模型专属特殊Token；
- 编码、解码和Offset；
- 最大长度和Padding/Truncation约定。

同一段文本在不同Tokenizer Revision下可能得到不同Token ID，直接改变成本、上下文长度、Cache命中和模型语义。

## 2. Chat Template做什么

Chat Template通常是Jinja模板，把结构化消息转换为模型训练时使用的格式：

```json
{
  "messages": [
    {"role": "system", "content": "你是运维助手"},
    {"role": "user", "content": "解释HCCL"}
  ]
}
```

可能渲染为：

```text
<|system|>你是运维助手<|end|>
<|user|>解释HCCL<|end|>
<|assistant|>
```

模型在训练中学到的是这些控制Token和边界。模板用错可能导致：

- 角色混乱；
- 不停止或过早EOS；
- 工具调用失效；
- 多轮上下文理解下降；
- 输出重复模板标记；
- Token数量和Prefix Cache命中变化。

## 3. `add_generation_prompt`

它通常在末尾加入“现在轮到assistant生成”的控制标记。缺少它时，模型可能把最后一条用户消息当作未完成内容继续写；错误重复加入则可能出现多余角色Token。

并非所有模板使用相同变量语义，必须查看目标Tokenizer模板。

## 4. Tools怎样进入Prompt

OpenAI请求中的`tools`通常先通过模板转成模型可理解的函数定义：

```text
工具名称
参数JSON Schema
描述
调用格式约束
```

这意味着：

- API接受`tools`不代表模板会使用它；
- 模板支持工具不代表模型经过工具调用训练；
- 模型会调用不代表Parser能识别输出格式；
- Parser识别成功不代表业务应直接执行该工具。

真正执行工具前仍需鉴权、参数校验、超时、幂等和审计。

## 5. Reasoning Parser的边界

推理模型可能在输出中区分思考内容与最终答案。Reasoning Parser负责根据模型协议拆分：

```text
原始生成Token/文本
→ reasoning_content
→ final content
```

它不负责提升推理能力，也不改变模型内部计算。Parser选错会导致思考标记泄漏、正文被截断或流式Chunk状态错误。

## 6. Tool Call Parser的边界

Tool Call Parser把模型生成格式转换成结构化响应：

```json
{
  "tool_calls": [{
    "function": {
      "name": "query_npu",
      "arguments": "{\"node\":\"worker-01\"}"
    }
  }]
}
```

流式场景更复杂：函数名和JSON参数可能跨多个Chunk到达，Parser必须维护增量状态并在结束时形成合法结构。

## 7. 重复特殊Token

常见错误：

```text
apply_chat_template(tokenize=False)
→ 再调用Tokenizer且add_special_tokens=True
→ BOS/EOS被重复添加
```

若模板已经显式包含需要的特殊Token，后续编码通常不应再次自动插入。验证方法是同时打印渲染文本、Token字符串和Token ID。

## 8. Prefix Cache为什么受模板影响

Prefix Cache匹配最终Token序列：

```text
System Prompt文本相同
但模板空格/Tool顺序/日期字段不同
→ Token不同
→ 前缀无法命中
```

因此动态日期、随机ID和无序JSON若放在公共前缀前部，会显著降低缓存复用。

## 9. 调试脚本

```python
from transformers import AutoTokenizer

path = "/models/qwen"
tok = AutoTokenizer.from_pretrained(path, trust_remote_code=False)
messages = [{"role": "user", "content": "解释 HCCL"}]

rendered = tok.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True,
)
ids = tok.apply_chat_template(
    messages,
    tokenize=True,
    add_generation_prompt=True,
)

print(rendered)
print(ids)
print(tok.convert_ids_to_tokens(ids))
```

生产排障还应记录Transformers版本、Tokenizer Revision和模板摘要。

## 10. 契约测试

| 场景 | 验证 |
| --- | --- |
| 单轮聊天 | 角色和结束标记 |
| 多轮聊天 | 历史顺序和上下文 |
| 无System | 默认System行为 |
| 工具调用 | 名称、参数、流式Chunk |
| 不调用工具 | 普通文本不被误判 |
| 思考开/关 | reasoning与正文拆分 |
| Stop | EOS、Stop Token、Stop String |
| 长上下文 | 截断发生在哪一侧 |
| 非ASCII/中文 | 编解码和Token计数 |

## 11. 发布清单

```text
[ ] 模型和Tokenizer Revision固定
[ ] chat_template.jinja或配置摘要固定
[ ] 特殊Token ID清单固定
[ ] Parser名称和版本固定
[ ] 服务端与离线渲染Token一致
[ ] 工具Schema和流式调用通过契约测试
[ ] 模板变化进入模型发布门禁
[ ] Prefix Cache命中变化已评估
```

## 12. 官方资料

- [Hugging Face Chat Templates](https://huggingface.co/docs/transformers/chat_templating)
- [Writing a Chat Template](https://huggingface.co/docs/transformers/chat_templating_writing)
- [Tokenizer API](https://huggingface.co/docs/transformers/main_classes/tokenizer)
