import {
	createRpcClient,
	createRpcServer,
	decodeRpcMessage,
	isRpcRequest,
	isRpcResponse,
	isRpcNotification,
	RpcError,
	PROTOCOL_VERSION,
	FigmaUiTransport,
	FigmaMainTransport,
	noopLogger,
	formatDuration,
} from '../../dist/index.js';

const checks = [];

checks.push(typeof createRpcClient === 'function');
checks.push(typeof createRpcServer === 'function');
checks.push(typeof decodeRpcMessage === 'function');
checks.push(typeof isRpcRequest === 'function');
checks.push(typeof isRpcResponse === 'function');
checks.push(typeof isRpcNotification === 'function');
checks.push(typeof RpcError === 'function');
checks.push(PROTOCOL_VERSION === 1);
checks.push(typeof FigmaUiTransport === 'function');
checks.push(typeof FigmaMainTransport === 'function');
checks.push(typeof noopLogger === 'object');
checks.push(typeof formatDuration === 'function');
checks.push(formatDuration(500) === '500ms');
checks.push(formatDuration(1500) === '1s 500ms');

const err = new RpcError('TEST', 'test error', { key: 'value' });
checks.push(err instanceof Error);
checks.push(err.code === 'TEST');
checks.push(err.message === 'test error');

const decoded = decodeRpcMessage({
	__rpc: true,
	id: '1',
	procedure: 'test',
	payload: {},
});
checks.push(decoded.ok === true);

const failed = checks.filter((c) => !c);
if (failed.length > 0) {
	console.error(`ESM package test failed: ${failed.length} check(s) failed`);
	process.exit(1);
}

console.log('ESM package test passed');
