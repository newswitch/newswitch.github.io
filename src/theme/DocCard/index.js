import React from 'react';
import isInternalUrl from '@docusaurus/isInternalUrl';
import {
  findFirstSidebarItemLink,
  useDocById,
} from '@docusaurus/plugin-content-docs/client';
import {useDocCardDescriptionCategoryItemsPlural} from '@docusaurus/theme-common/internal';
import Layout from '@theme/DocCard/Layout';
import {
  siApacheflink,
  siApachehadoop,
  siApachekafka,
  siApacherocketmq,
  siApachespark,
  siAnsible,
  siCeph,
  siClickhouse,
  siDocker,
  siElasticsearch,
  siEnvoyproxy,
  siEtcd,
  siGrafana,
  siKubernetes,
  siLinux,
  siMilvus,
  siMysql,
  siNginx,
  siNvidia,
  siPostgresql,
  siPrometheus,
  siPytorch,
  siRedis,
  siTerraform,
  siTrino,
  siVllm,
} from 'simple-icons';

const BRAND_RULES = [
  [/^Redis$/i, siRedis],
  [/^MySQL$/i, siMysql],
  [/^PostgreSQL$/i, siPostgresql],
  [/^Kafka$/i, siApachekafka],
  [/^RocketMQ$/i, siApacherocketmq],
  [/^Elasticsearch$/i, siElasticsearch],
  [/^Milvus$/i, siMilvus],
  [/^ClickHouse$/i, siClickhouse],
  [/^Trino(?:\s|$)/i, siTrino],
  [/^Flink$/i, siApacheflink],
  [/^Spark$/i, siApachespark],
  [/^Hadoop/i, siApachehadoop],
  [/^etcd$/i, siEtcd],
  [/^Nginx$/i, siNginx],
  [/^Envoy$/i, siEnvoyproxy],
  [/^Ceph$|认识 Ceph|核心原理|Ceph 接口/i, siCeph],
  [/^vLLM(?:$|-)/i, siVllm],
  [/^Kubernetes$|^K8s\b|Kubernetes (?:架构|网络|存储|推理服务|GPU)/i, siKubernetes],
  [/容器与运行时|驱动与容器运行时/i, siDocker],
  [/^Linux$|Linux I\/O|Linux 高性能网络/i, siLinux],
  [/NVIDIA/i, siNvidia],
  [/训练系统与通信|PyTorch/i, siPytorch],
  [/Prometheus/i, siPrometheus],
  [/Grafana/i, siGrafana],
  [/Terraform/i, siTerraform],
  [/Ansible/i, siAnsible],
];

const BADGE_RULES = [
  [/^Nacos$/i, ['N', '#2f7ded']],
  [/^Higress$/i, ['H', '#00a98f']],
  [/^MindIE$/i, ['M', '#c7000b']],
  [/^SGLang$/i, ['SG', '#f97316']],
  [/vLLM-Ascend/i, ['VA', '#c7000b']],
  [/^NFS$|NFS/i, ['NFS', '#2563eb']],
  [/对象存储与 S3|\bS3\b/i, ['S3', '#e05243']],
  [/RDMA|RoCE|InfiniBand/i, ['RD', '#2563eb']],
  [/CUDA/i, ['CUDA', '#76b900']],
  [/NVLink|NVSwitch/i, ['NV', '#76b900']],
  [/GPU|显存|HBM|加速器/i, ['GPU', '#76b900']],
  [/MLOps/i, ['ML', '#7c3aed']],
  [/AI Fabric/i, ['AI', '#0f766e']],
];

function cleanTitle(label) {
  return label.replace(/^\d{2}\.\s+/, '').trim();
}

function BrandIcon({icon}) {
  const red = Number.parseInt(icon.hex.slice(0, 2), 16);
  const green = Number.parseInt(icon.hex.slice(2, 4), 16);
  const blue = Number.parseInt(icon.hex.slice(4, 6), 16);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const monochrome = luminance < 64;
  return (
    <span
      className="tech-doc-card-icon tech-doc-card-icon--brand"
      data-monochrome={monochrome ? 'true' : undefined}
      style={{'--tech-icon-color': `#${icon.hex}`}}
      aria-hidden="true">
      <svg role="img" viewBox="0 0 24 24">
        <path d={icon.path} fill="currentColor" />
      </svg>
    </span>
  );
}

function BadgeIcon({text, color}) {
  return (
    <span
      className="tech-doc-card-icon tech-doc-card-icon--badge"
      style={{'--tech-icon-color': color}}
      aria-hidden="true">
      {text}
    </span>
  );
}

