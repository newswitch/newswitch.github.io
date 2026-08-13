import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

import styles from './index.module.css';

const SECTIONS = [
  {
    title: '学习导航',
    desc: '从零认识 AI Infra 全貌，并选择适合自己的模块化学习顺序。',
    to: '/docs/learning/AI-Infra技术模块学习地图',
  },
  {
    title: 'Linux 与操作系统',
    desc: '进程、权限、内核、systemd、容器底层与 Linux 命令参考库。',
    to: '/docs/linux/Linux命令参考库学习路线',
  },
  {
    title: 'GPU 与加速计算',
    desc: 'GPU、显存、PCIe、NUMA、NVLink、CUDA、调度与共享。',
    to: '/docs/gpu/GPU与加速计算学习路线',
  },
  {
    title: '网络',
    desc: 'TCP/IP、路由交换、数据中心、RDMA、RoCE 与 AI Fabric。',
    to: '/docs/networking/网络学习路线',
  },
  {
    title: '存储',
    desc: 'Linux I/O、NVMe、NFS、Ceph、对象存储与 Kubernetes CSI。',
    to: '/docs/storage/存储技术学习路线',
  },
  {
    title: '容器与 Kubernetes',
    desc: '容器底座、Kubernetes 核心、运维、扩展与服务网格。',
    to: '/docs/cloud-native/云原生与平台工程学习路线',
  },
  {
    title: 'AI 训练与推理',
    desc: '分布式训练、vLLM、推理服务、模型制品与 MLOps。',
    to: '/docs/ai-systems/大模型系统学习地图',
  },
  {
    title: '大数据',
    desc: 'Hadoop、Kafka、Spark、Flink、湖仓、OLAP 与数据治理。',
    to: '/docs/data-systems/大数据技术学习地图',
  },
  {
    title: '可观测性与 SRE',
    desc: '指标、日志、追踪、SLO、性能分析、故障响应与复盘。',
    to: '/docs/sre/SRE与生产工程学习路线',
  },
  {
    title: '自动化与 DevOps',
    desc: 'Python、Go、API 客户端、控制器与诊断工具工程。',
    to: '/docs/automation/自动化工程学习路线',
  },
  {
    title: '综合项目',
    desc: '用端到端链路、GPU 集群和异构资源池串联全部基础模块。',
    to: '/docs/projects/综合项目学习地图',
  },
];

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className={styles.heroGlow} aria-hidden />
      <div className={styles.heroInner}>
        <p className={styles.heroEyebrow}>个人技术沉淀</p>
        <h1 className={styles.heroTitle}>{siteConfig.title}</h1>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <div className={styles.heroActions}>
          <Link className={styles.btnPrimary} to="/docs/intro">
            浏览文档
          </Link>
          <Link className={styles.btnGhost} to="/blog">
            博客
          </Link>
          <a
            className={styles.btnGhost}
            href="https://github.com/newswitch/newswitch.github.io"
            target="_blank"
            rel="noreferrer noopener">
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}

function SectionNav() {
  return (
    <section className={styles.section} aria-labelledby="nav-heading">
      <div className={styles.sectionHead}>
        <h2 id="nav-heading" className={styles.sectionTitle}>
          内容导航
        </h2>
        <p className={styles.sectionLead}>
          网站入口与源码目录完全一致；从学习地图进入，也可以直接选择一个技术域。
        </p>
      </div>
      <ul className={styles.cardGrid}>
        {SECTIONS.map((item) => (
          <li key={item.to}>
            <Link className={styles.card} to={item.to}>
              <span className={styles.cardTitle}>{item.title}</span>
              <span className={styles.cardDesc}>{item.desc}</span>
              <span className={styles.cardArrow} aria-hidden>
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description={`${siteConfig.title}：${siteConfig.tagline}。系统学习 AI Infra、Kubernetes GPU 集群、大模型系统与 SRE。`}>
      <HomepageHeader />
      <main className={styles.main}>
        <SectionNav />
      </main>
    </Layout>
  );
}
