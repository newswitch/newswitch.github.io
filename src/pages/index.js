import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

import styles from './index.module.css';

const DOMAINS = [
  {
    id: '00',
    label: 'MAP',
    title: '学习导航',
    note: '技术地图 · 学习顺序 · 知识串联',
    to: '/docs/learning/AI-Infra技术模块学习地图',
    tone: 'violet',
  },
  {
    id: '01',
    label: 'SYSTEM',
    title: 'Linux 与操作系统',
    note: '进程 · 内核 · systemd · 命令参考',
    to: '/docs/linux/Linux命令参考库学习路线',
    tone: 'slate',
  },
  {
    id: '02',
    label: 'COMPUTE',
    title: 'GPU 与加速计算',
    note: 'CUDA · CANN · HBM · NVLink',
    to: '/docs/gpu/GPU与加速计算学习路线',
    tone: 'lime',
  },
  {
    id: '03',
    label: 'FABRIC',
    title: '网络',
    note: 'TCP/IP · BGP · RDMA · RoCE',
    to: '/docs/networking/网络学习路线',
    tone: 'blue',
  },
  {
    id: '04',
    label: 'STORAGE',
    title: '存储',
    note: 'NVMe · NFS · Ceph · CSI',
    to: '/docs/storage/存储技术学习路线',
    tone: 'teal',
  },
  {
    id: '05',
    label: 'CONTROL',
    title: '容器与 Kubernetes',
    note: 'Runtime · Scheduler · Operator · Mesh',
    to: '/docs/cloud-native/云原生与平台工程学习路线',
    tone: 'cyan',
  },
  {
    id: '06',
    label: 'RUNTIME',
    title: 'AI 训练与推理',
    note: 'PyTorch · vLLM · SGLang · MLOps',
    to: '/docs/ai-systems/大模型系统学习地图',
    tone: 'orange',
  },
  {
    id: '07',
    label: 'DATA',
    title: '数据系统',
    note: 'Database · Cache · Queue · OLAP',
    to: '/docs/data-systems/数据系统学习地图',
    tone: 'green',
  },
  {
    id: '08',
    label: 'SIGNALS',
    title: '可观测性与 SRE',
    note: 'Metrics · Logs · Traces · SLO',
    to: '/docs/sre/SRE与生产工程学习路线',
    tone: 'red',
  },
  {
    id: '09',
    label: 'AUTOMATE',
    title: '自动化与 DevOps',
    note: 'Ansible · Python · Go · GitOps',
    to: '/docs/automation/自动化工程学习路线',
    tone: 'amber',
  },
  {
    id: '10',
    label: 'PROJECTS',
    title: '综合项目',
    note: '端到端链路 · GPU 集群 · 异构资源池',
    to: '/docs/projects/综合项目学习地图',
    tone: 'purple',
  },
];

const FIELD_LOGS = [
  {
    code: 'INCIDENT / API',
    state: 'REPLAYED',
    title: 'API Server 间歇性卡顿：从秒级探针到 LIST/WATCH 重连风暴',
    detail: '沿请求、审计、etcd 与客户端行为还原控制面慢请求。',
    to: '/docs/sre/incidents/API-Server间歇性卡顿-从秒级探针到LIST-WATCH重连风暴',
  },
  {
    code: 'INCIDENT / NODE',
    state: 'RUNBOOK',
    title: '三台节点同时 NotReady：从 Lease、PLEG 到 containerd',
    detail: '先区分控制面失联与节点运行时故障，再定位第一处异常。',
    to: '/docs/sre/incidents/三台节点同时NotReady-从Lease-PLEG到containerd运行时故障',
  },
  {
    code: 'INCIDENT / VIP',
    state: 'VERIFIED',
    title: 'Pod 直连正常，但 ClusterIP 为什么偶发超时',
    detail: '检查 conntrack、MTU 与 kube-proxy 转发路径中的静默丢包。',
    to: '/docs/sre/incidents/凌晨一点的那通告警-Pod直连正常但ClusterIP偶发超时',
  },
];

const METHOD = [
  {
    label: 'PATH / 01',
    title: '画出路径',
    text: '先明确请求、数据与控制信号经过哪些组件，再讨论单点技术。',
  },
  {
    label: 'EVIDENCE / 02',
    title: '保留证据',
    text: '把版本、拓扑、指标、日志与命令输出放在同一条时间线上。',
  },
  {
    label: 'RECOVERY / 03',
    title: '完成恢复',
    text: '能部署只是起点；还要知道如何验收、破坏、定位并恢复。',
  },
];

function SectionHeading({code, title, children}) {
  return (
    <div className={styles.sectionHeading}>
      <div>
        <span className={styles.sectionCode}>{code}</span>
        <h2>{title}</h2>
      </div>
      <p>{children}</p>
    </div>
  );
}

