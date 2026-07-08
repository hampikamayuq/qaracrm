import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('golden set publication command', () => {
  it('exposes pnpm test:golden as the publication gate', async () => {
    const pkgPath = path.join(__dirname, '../../package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.['test:golden']).toBe('tsx src/scripts/run-golden-set.ts');
  });
});
