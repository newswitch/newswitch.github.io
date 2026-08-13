---
title: 附录D：双资源池常用命令速查手册
sidebar_label: 附录D · 命令速查
date: 2026-08-07 93:00:00
categories: 云原生
tags: [命令速查, nvidia-smi, npu-smi, kubectl, 故障排查, 附录]
---

# 附录D：双资源池常用命令速查手册

:::info 系列与定位
**所属系列**：《NVIDIA＋昇腾双资源池 AI 推理集群：从 0 到部署、运维与故障排查》  
**用途**：安装验收、日常巡检和故障排查  
**约定**：`<...>` 表示必须替换的占位符，不能原样执行
:::

:::tip 系列约定
资源池 A = **NVIDIA GPU**（vLLM）· 资源池 B = **华为昇腾 NPU**（vLLM-Ascend）· 同一 Kubernetes · 共享存储/网关/监控 · **禁止**跨池组成同一分布式模型实例。
:::

---

## 一、安全等级

| 标记 | 含义 |
|------|------|
| 只读 | 查询状态，不应修改系统 |
| 低风险变更 | 可恢复，但仍需确认目标 |
| 生产变更 | 会影响调度、Pod 或流量，需要审批 |
| 高风险 | 可能中断设备、节点或数据，只能按专项 SOP 执行 |

本附录主要提供**只读**命令。涉及 drain、重启、驱动升级、设备复位、删除 PVC 等操作时，只给出入口说明，不应脱离 SOP 执行。

---

## 二、Linux 主机

### 系统与时间 · 只读

```bash
hostnamectl
uname -a
cat /etc/os-release
timedatectl
date -Ins
uptime
```

### CPU、NUMA 与内存 · 只读

```bash
lscpu
numactl --hardware
free -h
vmstat 1 5
cat /proc/meminfo
```

### 磁盘与文件系统 · 只读

```bash
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS,MODEL,SERIAL
df -hT
df -ih
findmnt
mount | column -t
```

### 进程和资源 · 只读

```bash
ps -eo pid,ppid,user,stat,%cpu,%mem,etime,cmd --sort=-%cpu | head -30
top
pidstat 1 5
```

### 内核和系统日志 · 只读

```bash
dmesg -T | tail -200
journalctl -k --since '-2 hours'
journalctl -u kubelet --since '-1 hour'
```

### OOM · 只读

```bash
dmesg -T | grep -i -E 'out of memory|oom-killer|killed process'
journalctl -k --since '-24 hours' | grep -i -E 'out of memory|oom-killer|killed process'
```

---

## 三、网络

### 地址、路由和邻居 · 只读

```bash
ip -br address
ip -br link
ip route
ip rule
ip neigh
```

### 端口和连接 · 只读

```bash
ss -lntup
ss -s
ss -antp
```

### DNS · 只读

```bash
getent hosts <hostname>
dig <hostname>
resolvectl status
```

### 基础连通性 · 只读

```bash
ping -c 4 <target-ip>
curl -vk --connect-timeout 5 https://<target-host>/health
nc -vz -w 3 <target-ip> <port>
```

### 路径和丢包 · 只读

```bash
traceroute <target-ip>
mtr -rwzc 20 <target-ip>
```

### 网卡信息 · 只读

```bash
ethtool <interface>
ethtool -i <interface>
ethtool -S <interface>
```

### RDMA / IB · 只读

```bash
rdma link show
rdma device show
ibv_devinfo
ibstat
```

命令是否存在取决于节点是否安装相应工具。

---

## 四、containerd 与 CRI

### 版本和状态 · 只读

```bash
containerd --version
runc --version
systemctl status containerd --no-pager
crictl info
```

### 容器与镜像 · 只读

```bash
crictl ps -a
crictl images
crictl pods
```

### 容器日志 · 只读

```bash
crictl logs <container-id>
crictl inspect <container-id>
```

### Runtime 配置 · 只读

```bash
containerd config dump
grep -n 'runtime' /etc/containerd/config.toml
```

不要在事故现场直接覆盖 `config.toml`。先保存当前配置，并查明由人工、配置管理还是 Operator 维护。

---

## 五、Kubernetes 集群

### 上下文与版本 · 只读