function Hero() {
  return (
    <header className={styles.hero}>
      <div className={styles.heroTopline}>
        <span>XYF / INFRA SYSTEMS LAB</span>
        <span className={styles.live}><i /> KNOWLEDGE BASE ONLINE</span>
        <span>DOCS / FIELD NOTES / RUNBOOKS</span>
      </div>
      <div className={styles.colorRail} aria-hidden="true"><i /><i /><i /><i /></div>

      <div className={styles.heroGrid}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>SYSTEMS, EVIDENCE AND RECOVERY</p>
          <h1>
            <span>把复杂系统拆开、</span>
            <span>部署、<em>弄坏</em>，<span className={styles.finalLine}>再恢复。</span></span>
          </h1>
          <p className={styles.heroLead}>
            从 Linux、网络和存储出发，进入 Kubernetes、数据系统与 AI Infra；
            用可复现的实验、运行链路和故障证据理解系统。
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} to="/docs/intro">进入文档系统</Link>
            <Link className={styles.secondaryAction} to="/blog">读取现场记录</Link>
          </div>
        </div>

        <aside className={styles.statusPanel} aria-label="知识库工作方式">
          <div className={styles.panelHeader}><span>SYSTEM DIAGNOSTICS</span><b>XYF-01</b></div>
          <div className={styles.panelFocus}>
            <span>ACTIVE MISSION</span>
            <strong>Understand the whole path</strong>
            <small>request → runtime → hardware → evidence</small>
          </div>
          <dl className={styles.statusList}>
            <div><dt>技术模块</dt><dd><i className={styles.ok} /> MAPPED</dd></div>
            <div><dt>生产实战</dt><dd><i className={styles.test} /> ACTIVE</dd></div>
            <div><dt>故障档案</dt><dd><i className={styles.boundary} /> REPLAYED</dd></div>
          </dl>
          <div className={styles.panelFoot}>BUILD → OBSERVE → BREAK → RECOVER</div>
        </aside>
      </div>
    </header>
  );
}

function SystemMap() {
  return (
    <section className={styles.section} aria-labelledby="system-map-heading">
      <SectionHeading code="MAP / SYSTEM DOMAINS" title="从一个技术域进入完整系统">
        每个入口对应独立技术栈；学习到一定深度后，再沿计算、网络、存储、运行时与控制面串起端到端路径。
      </SectionHeading>
      <div className={styles.domainGrid} id="system-map-heading">
        {DOMAINS.map((domain) => (
          <Link
            key={domain.id}
            className={styles.domainCard}
            data-tone={domain.tone}
            to={domain.to}>
            <span className={styles.domainMeta}><b>{domain.id}</b><i>{domain.label}</i></span>
            <strong>{domain.title}</strong>
            <small>{domain.note}</small>
            <span className={styles.domainArrow} aria-hidden="true">↗</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function FieldLogs() {
  return (
    <section className={styles.section} aria-labelledby="field-log-heading">
      <SectionHeading code="LOG / RECENT INCIDENTS" title="把故障变成可复用的知识">
        不从结论倒推故事。先保存现场，再把现象、假设、证据、恢复动作和验证条件串成完整链路。
      </SectionHeading>
      <div className={styles.logList} id="field-log-heading">
        {FIELD_LOGS.map((item, index) => (
          <Link key={item.to} className={styles.logItem} to={item.to}>
            <span className={styles.logIndex}>{String(index + 1).padStart(2, '0')}</span>
            <span className={styles.logCode}>{item.code}</span>
            <span className={styles.logCopy}><strong>{item.title}</strong><small>{item.detail}</small></span>
            <span className={styles.logState}>{item.state}</span>
            <span className={styles.logArrow} aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Method() {
  return (
    <section className={styles.section} aria-labelledby="method-heading">
      <SectionHeading code="METHOD / WORKFLOW" title="同一种方法，进入不同系统">
        从原理到生产实践保持同一套观察方法，让不同模块最终能够互相解释。
      </SectionHeading>
      <div className={styles.methodGrid} id="method-heading">
        {METHOD.map((item, index) => (
          <article className={styles.methodCard} key={item.label}>
            <span className={styles.methodNumber}>0{index + 1}</span>
            <span className={styles.methodLabel}>{item.label}</span>
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <Layout
      title="XYF"
      description="AI Infra 系统原理、工程实践、性能分析与故障证据">
      <main className={styles.page}>
        <Hero />
        <div className={styles.content}>
          <SystemMap />
          <FieldLogs />
          <Method />
        </div>
      </main>
    </Layout>
  );
}
