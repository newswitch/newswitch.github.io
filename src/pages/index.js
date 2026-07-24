import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

import styles from './index.module.css';

const SECTIONS = [
  {
    title: '云原生与 AI 算力',
    desc: 'Kubernetes、vLLM、Gateway API 与集群扩展等学习与笔记。',
    to: '/docs/cloud-native-ai/k8s/Kubernetes学习路线',
  },
  {
    title: '网络与硬件',
    desc: '组网、RDMA、高性能网络读书笔记与 Nginx 源码阅读。',
    to: '/docs/network-hardware/traditional-networking/传统组网第一阶段-筑基与深耕',
  },
  {
    title: '基础设施与总线',
    desc: 'PCIe 总线与硬件相关笔记。',
    to: '/docs/infrastructure/pcie/PCIe总线学习（一）基本架构',
  },
  {
    title: '工程笔记与排障',
    desc: '排障复盘、Prompt 与命令参考等短文。',
    to: '/docs/engineering/notes/Prompt-从输入到输出',
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
          文档按主题归档在侧栏；以下为各主线入口，便于快速跳转。
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
      description={`${siteConfig.title}：${siteConfig.tagline}。含云原生、网络、基础设施与工程笔记等。`}>
      <HomepageHeader />
      <main className={styles.main}>
        <SectionNav />
      </main>
    </Layout>
  );
}
