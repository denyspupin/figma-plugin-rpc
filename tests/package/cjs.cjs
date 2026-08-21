const {
	createRpcClient,
	createRpcServer,
	decodeRpcMessage,
	isRpcRequest,
	isRpcResponse,
	isRpcNotification,
	RpcError,
	FigmaUiTransport,
	FigmaMainTransport,
	noopLogger,
} = require('figma-plugin-rpc');

const checks = [];

checks.push(typeof createRpcClient === 'function');
checks.push(typeof createRpcServer === 'function');
checks.push(typeof decodeRpcMessage === 'function');
checks.push(typeof isRpcRequest === 'function');
checks.push(typeof isRpcResponse === 'function');
checks.push(typeof isRpcNotification === 'function');
checks.push(typeof RpcError === 'function');
checks.push(typeof FigmaUiTransport === 'function');
checks.push(typeof FigmaMainTransport === 'function');
checks.push(typeof noopLogger === 'object');

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
	console.error(`CJS package test failed: ${failed.length} check(s) failed`);
	process.exit(1);
}

console.log('CJS package test passed');
