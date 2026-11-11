// Shared domain metadata. Article hierarchy is always generated from docs/.
const definitions = [
  ['learning','MAP','学习导航','技术地图 · 学习顺序 · 知识串联','learning/00-AI-Infra技术模块学习地图.md','violet','learning'],
  ['linux','SYSTEM','Linux 与操作系统','系统原理 · 内核 · systemd · 命令参考','linux/00-Linux学习地图.md','slate','linux'],
  ['hardware','HARDWARE','服务器硬件','CPU · DIMM · PCIe · BMC','hardware/00-服务器硬件学习路线.md','cyan','hardware'],
  ['gpu','COMPUTE','GPU、NPU 与加速计算','CUDA · CANN · HBM · NVLink','gpu/00-GPU与加速计算学习路线.md','lime','gpu'],
  ['networking','FABRIC','网络','TCP/IP · BGP · RDMA · RoCE','networking/00-网络学习路线.md','blue','network'],
  ['storage','STORAGE','存储','NVMe · NFS · Ceph · CSI','storage/00-存储技术学习路线.md','teal','storage'],
  ['cloud-native','CONTROL','云原生与平台工程','容器 · Kubernetes · 服务发现 · 服务网格','cloud-native/00-云原生与平台工程学习路线.md','cyan','kubernetes'],
  ['ai-systems','RUNTIME','AI 训练、推理与 MLOps','PyTorch · vLLM · SGLang · MLOps','ai-systems/00-大模型系统学习地图.md','orange','ai'],
  ['data-systems','DATA','数据系统','数据库 · 缓存 · 消息 · 搜索 · 大数据','data-systems/00-数据系统学习地图.md','green','data'],
  ['development','DEVELOP','软件开发','Java · Python · Go · Spring Boot · FastAPI · Gin','development/00-软件开发学习路线.md','violet','development'],
  ['sre','SIGNALS','可观测性、性能与 SRE','指标 · 日志 · 追踪 · 性能 · 可靠性','sre/00-SRE与生产工程学习路线.md','red','sre'],
  ['automation','AUTOMATE','自动化与 DevOps','Ansible · Terraform · CI/CD · 自动化开发','automation/00-自动化工程学习路线.md','amber','automation'],
  ['projects','PROJECTS','综合项目','端到端链路 · GPU 集群 · 异构资源池','projects/00-综合项目学习地图.md','purple','projects'],
  ['personal-projects','WORKS','个人作品','独立应用 · 设计与实现','personal-projects/00-个人作品索引.md','violet','projects'],
];

// Mirror Docusaurus's default prefix rule, including date/version exceptions.
export const docIdFromSource = source => source.replace(/\.mdx?$/, '').split('/').map(part =>
  /^\d+[-_.]\d+/.test(part) ? part : part.replace(/^\d+\s*[-_.]+\s*(?=[^-_.\s])/, '')
).join('/');
export const domains = definitions.map(([directory,label,title,note,source,tone,sidebarIcon],index) => ({
  id:String(index).padStart(2,'0'), directory, label, title, note, source, tone, sidebarIcon,
  docId:docIdFromSource(source), to:'/docs/' + docIdFromSource(source),
}));
