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
    title: '基础技术',
    desc: 'GPU、显存、PCIe、NVLink、网络、RDMA、NFS 与 Ceph。',
    to: '/docs/foundations/基础技术学习地图',
  },
  {
    title: '平台工程',
    desc: 'Kubernetes 底座、GPU 设备管理、调度共享与资源治理。',
    to: '/docs/platform/平台工程学习地图',
  },
  {
    title: '大模型系统',
    desc: '分布式训练、vLLM 推理服务与 MLOps 工程体系。',
    to: '/docs/ai-systems/大模型系统学习地图',
  },
  {
    title: '工程能力',
    desc: '可观测性、可靠性、性能分析、自动化与故障复盘。',
    to: '/docs/engineering/工程能力学习地图',
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
