import {
	createRpcServer,
	FigmaMainTransport,
	type RpcNotificationSchema,
	type RpcProcedureSchema,
} from '../src';

interface Procedures extends RpcProcedureSchema {
	'get-selection': {
		request: void;
		response: { nodeIds: string[] };
	};
	'create-rectangle': {
		request: { x: number; y: number; width: number; height: number };
		response: { nodeId: string };
	};
}

interface Notifications extends RpcNotificationSchema {
	'selection-changed': { nodeIds: string[] };
}

const rpc = createRpcServer<Procedures, Notifications>(new FigmaMainTransport());

rpc.registerHandler('get-selection', () => ({
	nodeIds: figma.currentPage.selection.map((n) => n.id),
}));

rpc.registerHandler('create-rectangle', ({ x, y, width, height }) => {
	const node = figma.createRectangle();
	node.x = x;
	node.y = y;
	node.resize(width, height);
	figma.currentPage.appendChild(node);
	return { nodeId: node.id };
});

(figma.currentPage as unknown as { on: (event: string, handler: () => void) => void }).on(
	'selectionchange',
	() => {
		rpc.notify('selection-changed', {
			nodeIds: figma.currentPage.selection.map((n) => n.id),
		});
	},
);

rpc.start();
