import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = process.cwd();
const base = 'docs/development/java';
const examples = 'examples/java/second-batch';
const documents = [
  ['01-language/09-Object相等性与hashCode契约.md', 'equality', 'EqualityDemo'],
  ['01-language/10-异常传播与资源关闭.md', 'exceptions', 'ExceptionDemo'],
  ['01-language/11-Enum-Record-Sealed与模式匹配.md', 'models', 'ModelDemo'],
  ['01-language/12-不可变对象组合与依赖边界.md', 'design', 'DesignDemo'],
  ['02-standard-library/01-泛型通配符与类型擦除.md', 'generics', 'GenericDemo'],
  ['02-standard-library/02-字符串Unicode编码与正则.md', 'text', 'TextDemo'],
  ['02-standard-library/03-ArrayList与LinkedList结构与选型.md', 'lists', 'ListDemo'],
  ['02-standard-library/04-HashMap-LinkedHashMap与HashSet.md', 'maps', 'MapDemo'],
  ['02-standard-library/05-TreeMap-TreeSet与Comparator.md', 'sorted', 'SortedDemo'],
  ['02-standard-library/06-Queue-Deque与PriorityQueue.md', 'queues', 'QueueDemo'],
  ['02-standard-library/07-迭代器集合视图与工具类.md', 'views', 'ViewDemo'],
  ['02-standard-library/08-Lambda方法引用与函数式接口.md', 'lambdas', 'LambdaDemo'],
  ['02-standard-library/09-Stream-Collector与Optional.md', 'streams', 'StreamDemo'],
  ['02-standard-library/10-BigDecimal与java-time.md', 'values-time', 'ValueTimeDemo'],
  ['02-standard-library/11-Path-Files与文件IO.md', 'files', 'FileDemo'],
  ['02-standard-library/12-NIO-Buffer-Channel与Selector.md', 'nio', 'NioDemo'],
  ['02-standard-library/13-Socket-HttpClient-DNS与TLS.md', 'http', 'HttpDemo', ['jdk.httpserver']],
  ['02-standard-library/14-反射注解与动态代理.md', 'reflection', 'ProxyDemo'],
];
const cases = documents.map(([document, directory, main, modules = []]) => {
  const text = fs.readFileSync(path.join(root, base, document), 'utf8').replaceAll('\r\n', '\n');
  const sources = [...text.matchAll(/^```java title="([^"]+)"\n([\s\S]*?)^```/gm)];
  const output = [...text.matchAll(/^```text title="expected-output"\n([\s\S]*?)^```/gm)];
  if (sources.length !== 1 || sources[0][1] !== `${main}.java` || output.length !== 1) {
    throw new Error(`Expected one complete source and output block: ${document}`);
  }
  return {
    document, directory, main, modules,
    file: `${examples}/${directory}/${main}.java`,
    source: sources[0][2].trimEnd() + '\n',
    output: output[0][1].trimEnd(),
  };
});

if (process.argv.includes('--emit-patch')) {
  let patch = '*** Begin Patch\n';
  for (const item of cases) {
    if (fs.existsSync(path.join(root, item.file))) throw new Error(`Refusing to replace: ${item.file}`);
    patch += `*** Add File: ${path.join(root, item.file).replaceAll('\\', '/')}\n`;
    patch += item.source.trimEnd().split('\n').map((line) => `+${line}`).join('\n') + '\n';
  }
  process.stdout.write(patch + '*** End Patch\n');
  process.exit(0);
}
for (const item of cases) {
  const source = fs.readFileSync(path.join(root, item.file), 'utf8').replaceAll('\r\n', '\n');
  if (source !== item.source) throw new Error(`Article/source mismatch: ${item.file}`);
}
console.log(`Article/source consistency: ${cases.length} programs passed.`);
if (process.argv.includes('--check-sources')) process.exit(0);

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
const javaHome = option('--java-home') ?? process.env.JAVA_HOME;
if (!javaHome) throw new Error('Supply --java-home with a JDK 25 directory.');
const binary = (name) => path.join(javaHome, 'bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 30000});
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result.stdout.replaceAll('\r\n', '\n').trim();
}
const version = run(binary('javac'), ['-version']);
if (!/^javac 25(?:[.\s]|$)/u.test(version)) throw new Error(`Expected JDK 25, got ${version}`);
console.log(version);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'java-standard-check-'));
const classpaths = [];
for (const item of cases) {
  const out = path.join(temporaryRoot, item.directory);
  fs.mkdirSync(out);
  classpaths.push(out);
  const modules = item.modules.length ? ['--add-modules', item.modules.join(',')] : [];
  run(binary('javac'), ['-encoding', 'UTF-8', '--release', '25', ...modules,
    '-d', out, path.join(root, item.file)]);
  const output = run(binary('java'), ['-Dfile.encoding=UTF-8', '-Duser.language=en', '-Duser.country=US',
    ...modules, '-cp', out, item.main]);
  if (output !== item.output) throw new Error(`${item.main}: documented output mismatch\nExpected:\n${item.output}\nActual:\n${output}`);
  console.log(`PASS ${item.main}: compilation and documented output`);
}