```bash
kubectl config current-context
kubectl version
kubectl cluster-info
kubectl get --raw='/readyz?verbose'
```

执行任何生产命令前先确认当前 Context。

### 节点 · 只读

```bash
kubectl get nodes -o wide
kubectl get nodes --show-labels
kubectl describe node <node-name>
kubectl get node <node-name> -o yaml
kubectl get nodes -L accelerator.vendor,resource-pool
kubectl get node <node-name> -o jsonpath='{.status.capacity}{"\n"}'
kubectl get node <node-name> -o jsonpath='{.status.allocatable}{"\n"}'
```

### Pod · 只读

```bash
kubectl get pods -A -o wide
kubectl get pod -n <namespace> <pod-name> -o wide
kubectl describe pod -n <namespace> <pod-name>
kubectl get pod -n <namespace> <pod-name> -o yaml
kubectl logs -n <namespace> <pod-name> --tail=300
kubectl logs -n <namespace> <pod-name> --previous --tail=300
kubectl logs -n <namespace> <pod-name> -c <container-name> --since=1h
```

### Events · 只读

```bash
kubectl get events -A --sort-by=.lastTimestamp
kubectl get events -n <namespace> --field-selector involvedObject.name=<pod-name>
```

Events 有保留期限，事故发生后尽快保存。

### 工作负载 · 只读

```bash
kubectl get deployment,statefulset,daemonset -A
kubectl describe deployment -n <namespace> <deployment-name>
kubectl rollout status deployment/<deployment-name> -n <namespace>
kubectl rollout history deployment/<deployment-name> -n <namespace>
```

### Service 和 Endpoint · 只读

```bash
kubectl get service,endpoints,endpointslice -A
kubectl get endpointslice -n <namespace> -l kubernetes.io/service-name=<service-name>
kubectl describe service -n <namespace> <service-name>
```

### 调度、配额、存储、HPA · 只读

```bash
kubectl get resourcequota,limitrange -A
kubectl get priorityclass
kubectl get pdb -A
kubectl get storageclass
kubectl get pv
kubectl get pvc -A
kubectl describe pvc -n <namespace> <pvc-name>
kubectl get csidriver,csinode
kubectl get hpa -A
kubectl describe hpa -n <namespace> <hpa-name>
kubectl get --raw '/apis/custom.metrics.k8s.io/v1beta1'
```

### 临时端口转发 · 低风险变更

```bash
kubectl port-forward -n <namespace> service/<service-name> 18000:8000
```

端口转发只用于受控诊断，不是生产暴露方式。

### 容器调试 · 生产变更

```bash
kubectl debug -n <namespace> pod/<pod-name> -it --image=<approved-debug-image>
kubectl debug node/<node-name> -it --image=<approved-debug-image>
```

调试 Pod 可能访问主机命名空间和文件系统，需要 RBAC、审计、批准镜像和事后清理。

---

## 六、两类资源池标签检查

### 只读

```bash
kubectl get nodes -l accelerator.vendor=nvidia -L resource-pool
kubectl get nodes -l resource-pool=nvidia-pool -o wide
kubectl get nodes -l accelerator.vendor=ascend -L resource-pool
kubectl get nodes -l resource-pool=ascend-pool -o wide
kubectl get node <node-name> -o jsonpath='{.spec.taints}{"\n"}'
```

### 修改 Label / Taint · 生产变更

```bash
kubectl label node <node-name> accelerator.vendor=nvidia resource-pool=nvidia-pool --overwrite
kubectl taint node <node-name> accelerator=nvidia:NoSchedule --overwrite
# 昇腾节点将 nvidia 替换为 ascend
```

修改前确认节点上已有工作负载及调度影响。

---

## 七、NVIDIA 设备

### 设备与稳定标识 · 只读

```bash
nvidia-smi
nvidia-smi -L
nvidia-smi --query-gpu=index,uuid,pci.bus_id,name,serial,driver_version --format=csv
nvidia-smi --query-gpu=index,uuid,temperature.gpu,power.draw,utilization.gpu,utilization.memory,memory.used,memory.total --format=csv
nvidia-smi dmon
nvidia-smi pmon -c 1
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv
```

### 拓扑与可靠性 · 只读

