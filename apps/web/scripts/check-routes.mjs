import { existsSync } from 'node:fs';
import { join } from 'node:path';

const routes = [
  'inbox',
  'pipeline',
  'contacts',
  'calendar',
  'quotes',
  'tasks',
  'reports',
  'settings',
  'settings/knowledge',
  'settings/ai',
  'login',
];

const root = new URL('../src/app', import.meta.url).pathname;
const missing = routes.filter((route) => !existsSync(join(root, route, 'page.tsx')));

if (missing.length) {
  console.error(`Missing route pages: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Route pages OK: ${routes.length}`);
