#!/usr/bin/env node
/**
 * Kimi Code (Fork) — 一键构建并安装脚本
 *
 * 用法:
 *   node install.mjs                      # 构建并安装到 VS Code(自动检测平台)
 *   node install.mjs --platform win32-x64 # 指定打包平台
 *   node install.mjs --skip-build         # 跳过构建,直接用 artifacts/vsix 里已有的 vsix
 *   node install.mjs --cli                # 改用 `code --install-extension` 安装
 *   node install.mjs --unpack-to <dir>    # 额外把扩展内容解包一份到指定目录(如旧的运行目录)
 *
 * 环境要求: Node.js >= 24.15.0, pnpm 10.x, VS Code
 * 安装后请在 VS Code 中执行: Ctrl+Shift+P → "Developer: Reload Window" 生效。
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractZip } from './apps/vscode/scripts/zip.mjs';

const rootDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('./apps/vscode/package.json');
const vscodeAppDir = join(rootDir, 'apps', 'vscode');
const extId = `${pkg.publisher}.${pkg.name}`;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
};

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

// ---- 解析平台(默认自动检测) ----
let platform = valueOf('--platform');
if (!platform) {
  const os = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  platform = `${os}-${arch}`;
}
console.log(`[1/5] 目标平台: ${platform}`);

// ---- 1. 构建(可跳过) ----
const vsixPath = join(vscodeAppDir, 'artifacts', 'vsix', `kimi-code-${platform}.vsix`);
if (flag('--skip-build')) {
  console.log('[2/5] 跳过构建(--skip-build)');
  if (!existsSync(vsixPath)) {
    fail(`未找到 ${vsixPath}\n  请先运行 node install.mjs 完成一次完整构建。`);
  }
} else {
  console.log('[2/5] 构建中(typecheck → build → vsix 打包)…');
  execSync('pnpm typecheck', { cwd: vscodeAppDir, stdio: 'inherit' });
  execSync('pnpm build', { cwd: vscodeAppDir, stdio: 'inherit' });
  execSync(`node scripts/vsix-package.mjs ${platform}`, { cwd: vscodeAppDir, stdio: 'inherit' });
}
if (!existsSync(vsixPath)) fail(`构建完成但未找到 ${vsixPath}`);
console.log(`      vsix: ${vsixPath}`);

// ---- 2. 解包 vsix 的 extension/ 子树 ----
async function unpackExtraction(vsixPath, destination) {
  // 解全量到临时目录,再移动 extension/ 子树,规避 rename 跨盘问题
  const tmpDir = join(rootDir, '.tmp', `vsix-unpack-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  await extractZip(vsixPath, tmpDir);
  const unpacked = join(tmpDir, 'extension');
  if (!existsSync(unpacked)) {
    await rm(tmpDir, { recursive: true, force: true });
    fail(`vsix 中没有 extension/ 目录,格式异常: ${vsixPath}`);
  }
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await rename(unpacked, destination);
  await rm(tmpDir, { recursive: true, force: true });
}

// ---- 3. 安装到 VS Code ----
const extRoot = join(homedir(), '.vscode', 'extensions');
const targetDir = join(extRoot, `${extId}-${pkg.version}`);

if (flag('--cli')) {
  console.log('[3/5] 用 code CLI 安装…');
  execSync(`code --install-extension ${vsixPath} --force`, { stdio: 'inherit' });
} else {
  console.log(`[3/5] 解包安装到 ${targetDir}`);
  const staleDirs = [];
  if (existsSync(extRoot)) {
    for (const name of await readdir(extRoot)) {
      if (name.startsWith(`${extId}-`) && name !== `${extId}-${pkg.version}`) {
        staleDirs.push(join(extRoot, name));
      }
    }
  }
  await unpackExtraction(vsixPath, targetDir);
  for (const d of staleDirs) {
    console.log(`      清理旧版本: ${basename(d)}`);
    await rm(d, { recursive: true, force: true });
  }
}

// ---- 4. 可选:额外解包到指定目录(如旧的运行目录) ----
const unpackTo = valueOf('--unpack-to');
if (unpackTo) {
  console.log(`[4/5] 额外解包到 ${unpackTo}`);
  await unpackExtraction(vsixPath, unpackTo);
} else {
  console.log('[4/5] 完成');
}

// ---- 5. 完成提示 ----
console.log(`[5/5] Kimi Code (Fork) v${pkg.version}(${extId}) 已安装\n`);
console.log('请在 VS Code 中执行:  Ctrl+Shift+P → "Developer: Reload Window"  使其生效。');
console.log('注意: 扩展菜单里的 "Reset Kimi" 只刷新 webview, 不重载扩展宿主, 改代码后必须 Reload Window。\n');