function SemanticIcon({type}) {
  let shape;
  switch (type) {
    case 'database':
      shape = <><ellipse cx="12" cy="5" rx="7.5" ry="3" /><path d="M4.5 5v6c0 1.65 3.36 3 7.5 3s7.5-1.35 7.5-3V5M4.5 11v6c0 1.65 3.36 3 7.5 3s7.5-1.35 7.5-3v-6" /></>;
      break;
    case 'network':
      shape = <><circle cx="12" cy="5" r="2.4" /><circle cx="5" cy="18" r="2.4" /><circle cx="19" cy="18" r="2.4" /><path d="m10.7 7-4.4 8.8M13.3 7l4.4 8.8M7.4 18h9.2" /></>;
      break;
    case 'storage':
      shape = <><rect x="3.5" y="4" width="17" height="6" rx="2" /><rect x="3.5" y="14" width="17" height="6" rx="2" /><path d="M7 7h.01M7 17h.01M10 7h7M10 17h7" /></>;
      break;
    case 'terminal':
      shape = <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 16h4" /></>;
      break;
    case 'document':
      shape = <><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h4M9 12h6M9 16h6" /></>;
      break;
    case 'security':
      shape = <><path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></>;
      break;
    case 'performance':
      shape = <><path d="M4 17a8 8 0 1 1 16 0" /><path d="m12 13 4-4M7 17h10" /></>;
      break;
    case 'observability':
      shape = <><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" /><circle cx="12" cy="12" r="2.7" /></>;
      break;
    case 'deployment':
      shape = <><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></>;
      break;
    case 'incident':
      shape = <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5M12 17h.01" /></>;
      break;
    case 'ai':
      shape = <><rect x="6" y="6" width="12" height="12" rx="3" /><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M18 9h3M3 15h3M18 15h3M9.5 13.5c1.6 1.4 3.4 1.4 5 0M10 10h.01M14 10h.01" /></>;
      break;
    default:
      shape = <><path d="M3 7.5h7l2 2h9v9.5H3V7.5Z" /><path d="M3 7.5V5h7l2 2.5" /></>;
  }

  return (
    <span className="tech-doc-card-icon tech-doc-card-icon--semantic" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {shape}
      </svg>
    </span>
  );
}

function semanticType(title) {
  if (/数据库|缓存|数据湖|数据工程|数据制品|Schema|InnoDB|索引|复制|备份/.test(title)) return 'database';
  if (/网络|路由|交换|Fabric|CNI|服务发现|负载均衡|代理/.test(title)) return 'network';
  if (/存储|I\/O|NVMe|CSI|Volume/.test(title)) return 'storage';
  if (/命令|Shell|终端|调试/.test(title)) return 'terminal';
  if (/安全|身份|权限|审计/.test(title)) return 'security';
  if (/性能|容量|成本|优化/.test(title)) return 'performance';
  if (/观测|监控|指标|日志/.test(title)) return 'observability';
  if (/部署|运维|运行时|交付|集群|控制器|调度|扩展/.test(title)) return 'deployment';
  if (/故障|排查|复盘|事故/.test(title)) return 'incident';
  if (/AI|模型|推理|训练|向量|GPU/.test(title)) return 'ai';
  return 'folder';
}

function getCategoryIcon(title) {
  const brand = BRAND_RULES.find(([pattern]) => pattern.test(title));
  if (brand) return <BrandIcon icon={brand[1]} />;
  const badge = BADGE_RULES.find(([pattern]) => pattern.test(title));
  if (badge) return <BadgeIcon text={badge[1][0]} color={badge[1][1]} />;
  return <SemanticIcon type={semanticType(title)} />;
}

function DocumentIcon({external}) {
  return <SemanticIcon type={external ? 'network' : 'document'} />;
}

function CardCategory({item}) {
  const href = findFirstSidebarItemLink(item);
  const categoryItemsPlural = useDocCardDescriptionCategoryItemsPlural();
  if (!href) return null;
  const title = cleanTitle(item.label);
  return (
    <Layout
      item={item}
      className={item.className}
      href={href}
      icon={getCategoryIcon(title)}
      title={item.label}
      description={item.description ?? categoryItemsPlural(item.items.length)}
    />
  );
}

function CardLink({item}) {
  const doc = useDocById(item.docId ?? undefined);
  return (
    <Layout
      item={item}
      className={item.className}
      href={item.href}
      icon={<DocumentIcon external={!isInternalUrl(item.href)} />}
      title={item.label}
      description={item.description ?? doc?.description}
    />
  );
}

export default function DocCard({item}) {
  switch (item.type) {
    case 'link':
      return <CardLink item={item} />;
    case 'category':
      return <CardCategory item={item} />;
    default:
      throw new Error(`unknown item type ${JSON.stringify(item)}`);
  }
}
