import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import GithubSlugger from 'github-slugger';

const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');
const projectRoot = process.cwd();
const docsRoot = path.join(projectRoot, 'docs');
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function walkMarkdown(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return walkMarkdown(target);
      return entry.isFile() && entry.name.endsWith('.md') ? [target] : [];
    });
}

function normalizePath(target) {
  return path.relative(projectRoot, target).replaceAll('\\', '/');
}

function parseDocument(source, file) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const normalized = source.replaceAll('\r\n', '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`${normalizePath(file)} 缺少合法 Front Matter`);
  return { frontMatter: match[1], body: match[2], newline };
}

function readScalar(frontMatter, key) {
  const pattern = new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm');
  const match = frontMatter.match(pattern);
  if (!match) return undefined;
  const raw = match[1].trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    if (raw.startsWith('"')) {
      try { return JSON.parse(raw); } catch { /* 使用宽松解析兜底 */ }
    }
    return raw.slice(1, -1).replaceAll("''", "'");
  }
  return raw;
}

function readInteger(frontMatter, key) {
  const value = readScalar(frontMatter, key);
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

function yamlString(value) {
  return JSON.stringify(String(value).replaceAll(/\s+/g, ' ').trim());
}

function stripNumericPrefix(value) {
  return value.replace(/^\s*\d{1,3}\.\s+/, '').trim();
}

function stripInlineMarkdown(value) {
  return value
    .replace(/\s*(?:\{#[^}]+\}|\{\/\*\s*#[^*]+\*\/\})\s*$/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function extractTitle(frontMatter, body, file) {
  const metadataTitle = readScalar(frontMatter, 'title');
  const bodyTitle = body.match(/^#\s+(.+?)\s*$/m)?.[1];
  const filenameTitle = path.basename(file, '.md').replace(/^\d{2}-/, '');
  return stripNumericPrefix(stripInlineMarkdown(metadataTitle || bodyTitle || filenameTitle));
}

function deriveDescription(body, title) {
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  let inFence = false;
  let paragraph = [];
  const candidates = [];

  const flush = () => {
    if (!paragraph.length) return;
    const text = stripInlineMarkdown(paragraph.join(' ')
      .replace(/^>\s*/, '')
      .replace(/\{#.+?\}/g, ''));
    if (text.length >= 16) candidates.push(text);
    paragraph = [];
  };

  for (const line of lines) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (/^(#{1,6})\s+/.test(trimmed)
      || /^(?:[-*+]\s+|\d+[.)]\s+)/.test(trimmed)
      || /^\|/.test(trimmed)
      || /^!\[/.test(trimmed)
      || /^<\/?[A-Z]/.test(trimmed)
      || /^::/.test(trimmed)
      || /^(?:---|\*\*\*|___)$/.test(trimmed)) {
      flush();
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();

  const fallback = `系统介绍 ${title} 的核心概念、工作原理、实践方法、可观测性与故障排查边界。`;
  const selected = candidates.find((text) => !text.startsWith('本文是历史')) || candidates[0] || fallback;
  return selected.length <= 150 ? selected : `${selected.slice(0, 147).replace(/[，。、；：,.!?\s]+$/, '')}……`;
}

function naturalLegacyRank(filename) {
  const appendix = filename.match(/^附录([A-J])/i);
  if (appendix) return 900 + appendix[1].toUpperCase().charCodeAt(0) - 65;
  const chinese = filename.match(/[（(]([一二三四五六七八九十]+)[）)]/);
  if (!chinese) return undefined;
  const values = new Map([
    ['一', 1], ['二', 2], ['三', 3], ['四', 4], ['五', 5],
    ['六', 6], ['七', 7], ['八', 8], ['九', 9], ['十', 10],
  ]);
  return values.get(chinese[1]);
}

function compareLegacyFiles(left, right) {
  const leftRank = naturalLegacyRank(left);
  const rightRank = naturalLegacyRank(right);
  if (leftRank !== undefined || rightRank !== undefined) {
    return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
  }
  return collator.compare(left, right);
}

function buildRenamePlan(files) {
  const plan = new Map();

  const fundamentals = path.join(docsRoot, 'networking', 'fundamentals');
  const explicitSequence = [
    ['00-传统网络从零到精通学习路线.md', '00-传统网络从零到精通学习路线.md'],
    ['01-网络基础与路由学习路线.md', '01-网络基础与路由学习路线.md'],
    ['01-从应用到网卡的数据包生命周期.md', '02-从应用到网卡的数据包生命周期.md'],
    ['02-IPv4子网划分与路由表.md', '03-IPv4子网划分与路由表.md'],
    ['05-ICMP-UDP-TCP与DNS.md', '04-ICMP-UDP-TCP与DNS.md'],
  ];
  for (const [from, to] of explicitSequence) {
    if (from !== to && fs.existsSync(path.join(fundamentals, from))) {
      plan.set(path.join(fundamentals, from), path.join(fundamentals, to));
    }
  }

  const byDirectory = new Map();
  for (const file of files) {
    const directory = path.dirname(file);
    if (!byDirectory.has(directory)) byDirectory.set(directory, []);
    byDirectory.get(directory).push(file);
  }

  for (const [directory, directoryFiles] of byDirectory) {
    const legacy = directoryFiles
      .filter((file) => !/^\d{2}-/.test(path.basename(file)))
      .sort((left, right) => compareLegacyFiles(path.basename(left), path.basename(right)));
    if (!legacy.length) continue;

    const used = new Set(directoryFiles
      .map((file) => path.basename(file).match(/^(\d{2})-/)?.[1])
      .filter(Boolean)
      .map(Number));

    for (let index = 0; index < legacy.length; index += 1) {
      const file = legacy[index];
      const parsed = parseDocument(fs.readFileSync(file, 'utf8'), file);
      let desired = readInteger(parsed.frontMatter, 'sidebar_position');

      if (/^附录[A-J]/i.test(path.basename(file))) {
        desired = 90 + index;
      } else if (desired === undefined || used.has(desired) || desired > 99) {
        desired = 1;
        while (used.has(desired)) desired += 1;
      }

      if (desired > 99) throw new Error(`${normalizePath(file)} 无法分配两位文章序号`);
      used.add(desired);
      const target = path.join(directory, `${String(desired).padStart(2, '0')}-${path.basename(file)}`);
      plan.set(file, target);
    }
  }

  const targets = new Set();
  for (const [from, to] of plan) {
    const key = to.toLowerCase();
    if (targets.has(key)) throw new Error(`重命名目标冲突：${normalizePath(to)}`);
    targets.add(key);
    if (fs.existsSync(to) && !plan.has(to)) {
      throw new Error(`重命名目标已存在：${normalizePath(from)} -> ${normalizePath(to)}`);
    }
  }
  return plan;
}

function applyRenamePlan(plan) {
  const temporary = [];
  let index = 0;
  for (const [from, to] of plan) {
    const temp = path.join(path.dirname(from), `.__format_migration_${process.pid}_${index}.md`);
    fs.renameSync(from, temp);
    temporary.push([temp, to]);
    index += 1;
  }
  for (const [temp, to] of temporary) fs.renameSync(temp, to);
}

function replacementPairs(plan) {
  const oldBasenames = new Map();
  for (const from of plan.keys()) {
    const basename = path.basename(from);
    oldBasenames.set(basename, (oldBasenames.get(basename) || 0) + 1);
  }
  return [...plan].map(([from, to]) => ({
    from: path.basename(from),
    to: path.basename(to),
    globallySafe: oldBasenames.get(path.basename(from)) === 1,
  }));
}

function replaceRenamedLinks(source, pairs) {
  let result = source;
  for (const pair of pairs) {
    if (pair.globallySafe) result = result.split(pair.from).join(pair.to);
  }
  return result;
}

function splitExplicitId(text) {
  const classic = text.match(/^(.*?)\s+\{#([^}]+)\}\s*$/);
  if (classic) return { text: classic[1].trim(), id: classic[2] };
  const mdxComment = text.match(/^(.*?)\s+\{\/\*\s*#([^*\s]+)\s*\*\/\}\s*$/);
  if (mdxComment) return { text: mdxComment[1].trim(), id: mdxComment[2] };
  return { text: text.trim(), id: undefined };
}

function stripHeadingNumber(text) {
  return text
    .replace(/^第[一二三四五六七八九十百]+(?:章|节|部分|阶段)[：:、.\s]*/, '')
    .replace(/^[一二三四五六七八九十百]+[、.]\s*/, '')
    .replace(/^\d+(?:\.\d+)*[、.]?\s+/, '')
    .replace(/^\d{2}\s+(?=\S)/, '')
    .trim();
}

function slugText(text) {
  return stripInlineMarkdown(splitExplicitId(text).text);
}

function normalizeBody(body, title) {
  const input = body.replaceAll('\r\n', '\n').split('\n');
  const slugger = new GithubSlugger();
  const annotated = [];
  let inFence = false;
  let fenceMarker;
  let firstH1 = false;
  let legacySection = false;
  let removedRules = 0;
  let labeledFences = 0;

  for (const originalLine of input) {
    let line = originalLine.replace(/[ \t]+$/, '');
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
        if (!fence[2].trim()) {
          line = line.replace(fence[1], `${fence[1]}text`);
          labeledFences += 1;
        }
      } else if (marker === fenceMarker && !fence[2].trim()) {
        inFence = false;
        fenceMarker = undefined;
      }
      annotated.push({ line });
      continue;
    }
    if (inFence) {
      annotated.push({ line });
      continue;
    }
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
      removedRules += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!heading) {
      annotated.push({ line });
      continue;
    }

    const originalLevel = heading[1].length;
    const originalText = heading[2];
    const explicit = splitExplicitId(originalText);
    const originalId = explicit.id || slugger.slug(slugText(originalText));
    let level = originalLevel;
    let text = explicit.text;

    if (originalLevel === 1) {
      if (!firstH1) {
        firstH1 = true;
        legacySection = false;
        text = title;
      } else {
        level = 2;
        legacySection = true;
      }
    } else if (legacySection) {
      level = Math.min(6, originalLevel + 1);
    }

    annotated.push({
      heading: true,
      level,
      text,
      explicitId: explicit.id,
      originalId,
      originalLine: line,
    });
  }

  if (!firstH1) {
    annotated.unshift({
      heading: true,
      level: 1,
      text: title,
      originalId: undefined,
      explicitId: undefined,
      originalLine: '',
    }, { line: '' });
  }

  const counters = Array(7).fill(0);
  const output = [];
  let previousLevel = 1;
  let changedHeadings = 0;

  for (const item of annotated) {
    if (!item.heading) {
      output.push(item.line);
      continue;
    }

    let level = item.level;
    if (level > previousLevel + 1) level = previousLevel + 1;
    if (level === 1) {
      previousLevel = 1;
      const rendered = `# ${title}`;
      if (rendered !== item.originalLine) changedHeadings += 1;
      output.push(rendered);
      continue;
    }

    counters[level] += 1;
    for (let deeper = level + 1; deeper <= 6; deeper += 1) counters[deeper] = 0;
    for (let parent = 2; parent < level; parent += 1) {
      if (counters[parent] === 0) counters[parent] = 1;
    }
    const number = counters.slice(2, level + 1).join('.');
    let text = stripHeadingNumber(item.text);
    if (/^(?:参考|参考文献|参考链接|参考资料与延伸阅读)$/.test(text)) text = '参考资料';
    const numbered = `${number}${level === 2 ? '.' : ''} ${text}`;
    let rendered = `${'#'.repeat(level)} ${numbered}`;

    const wouldChange = rendered !== item.originalLine;
    if (item.explicitId) {
      rendered += ` {/* #${item.explicitId} */}`;
    } else if (wouldChange && item.originalId) {
      rendered += ` {/* #${item.originalId} */}`;
    }
    if (rendered !== item.originalLine) changedHeadings += 1;
    output.push(rendered);
    previousLevel = level;
  }

  const compact = [];
  let blankCount = 0;
  for (const line of output) {
    if (!line.trim()) {
      blankCount += 1;
      if (blankCount <= 1) compact.push('');
    } else {
      blankCount = 0;
      compact.push(line);
    }
  }
  while (compact[0] === '') compact.shift();
  while (compact.at(-1) === '') compact.pop();

  return {
    body: `${compact.join('\n')}\n`,
    stats: { changedHeadings, removedRules, labeledFences },
  };
}

function normalizeFrontMatter(frontMatter, body, title, position) {
  const existingLabel = readScalar(frontMatter, 'sidebar_label');
  const labelText = stripNumericPrefix(stripInlineMarkdown(existingLabel || title));
  const existingDescription = readScalar(frontMatter, 'description');
  const description = existingDescription || deriveDescription(body, title);
  const tagsLine = frontMatter.split('\n').find((line) => /^tags:\s*/.test(line));
  const managedKeys = new Set(['title', 'sidebar_label', 'sidebar_position', 'description', 'tags']);
  const remaining = frontMatter.split('\n').filter((line) => {
    const key = line.match(/^([A-Za-z_][\w-]*):/)?.[1];
    return !key || !managedKeys.has(key);
  });
  while (remaining[0] === '') remaining.shift();
  while (remaining.at(-1) === '') remaining.pop();

  const result = [
    `title: ${yamlString(title)}`,
    `sidebar_label: ${yamlString(`${String(position).padStart(2, '0')}. ${labelText}`)}`,
    `sidebar_position: ${position}`,
    `description: ${yamlString(description)}`,
    tagsLine || 'tags: [技术学习]',
  ];
  if (remaining.length) result.push(...remaining);
  return result.join('\n');
}

function normalizeOne(file, source, pairs) {
  const linkedSource = replaceRenamedLinks(source, pairs);
  const parsed = parseDocument(linkedSource, file);
  const filename = path.basename(file);
  const prefix = filename.match(/^(\d{2})-/)?.[1];
  if (!prefix) throw new Error(`${normalizePath(file)} 迁移后仍缺少两位文件序号`);
  const position = Number(prefix);
  const title = extractTitle(parsed.frontMatter, parsed.body, file);
  const normalizedBody = normalizeBody(parsed.body, title);
  const frontMatter = normalizeFrontMatter(parsed.frontMatter, parsed.body, title, position);
  const normalized = `---\n${frontMatter}\n---\n\n${normalizedBody.body}`
    .replaceAll('\n', parsed.newline);
  return { source: normalized, stats: normalizedBody.stats };
}

function main() {
  const originalFiles = walkMarkdown(docsRoot).sort(collator.compare);
  const renamePlan = buildRenamePlan(originalFiles);
  const pairs = replacementPairs(renamePlan);

  if (WRITE) applyRenamePlan(renamePlan);

  const files = WRITE
    ? walkMarkdown(docsRoot).sort(collator.compare)
    : originalFiles.map((file) => renamePlan.get(file) || file).sort(collator.compare);
  const originalByLogicalPath = new Map(originalFiles.map((file) => [renamePlan.get(file) || file, file]));
  const changes = [];
  const totals = { changedHeadings: 0, removedRules: 0, labeledFences: 0 };

  for (const file of files) {
    const sourceFile = WRITE ? file : originalByLogicalPath.get(file);
    const original = fs.readFileSync(sourceFile, 'utf8');
    const normalized = normalizeOne(file, original, pairs);
    const comparable = WRITE ? fs.readFileSync(file, 'utf8') : original;
    if (normalized.source !== comparable || sourceFile !== file) {
      changes.push(normalizePath(file));
      if (WRITE) fs.writeFileSync(file, normalized.source, 'utf8');
    }
    for (const key of Object.keys(totals)) totals[key] += normalized.stats[key];
  }

  console.log(`文档总数：${files.length}`);
  console.log(`需要重命名：${renamePlan.size}`);
  console.log(`需要改写：${changes.length}`);
  console.log(`标题调整：${totals.changedHeadings}`);
  console.log(`移除装饰分隔线：${totals.removedRules}`);
  console.log(`补全代码块语言：${totals.labeledFences}`);
  if (renamePlan.size) {
    console.log('\n文件名迁移：');
    for (const [from, to] of renamePlan) console.log(`- ${normalizePath(from)} -> ${normalizePath(to)}`);
  }
  if (!WRITE && changes.length) console.log(`\n运行 node scripts/normalize-doc-format.mjs --write 执行迁移。`);
  if (CHECK && changes.length) process.exitCode = 1;
}

main();
