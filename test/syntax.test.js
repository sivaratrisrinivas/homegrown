import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Every browser file must parse: catches leftover merge-conflict markers and syntax errors.
const dir = new URL('../public/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
test('public/*.js exist', () => assert.ok(files.length >= 3));
for (const f of files) {
  test(`public/${f} parses (node --check) and has no conflict markers`, () => {
    const path = new URL(f, dir).pathname;
    assert.doesNotMatch(readFileSync(path, 'utf8'), /^(<{7}|={7}|>{7})( |$)/m);
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  });
}
