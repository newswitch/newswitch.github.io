/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'K8s 学习',
      items: [
        'k8s/K8s学习-PartI-基础架构与核心抽象',
        'k8s/K8s学习-PartI-Pod',
        'k8s/K8s学习-PartI-集群资源管理',
        'k8s/K8s学习-PartI-控制器',
        'k8s/K8s学习-PartI-开放接口',
        'k8s/K8s学习-PartII-平台能力与生产实践',
        'k8s/K8s学习-PartIII-扩展机制与新范式',
      ],
    },
    {
      type: 'category',
      label: 'AI 组网',
      items: [
        'ai-networking/AI组网第一阶段-底层基础',
        'ai-networking/AI组网第二阶段-集群核心组网',
        'ai-networking/AI组网第三阶段-自动化与架构进阶',
      ],
    },
    {
      type: 'category',
      label: '传统组网',
      items: [
        'traditional-networking/传统组网第一阶段-筑基与深耕',
        'traditional-networking/传统组网第二阶段-数据中心与云',
        'traditional-networking/传统组网第三阶段-自动化与智能管控',
      ],
    },
    {
      type: 'category',
      label: 'RDMA',
      items: [
        'rdma/RDMA技术详解（一）：RDMA概述',
        'rdma/RDMA技术详解（二）：RDMA-Send-Receive操作',
        'rdma/RDMA技术详解（三）：理解RDMA-SGL',
      ],
    },
    {
      type: 'category',
      label: 'vLLM',
      items: [
        'vllm/vLLM学习笔记（一）整体代码架构',
        'vllm/vLLM学习笔记（二）vLLM调度前的预处理工作',
        'vllm/vLLM学习笔记（三）vLLM调度器策略',
        'vllm/vLLM学习笔记（四）BlockSpaceManager',
        'vllm/vLLM学习笔记（五）PrefixCachingBlockAllocator',
        'vllm/vLLM学习笔记（六）参数使用',
      ],
    },
    {
      type: 'category',
      label: 'UE5',
      items: [
        'ue5/UE5学习（一）输入系统',
        'ue5/UE5学习（二）射线检测',
        'ue5/UE5学习（三）导航系统',
        'ue5/UE5学习（四）AI系统',
        'ue5/UE5学习（五）UMG UI系统',
      ],
    },
    {
      type: 'category',
      label: 'PCIe',
      items: [
        'pcie/PCIe总线学习（一）基本架构',
        'pcie/PCIe总线学习（二）地址空间',
        'pcie/PCIe总线学习（三）中断机制',
      ],
    },
    {
      type: 'category',
      label: 'Linux 高性能网络读书笔记',
      items: [
        'linux-hpn/linux高性能网络详解读书笔记（一）',
        'linux-hpn/linux高性能网络详解读书笔记（二）DPDK',
        'linux-hpn/linux高性能网络详解读书笔记（三）RDMA',
      ],
    },
    {
      type: 'category',
      label: 'Nginx 源码',
      items: [
        'nginx/nginx源码解析-基础数据结构（一）',
        'nginx/nginx源码分析-基础数据结构',
      ],
    },
    {
      type: 'category',
      label: '云原生扩展',
      items: [
        'cloud-native/Gateway-API-Inference-Extension',
        'cloud-native/LeaderWorkerSet插件',
      ],
    },
    {
      type: 'category',
      label: '运维与复盘',
      items: [
        'ops/Kubernetes控制平面不稳定问题排查记录',
        'ops/容器Waiting告警与滚动发布时间线不一致问题复盘',
        'ops/深度复盘-UOS-Deepin系统底层依赖死锁抢救全记录',
        'ops/深度复盘-为什么Ping域名能通浏览器却打不开网页',
      ],
    },
    {
      type: 'category',
      label: '笔记与参考',
      items: ['notes/Prompt-从输入到输出', 'notes/Linux 命令手册'],
    },
  ],
};

export default sidebars;
