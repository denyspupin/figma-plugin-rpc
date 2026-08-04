import { createRpcClient, FigmaUiTransport } from '../src';

interface Procedures {
	'get-variables': {
		request: void;
		response: { variables: { id: string; name: string }[] };
	};
	'variableSearch.start': {
		request: { variableId: string; scope: string };
		response: { started: boolean };
	};
}

interface Notifications {
	'variableSearch.results': {
		searchId: string;
		results: { nodeId: string; field: string }[];
		isComplete: boolean;
	};
	'variableSearch.progress': {
		searchId: string;
		processed: number;
		total: number;
	};
}

const rpc = createRpcClient<Procedures, Notifications>(new FigmaUiTransport());
rpc.init();

async function main() {
	const { variables } = await rpc.call('get-variables');
	console.log('Variables:', variables);

	rpc.on('variableSearch.results', (payload) => {
		console.log(`Batch: ${payload.results.length} results, complete: ${payload.isComplete}`);
	});

	rpc.on('variableSearch.progress', (payload) => {
		console.log(`Progress: ${payload.processed}/${payload.total}`);
	});

	await rpc.call('variableSearch.start', {
		variableId: variables[0]?.id ?? '',
		scope: 'all-pages',
	});
}

main().catch(console.error);
