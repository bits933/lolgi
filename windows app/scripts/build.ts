/**
 * Build script — orchestrates the full production build.
 * Run with: npx ts-node scripts/build.ts
 * Or use the npm scripts: npm run build
 */

import { execSync } from 'child_process';

function run(cmd: string): void {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

console.log('[build] Building Logi Actions Ring...');

// 1. Compile main process TypeScript
console.log('\n[1/3] Compiling main process...');
run('npx tsc -p tsconfig.main.json');

// 2. Bundle overlay renderer
console.log('\n[2/3] Bundling overlay renderer...');
run('npx vite build --config vite.config.overlay.ts');

// 3. Bundle dashboard renderer
console.log('\n[3/3] Bundling dashboard renderer...');
run('npx vite build --config vite.config.dashboard.ts');

console.log('\n[build] Done. Run `npm run electron` to launch.');