```bash
nvidia-smi topo -m
nvidia-smi nvlink --status
nvidia-smi -q -d ECC
nvidia-smi -q -d PAGE_RETIREMENT
nvidia-smi -q -d ROW_REMAPPER
dmesg -T | grep -i -E 'NVRM|Xid'
journalctl -k --since '-24 hours' | grep -i -E 'NVRM|Xid'
```

字段支持取决于 GPU 型号。

### Device Plugin / DCGM · 只读

```bash
kubectl get pods -A -o wide | grep nvidia-device-plugin
kubectl logs -n <gpu-operator-namespace> <device-plugin-pod> -c nvidia-device-plugin --tail=300
kubectl get pods -A | grep dcgm-exporter
curl -s http://<dcgm-exporter>:9400/metrics | grep '^DCGM_' | head -50
```

### DCGM 诊断 · 高风险

```bash
dcgmi diag --help
```

主动诊断会占用设备资源，只能在业务排空后的维护窗口按 SOP 运行。

---

## 八、昇腾设备

### 设备与版本 · 只读

```bash
npu-smi info -l
npu-smi info
npu-smi info -t health -i <device-id> -c <chip-id>
npu-smi info -t common -i <device-id>
# 先运行 npu-smi info -h 确认当前产品支持的参数
cat /usr/local/Ascend/driver/version.info
cat /usr/local/Ascend/firmware/version.info
```

安装路径可能不同。

### Device Plugin / Exporter · 只读

```bash
kubectl describe configmap -n kube-system mindx-dl-deviceinfo-<node-name>
kubectl get pods -A -o wide | grep -Ei 'ascend.*device|device.*plugin'
kubectl logs -n <device-plugin-namespace> <device-plugin-pod> --tail=300
kubectl get pods,service -A | grep -i npu-exporter
curl -s http://<npu-exporter>:<metrics-port>/metrics | grep '^npu_' | head -50
```

### HCCN 网络 · 只读

```bash
for i in {0..7}; do hccn_tool -i "${i}" -link -g; done
for i in {0..7}; do hccn_tool -i "${i}" -ip -g; done
for i in {0..7}; do hccn_tool -i "${i}" -net_health -g; done
for i in {0..7}; do hccn_tool -i "${i}" -tls -g | grep switch; done
for i in {0..7}; do hccn_tool -i "${i}" -fec -g; done
for i in {0..7}; do hccn_tool -i "${i}" -optical -g; done
hccn_tool -i <source-device-id> -ping -g address <target-device-ip>
```

Device 间 Ping 正向和反向都要测。

---

## 九、vLLM 与模型服务

```bash
curl -fsS http://<service>:8000/health
curl -sS http://<service>:8000/v1/models

curl -sS http://<service>:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model":"company-model-a",
    "messages":[{"role":"user","content":"只回答OK"}],
    "temperature":0,
    "max_tokens":8
  }'

curl -N http://<service>:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model":"company-model-a",
    "messages":[{"role":"user","content":"用三句话介绍Kubernetes"}],
    "stream":true,
    "max_tokens":100
  }'

curl -s http://<service>:8000/metrics | grep '^vllm:' | head -100
```

容器内框架版本 · 只读：

```bash
# NVIDIA
python -c 'import torch,vllm; print(torch.__version__, torch.version.cuda, vllm.__version__, torch.cuda.is_available())'

# 昇腾
python -c 'import torch,torch_npu,vllm; print(torch.__version__, torch_npu.__version__, vllm.__version__, torch.npu.is_available())'
```

---

## 十、网关与 HTTP

```bash
openssl s_client -connect <host>:443 -servername <host> </dev/null
openssl s_client -connect <host>:443 -servername <host> </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates

curl -i https://<host>/v1/models -H 'Authorization: Bearer <test-key>'

curl -Nsv https://<host>/v1/chat/completions \
  -H 'Authorization: Bearer <test-key>' \
  -H 'Content-Type: application/json' \
  -d @<sanitized-request-file>

kubectl get gateway -A
kubectl get httproute -A
kubectl describe httproute -n <namespace> <route-name>
```

真实 Key 不要进入共享终端记录和工单。Gateway API 重点查看 `Accepted` 和 `ResolvedRefs`。

---

## 十一、Prometheus 与告警

