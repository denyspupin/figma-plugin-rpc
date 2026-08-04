import { createRpcServer, FigmaMainTransport } from '../src';

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

const rpc = createRpcServer<Procedures, Notifications>(new FigmaMainTransport());

rpc.registerHandler('get-variables', () => {
	const vars = figma.variables.getLocalVariables().map((v) => ({
		id: v.id,
		name: v.name,
	}));
	return { variables: vars };
});

rpc.registerHandler('variableSearch.start', (payload) => {
	const { variableId, scope } = payload;

	void (async () => {
		let processed = 0;
		const pages = scope === 'current-page' ? [figma.currentPage] : figma.root.children;
		const total = pages.reduce((acc, page) => acc + page.findAll().length, 0);

		for (const page of pages) {
			const nodes = page.findAll();
			for (const node of nodes) {
				processed++;
				if (processed % 50 === 0) {
					rpc.notify('variableSearch.progress', {
						searchId: variableId,
						processed,
						total,
					});
				}
			}
		}

		rpc.notify('variableSearch.results', {
			searchId: variableId,
			results: [],
			isComplete: true,
		});
	})();

	return { started: true };
});

rpc.start();
