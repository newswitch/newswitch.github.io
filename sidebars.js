/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: '云原生与 AI 算力',
      collapsed: false,
      items: [
        {
          type: 'category',
          label: 'Kubernetes',
          items: [
            'cloud-native-ai/k8s/K8s学习-PartI-基础架构与核心抽象',
            'cloud-native-ai/k8s/K8s学习-PartI-Pod',
            'cloud-native-ai/k8s/K8s学习-PartI-集群资源管理',
            'cloud-native-ai/k8s/K8s学习-PartI-控制器',
            'cloud-native-ai/k8s/K8s学习-PartI-开放接口',
            'cloud-native-ai/k8s/K8s学习-PartII-平台能力与生产实践',
            'cloud-native-ai/k8s/K8s学习-PartIII-扩展机制与新范式',
          ],
        },
        {
          type: 'category',
          label: 'vLLM',
          items: [
            'cloud-native-ai/vllm/vLLM学习笔记（一）整体代码架构',
            'cloud-native-ai/vllm/vLLM学习笔记（二）vLLM调度前的预处理工作',
            'cloud-native-ai/vllm/vLLM学习笔记（三）vLLM调度器策略',
            'cloud-native-ai/vllm/vLLM学习笔记（四）BlockSpaceManager',
            'cloud-native-ai/vllm/vLLM学习笔记（五）PrefixCachingBlockAllocator',
            'cloud-native-ai/vllm/vLLM学习笔记（六）参数使用',
          ],
        },
        {
          type: 'category',
          label: 'K8s 生态与扩展',
          items: [
            'cloud-native-ai/cloud-native/Gateway-API-Inference-Extension',
            'cloud-native-ai/cloud-native/LeaderWorkerSet插件',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: '网络与硬件',
      collapsed: false,
      items: [
        {
          type: 'category',
          label: '传统组网',
          items: [
            'network-hardware/traditional-networking/传统组网第一阶段-筑基与深耕',
            'network-hardware/traditional-networking/传统组网第二阶段-数据中心与云',
            'network-hardware/traditional-networking/传统组网第三阶段-自动化与智能管控',
          ],
        },
        {
          type: 'category',
          label: 'AI 组网',
          items: [
            'network-hardware/ai-networking/AI组网第一阶段-底层基础',
            'network-hardware/ai-networking/AI组网第二阶段-集群核心组网',
            'network-hardware/ai-networking/AI组网第三阶段-自动化与架构进阶',
          ],
        },
        {
          type: 'category',
          label: 'RDMA',
          items: [
            'network-hardware/rdma/RDMA技术详解（一）：RDMA概述',
            'network-hardware/rdma/RDMA技术详解（二）：RDMA-Send-Receive操作',
            'network-hardware/rdma/RDMA技术详解（三）：理解RDMA-SGL',
          ],
        },
        {
          type: 'category',
          label: 'Linux 高性能网络（读书笔记）',
          items: [
            'network-hardware/linux-hpn/linux高性能网络详解读书笔记（一）',
            'network-hardware/linux-hpn/linux高性能网络详解读书笔记（二）DPDK',
            'network-hardware/linux-hpn/linux高性能网络详解读书笔记（三）RDMA',
          ],
        },
        {
          type: 'category',
          label: 'Nginx 源码',
          items: [
            'network-hardware/nginx/nginx源码解析-基础数据结构（一）',
            'network-hardware/nginx/nginx源码分析-基础数据结构',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: '基础设施与总线',
      collapsed: true,
      items: [
        'infrastructure/pcie/PCIe总线学习（一）基本架构',
        'infrastructure/pcie/PCIe总线学习（二）地址空间',
        'infrastructure/pcie/PCIe总线学习（三）中断机制',
      ],
    },
    {
      type: 'category',
      label: '游戏与客户端',
      collapsed: true,
      items: [
        'game-client/ue5/UE5学习（一）输入系统',
        'game-client/ue5/UE5学习（二）射线检测',
        'game-client/ue5/UE5学习（三）导航系统',
        'game-client/ue5/UE5学习（四）AI系统',
        'game-client/ue5/UE5学习（五）UMG UI系统',
      ],
    },
    {
      type: 'category',
      label: '工程笔记与排障',
      collapsed: false,
      items: [
        {
          type: 'category',
          label: '集群与平台排障',
          items: [
            'engineering/ops/Kubernetes控制平面不稳定问题排查记录',
            'engineering/ops/容器Waiting告警与滚动发布时间线不一致问题复盘',
          ],
        },
        {
          type: 'category',
          label: '系统与网络复盘',
          items: [
            'engineering/ops/深度复盘-UOS-Deepin系统底层依赖死锁抢救全记录',
            'engineering/ops/深度复盘-为什么Ping域名能通浏览器却打不开网页',
          ],
        },
        {
          type: 'category',
          label: '笔记与参考',
          items: [
            'engineering/notes/Prompt-从输入到输出',
            'engineering/notes/Linux 命令手册',
          ],
        },
      ],
    },
  ],
};

export default sidebars;
