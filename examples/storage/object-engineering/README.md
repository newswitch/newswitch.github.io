# 对象访问与事件逻辑示例

`sdk_read.py` 的CLI会真实读取指定对象，需独立Boto3环境、批准的身份、可信Endpoint和Manifest。它分块读取、验证响应长度/版本/正文SHA-256，在受控同文件系统目录中用硬链接拒绝覆盖式发布。父目录必须已存在且可信，文件系统必须支持硬链接；不提供跨平台对象挂载发布协议、断点续传、硬截止时间或目录崩溃一致性保证。密钥不进入源码或参数。校验失败不产生最终文件，发布后的异常仍需按实际文件状态核对。

`event_order.py` 是纯原生AWS S3创建/删除消息适配器，限制每批1000记录、Sequencer最多128个十六进制字符作为本示例输入保护，不是协议上限；不支持SNS/SQS信封、MinIO消息或其他事件类型。它只演示解码、事件身份与同Key比较，不实现持久去重、队列确认、Inbox/Outbox或exactly-once。

从仓库根目录运行 `python -B -m unittest discover -s examples/storage/object-engineering -p test_object_engineering.py`，执行23项标准库离线测试。下载测试使用内存替身和私有临时文件，不导入Boto3、不读取真实凭证、不联系云服务。事件测试不创建队列、不发送或确认消息。`requirements.txt`只固定真实CLI的直接SDK依赖，不是完整依赖锁。
