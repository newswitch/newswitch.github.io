import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

import styles from './styles.module.css';

const SYSTEMS = [
  {
    id: '01',
    label: 'COMPUTE',
    title: 'GPU 与加速计算',
    note: 'CUDA · CANN · HBM · NVLink',
    to: '/docs/gpu/GPU与加速计算学习路线',
    className: styles.compute,
  },
  {
    id: '02',
    label: 'FABRIC',
    title: '网络与 AI Fabric',
    note: 'RDMA · RoCE · NCCL · HCCL',
    to: '/docs/networking/网络学习路线',
    className: styles.fabric,
  },
  {
    id: '03',
    label: 'DATA',
    title: '存储与数据系统',
    note: 'NVMe · Ceph · CSI · Object Store',
    to: '/docs/storage/存储技术学习路线',
    className: styles.data,
  },
  {
    id: '04',
    label: 'CONTROL',
    title: 'Kubernetes 控制面',
    note: 'Scheduler · Operator · Runtime',
    to: '/docs/cloud-native/云原生与平台工程学习路线',
    className: styles.control,
  },
  {
    id: '05',
    label: 'RUNTIME',
    title: 'Ray 与模型运行时',
    note: 'Ray · vLLM · Serve · Train',
    to: '/docs/ai-systems/大模型系统学习地图',
    className: styles.runtime,
  },
  {
    id: '06',
    label: 'SIGNALS',
    title: 'SRE 与可观测性',
    note: 'Metrics · Logs · Traces · SLO',
    to: '/docs/sre/SRE与生产工程学习路线',
    className: styles.signals,
  },
];

const FIELD_LOGS = [
  {
    code: 'FIELD-037',
    state: 'BOUNDARY',
    title: 'NVIDIA 与昇腾双资源池：Ray 能统一什么？',
    detail: '统一任务入口和逻辑资源，但不把 CUDA/NCCL 与 CANN/HCCL 混成一个执行组。',
    to: '/docs/ai-systems/runtime/ray/projects/NVIDIA与昇腾双资源池Ray部署边界',
  },
  {
    code: 'FIELD-036',
    state: 'VERIFIED',
    title: 'KubeRay + vLLM 多机推理路径',
    detail: '从 RayService、Placement Group 到两节点八卡 TP/PP 的完整验收链路。',
    to: '/docs/ai-systems/runtime/ray/projects/KubeRay加vLLM多机推理完整实战',
  },
  {
    code: 'FIELD-032',
    state: 'RUNBOOK',
    title: '节点掉线后，先救业务还是先重启？',
    detail: '保存现场、限制错误扩散，再沿 Node、Task、Actor 和对象依赖寻找第一个失败点。',
    to: '/docs/ai-systems/runtime/ray/operations/节点掉线Task失败与Actor异常Runbook',
  },
];

const MARKS = [
  {
    label: 'XYF / DECISION',
    title: '我的判断',
    text: '记录方案为何被选择，也记录那些看似可用但不适合生产的路径。',
  },
  {
    label: 'XYF / EVIDENCE',
    title: '现场证据',
    text: '命令、版本、资源快照和失败状态一起保存，不用结论替代证据。',
  },
  {
    label: 'XYF / REPLAY',
    title: '如果重来',
    text: '把事故后的认识重新写回部署顺序、验收清单和下一次实验。',
  },
];

function Crosshair() {
  return <span className={styles.crosshair} aria-hidden="true" />;
}

function SystemMap() {
  return (
    <section className={styles.mapSection} aria-labelledby="system-map-heading">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.sectionCode}>MAP / 01</span>
          <h2 id="system-map-heading">系统不是目录，它是一条运行链路</h2>
        </div>
        <p>从请求入口一路追到设备、网络、数据与信号。点击任一节点进入对应学习路径。</p>
      </div>

      <div className={styles.systemMap}>
        <div className={styles.mapGrid} aria-hidden="true" />
        <div className={styles.axisX} aria-hidden="true" />
        <div className={styles.axisY} aria-hidden="true" />

        <div className={styles.mapCore}>
          <span>XYF CONTROL PLANE</span>
          <strong>AI INFRA</strong>
          <small>request → runtime → hardware → evidence</small>
        </div>

        {SYSTEMS.map((system) => (
          <Link
            key={system.id}
            className={`${styles.systemNode} ${system.className}`}
            to={system.to}>
            <span className={styles.nodeMeta}>
              <b>{system.id}</b>
              <i>{system.label}</i>
            </span>
            <strong>{system.title}</strong>
            <small>{system.note}</small>
          </Link>
        ))}
      </div>
    </section>
  );
}

