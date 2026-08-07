import { createRpcClient, FigmaUiTransport } from '../src';

interface Procedures {
	'get-selection': {
		request: void;
		response: { nodeIds: string[] };
	};
	'create-rectangle': {
		request: { x: number; y: number; width: number; height: number };
		response: { nodeId: string };
	};
}

interface Notifications {
	'selection-changed': { nodeIds: string[] };
}

const rpc = createRpcClient<Procedures, Notifications>(new FigmaUiTransport());
rpc.init();

async function main() {
	const { nodeIds } = await rpc.call('get-selection');
	console.log('Selected nodes:', nodeIds);

	const { nodeId } = await rpc.call('create-rectangle', {
		x: 100,
		y: 100,
		width: 200,
		height: 150,
	});
	console.log('Created rectangle:', nodeId);

	rpc.on('selection-changed', ({ nodeIds }) => {
		console.log('Selection changed:', nodeIds);
	});
}

main().catch(console.error);
