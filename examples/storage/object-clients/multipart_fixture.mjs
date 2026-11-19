// Local fixture preparation only. This file never contacts an object service.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

export function makeFixture() {
  const first = Buffer.alloc(6 * 1024 * 1024, 'A');
  const last = Buffer.from('END\n');
  const bytes = first.length + last.length;
  const sha256 = createHash('sha256').update(first).update(last).digest('hex');
  return {first, last, expected: {bytes, sha256}};
}

export function makeCompletion(first, last) {
  for (const reply of [first, last]) assert(typeof reply.ETag === 'string' && reply.ETag.length > 0, 'Missing returned ETag');
  return {Parts: [{ETag: first.ETag, PartNumber: 1}, {ETag: last.ETag, PartNumber: 2}]};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'prepare' && args.length === 1) {
    const directory = path.resolve(args[0]);
    assert(fs.statSync(directory).isDirectory(), 'Supply an existing private lab directory');
    const {first, last, expected} = makeFixture();
    for (const [name, data] of [['part-1.bin', first], ['part-2.bin', last], ['expected.json', JSON.stringify(expected, null, 2)]]) {
      fs.writeFileSync(path.join(directory, name), data, {flag: 'wx'});
    }
    console.log(JSON.stringify(expected));
  } else if (command === 'parts' && args.length === 3) {
    const replies = args.slice(0, 2).map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
    fs.writeFileSync(args[2], JSON.stringify(makeCompletion(...replies), null, 2), {flag: 'wx'});
  } else if (command === 'verify' && args.length === 1) {
    const directory = path.resolve(args[0]);
    const expected = JSON.parse(fs.readFileSync(path.join(directory, 'expected.json'), 'utf8'));
    const data = fs.readFileSync(path.join(directory, 'download.bin'));
    assert.equal(data.length, expected.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), expected.sha256);
    console.log('downloaded bytes and SHA-256 match the prepared fixture');
  } else {
    throw new Error('Usage: prepare DIRECTORY | parts PART1.json PART2.json OUTPUT.json | verify DIRECTORY');
  }
}