```bash
curl -s http://<prometheus>:9090/api/v1/targets
curl -s http://<prometheus>:9090/api/v1/rules
curl -G http://<prometheus>:9090/api/v1/query \
  --data-urlencode 'query=up == 0'
kubectl get --raw '/apis/custom.metrics.k8s.io/v1beta1'
promtool check rules <rules-file>
promtool test rules <test-file>
curl -s http://<alertmanager>:9093/api/v2/status
curl -s http://<alertmanager>:9093/api/v2/alerts
```

---

## 十二、NFS、Ceph 与模型文件

```bash
showmount -e <nfs-server>
nfsstat -m
findmnt -t nfs,nfs4

ceph -s
ceph health detail
ceph osd tree
ceph df
ceph fs status

du -sh <model-path>
find <model-path> -maxdepth 2 -type f -printf '%P %s\n' | sort
sha256sum -c <checksums-file>
```

Ceph 命令需要受控只读权限。对超大权重全量 Checksum 会产生 I/O，应在发布流程和合适窗口执行。

---

## 十三、故障现场最小命令集

```bash
# 业务
kubectl get deployment,pod,svc,endpointslice -n ai-serving -o wide
kubectl get events -n ai-serving --sort-by=.lastTimestamp

# 问题 Pod
kubectl describe pod -n <namespace> <pod-name>
kubectl logs -n <namespace> <pod-name> --tail=500
kubectl logs -n <namespace> <pod-name> --previous --tail=500

# 问题节点
kubectl describe node <node-name>
kubectl get pods -A -o wide --field-selector spec.nodeName=<node-name>
journalctl -u kubelet --since '-2 hours'
journalctl -k --since '-2 hours'

# NVIDIA
nvidia-smi -q
nvidia-smi topo -m
dmesg -T | grep -i -E 'NVRM|Xid'

# 昇腾
npu-smi info
kubectl describe configmap -n kube-system mindx-dl-deviceinfo-<node-name>
for i in {0..7}; do hccn_tool -i "${i}" -link -g; done
```

---

## 十四、生产变更入口

下列命令不是速查后直接执行的命令，只用于识别对应 SOP 入口：

| 操作 | 风险 | 必须先做 |
|------|------|----------|
| `kubectl cordon` | 停止新调度 | 确认节点和容量 |
| `kubectl drain` | 驱逐 Pod | 检查 PDB、emptyDir 和完整设备组 |
| `kubectl rollout undo` | 回滚工作负载 | 确认模型和网关配置是否同步回滚 |
| 驱动 / 固件升级 | 节点与设备中断 | 切流、排空、Canary、回退包 |
| GPU / NPU Reset | 终止设备任务 | 无进程、维护审批、拓扑影响评估 |
| MIG / vNPU 变更 | 资源重建 | 排空物理设备和更新资源名 |
| 删除 PVC / PV | 数据风险 | 精确目标、备份、回收策略 |
| 修改网关权重 | 流量变化 | 备用容量、监控、回滚 |

---

## 十五、使用原则

1. 先确认 Kubernetes Context 和目标节点。  
2. 只读命令也可能输出敏感信息，日志要脱敏。  
3. 命令失败本身是证据，不要静默忽略。  
4. 先保存现场，再执行重启或回滚。  
5. 设备索引不是稳定身份，NVIDIA 优先记录 UUID。  
6. 昇腾命令参数按目标产品帮助和文档确认。  
7. 多机通信先找最早失败 Rank，再检查网络。  
8. 任何高风险命令都必须回到对应 SOP，而不是依赖速查表。  

---

## 相关链接

- [专栏目录](./00-专栏目录.md)
- [附录 C：资产盘点模板](./附录C-服务器资产清单模板.md)
- [附录 E：双资源池 Kubernetes YAML 模板库](./附录E-双资源池Kubernetes-YAML模板库.md)
- [第 29 篇：NVIDIA 池专项运维](./29-NVIDIA资源池日常运维与故障排查.md)
- [第 30 篇：昇腾池专项运维](./30-昇腾资源池日常运维与故障排查.md)

---

← [附录 C](./附录C-服务器资产清单模板.md) · → [附录 E：YAML 模板库](./附录E-双资源池Kubernetes-YAML模板库.md)