const negativeCases = [
  ['BadGeneric', 'class BadGeneric { java.util.List<Number> values = java.util.List.<Integer>of(1); }'],
  ['BadCapture', 'class BadCapture { void use() { int n = 1; Runnable r = () -> System.out.println(n); n++; } }'],
  ['BadRecord', 'record ParentRecord(int n) {} class BadRecord extends ParentRecord { BadRecord() { super(1); } }'],
  ['BadExhaustive', 'sealed interface Result permits Yes, No {} record Yes() implements Result {} record No() implements Result {} class BadExhaustive { int use(Result r) { return switch(r) { case Yes y -> 1; }; } }'],
];
for (const [name, source] of negativeCases) {
  const file = path.join(temporaryRoot, `${name}.java`);
  fs.writeFileSync(file, source, 'utf8');
  const result = spawnSync(binary('javac'), ['--release', '25', '-d', temporaryRoot, file],
    {encoding: 'utf8', timeout: 30000});
  if (result.error || result.status !== 1) throw new Error(`Expected compiler rejection: ${name}\n${result.stderr ?? ''}`);
  console.log(`PASS expected compilation failure: ${name}`);
}

const boundarySource = `
import java.math.BigDecimal;
import java.util.List;
public class BoundaryChecks {
    static void rejects(Class<? extends Throwable> type, Runnable action) {
        try { action.run(); }
        catch (Throwable failure) {
            if (type.isInstance(failure)) return;
            throw new AssertionError("wrong exception", failure);
        }
        throw new AssertionError("expected " + type.getName());
    }
    public static void main(String[] args) {
        rejects(IllegalArgumentException.class, () -> new ModelDemo.Task(" ", List.of()));
        rejects(NullPointerException.class, () -> new ModelDemo.Task("ok", null));
        rejects(NullPointerException.class, () -> ModelDemo.describe(null));
        rejects(UnsupportedOperationException.class, () -> new ModelDemo.Task("ok", List.of()).labels().add("x"));
        rejects(IllegalArgumentException.class, () -> new DesignDemo.TaskSnapshot(" ", List.of()));
        rejects(ArithmeticException.class, () -> BigDecimal.ONE.divide(new BigDecimal("3")));
        rejects(NullPointerException.class, () -> List.of("ok", null));
        var id = new EqualityDemo.TaskId("x");
        if (!id.equals(id) || id.equals(null) || id.equals("x")) throw new AssertionError("equals boundary");
        if (!id.equals(new EqualityDemo.TaskId("x"))) throw new AssertionError("value equality");
        System.out.println("boundary checks passed");
    }
}
`;
const boundaryFile = path.join(temporaryRoot, 'BoundaryChecks.java');
fs.writeFileSync(boundaryFile, boundarySource, 'utf8');
const classpath = [...classpaths, temporaryRoot].join(path.delimiter);
run(binary('javac'), ['-encoding', 'UTF-8', '--release', '25', '-cp', classpath, '-d', temporaryRoot, boundaryFile]);
if (run(binary('java'), ['-cp', classpath, 'BoundaryChecks']) !== 'boundary checks passed') throw new Error('Boundary checks failed.');
console.log('PASS boundary checks: invalid input, null, immutability, equality and exact decimal division');
if (path.dirname(temporaryRoot) !== path.resolve(os.tmpdir()) || !path.basename(temporaryRoot).startsWith('java-standard-check-')) {
  throw new Error('Unexpected temporary cleanup path.');
}
fs.rmSync(temporaryRoot, {recursive: true});
console.log('All second-batch Java article checks passed.');
