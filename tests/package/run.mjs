import { execFileSync } from 'node:child_process';
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = mkdtempSync(join(tmpdir(), 'figma-plugin-rpc-package-'));
const npmCache = join(fixtureRoot, 'npm-cache');

try {
	const packOutput = execFileSync(
		'npm',
		['pack', '--json', '--ignore-scripts', '--pack-destination', fixtureRoot],
		{
			cwd: packageRoot,
			encoding: 'utf8',
			env: { ...process.env, npm_config_cache: npmCache },
		},
	);
	const [{ filename }] = JSON.parse(packOutput);
	const tarballPath = join(fixtureRoot, filename);

	execFileSync('tar', ['-xzf', tarballPath, '-C', fixtureRoot]);

	const nodeModules = join(fixtureRoot, 'node_modules');
	mkdirSync(nodeModules);
	renameSync(join(fixtureRoot, 'package'), join(nodeModules, 'figma-plugin-rpc'));

	for (const fixture of ['esm.mjs', 'cjs.cjs']) {
		cpSync(join(packageRoot, 'tests', 'package', fixture), join(fixtureRoot, fixture));
		execFileSync(process.execPath, [fixture], {
			cwd: fixtureRoot,
			stdio: 'inherit',
		});
	}

	const typeFixture = join(fixtureRoot, 'consumer.mts');
	writeFileSync(
		typeFixture,
		`import { createRpcClient, type RpcNotificationSchema, type RpcProcedureSchema, type RpcTransport } from 'figma-plugin-rpc';

interface Procedures extends RpcProcedureSchema {
  ping: { request: { value: string }; response: { echoed: string } };
}

interface Notifications extends RpcNotificationSchema {}

declare const transport: RpcTransport;
const client = createRpcClient<Procedures, Notifications>(transport);
void client.call('ping', { value: 'hello' });
// @ts-expect-error Unknown procedure names must be rejected through package declarations.
void client.call('typo', { value: 'hello' });
`,
	);

	execFileSync(
		join(packageRoot, 'node_modules', '.bin', 'tsc'),
		[
			'--noEmit',
			'--strict',
			'--skipLibCheck',
			'--target',
			'ES2022',
			'--module',
			'NodeNext',
			'--moduleResolution',
			'NodeNext',
			typeFixture,
		],
		{ cwd: fixtureRoot, stdio: 'inherit' },
	);

	const packedPackage = JSON.parse(
		readFileSync(join(nodeModules, 'figma-plugin-rpc', 'package.json'), 'utf8'),
	);
	if (!packedPackage.exports?.['.']) {
		throw new Error('Packed package does not define the root exports map');
	}

	console.log('Packed package consumer tests passed');
} finally {
	rmSync(fixtureRoot, { recursive: true, force: true });
}