function FieldLogs() {
  return (
    <section className={styles.logSection} aria-labelledby="field-log-heading">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.sectionCode}>LOG / LATEST</span>
          <h2 id="field-log-heading">最近的基础设施现场</h2>
        </div>
        <Link className={styles.textLink} to="/docs/ai-systems/runtime/ray/Ray学习路线">
          查看 Ray 学习路线 <span aria-hidden="true">↗</span>
        </Link>
      </div>

      <div className={styles.logList}>
        {FIELD_LOGS.map((item, index) => (
          <Link key={item.code} className={styles.logItem} to={item.to}>
            <span className={styles.logIndex}>{String(index + 1).padStart(2, '0')}</span>
            <span className={styles.logCode}>{item.code}</span>
            <span className={styles.logCopy}>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
            <span className={styles.logState}>{item.state}</span>
            <span className={styles.logArrow} aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function PersonalMarks() {
  return (
    <section className={styles.marksSection} aria-labelledby="marks-heading">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.sectionCode}>NOTES / AUTHOR</span>
          <h2 id="marks-heading">文档里留下人的判断</h2>
        </div>
        <p>不仅写“怎么做”，也写为什么、哪里失败，以及下一次会改变什么。</p>
      </div>

      <div className={styles.marksGrid}>
        {MARKS.map((mark, index) => (
          <article className={styles.mark} key={mark.label}>
            <span className={styles.markNumber}>0{index + 1}</span>
            <span className={styles.markLabel}>{mark.label}</span>
            <h3>{mark.title}</h3>
            <p>{mark.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function LabPreview() {
  return (
    <Layout
      title="实验场预览"
      description="XYF 基础设施现场：系统地图、实验记录、技术判断与故障档案的视觉预览。">
      <main className={`${styles.page} lab-preview-page`}>
        <header className={styles.hero}>
          <Crosshair />
          <div className={styles.heroTopline}>
            <span>XYF / MOBILE SUIT INFRA LAB</span>
            <span className={styles.live}><i /> SYSTEM ONLINE</span>
            <span>RX-78 COLOR STUDY / 01</span>
          </div>
          <div className={styles.colorRail} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>

          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>TACTICAL INFRA CONSOLE · 预览提案 02</p>
              <h1>把复杂系统拆开、部署、<em>弄坏</em>，再恢复。</h1>
              <p className={styles.heroLead}>
                这里记录的不只是正确答案，还有版本、拓扑、失败状态和做出技术判断时留下的证据。
              </p>
              <div className={styles.heroActions}>
                <a className={styles.primaryAction} href="#system-map-heading">进入系统地图</a>
                <a className={styles.secondaryAction} href="#field-log-heading">读取现场日志</a>
              </div>
            </div>

            <aside className={styles.statusPanel} aria-label="当前研究状态">
              <div className={styles.panelHeader}>
                <span>SYSTEM DIAGNOSTICS</span>
                <b>2026.08</b>
              </div>
              <div className={styles.panelFocus}>
                <span>ACTIVE MISSION</span>
                <strong>Distributed AI Runtime</strong>
                <small>Ray · KubeRay · vLLM · Multi-node</small>
              </div>
              <dl className={styles.statusList}>
                <div>
                  <dt>Ray 学习路线</dt>
                  <dd><i className={styles.ok} /> 38 NOTES</dd>
                </div>
                <div>
                  <dt>多机推理</dt>
                  <dd><i className={styles.test} /> FIELD TEST</dd>
                </div>
                <div>
                  <dt>双资源池</dt>
                  <dd><i className={styles.boundary} /> BOUNDARY</dd>
                </div>
              </dl>
              <div className={styles.panelFoot}>UNIT XYF-01 / LAST REVISION 2075995</div>
            </aside>
          </div>
        </header>

        <div className={styles.content}>
          <SystemMap />
          <FieldLogs />
          <PersonalMarks />

          <aside className={styles.previewNotice}>
            <span>ISOLATED PREVIEW</span>
            <p>这是一个独立预览页。当前首页、文档结构和博客均未改变。</p>
            <Link to="/">返回原首页 →</Link>
          </aside>
        </div>
      </main>
    </Layout>
  );
}
