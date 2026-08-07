# figma-plugin-rpc

[![npm version](https://img.shields.io/npm/v/figma-plugin-rpc?cacheSeconds=0)](https://www.npmjs.com/package/figma-plugin-rpc)
[![npm downloads](https://img.shields.io/npm/dm/figma-plugin-rpc?cacheSeconds=0)](https://www.npmjs.com/package/figma-plugin-rpc)
[![CI](https://github.com/denyspupin/figma-plugin-rpc/actions/workflows/ci.yml/badge.svg)](https://github.com/denyspupin/figma-plugin-rpc/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/denyspupin/figma-plugin-rpc?cacheSeconds=0)](./LICENSE)

Type-safe RPC for Figma plugins. Call procedures and stream notifications between your plugin's main thread and UI iframe with full TypeScript inference.

## Why?

Figma plugins run in two isolated contexts: the **main thread** (access to `figma.*` APIs) and the **UI iframe** (your React/Vue/Svelte app). Communicating between them requires `postMessage`, which is untyped and error-prone.

`figma-plugin-rpc` gives you:

- **Type-safe procedures** — Define once, get full inference on both sides
- **Streaming notifications** — Server→client pub/sub for progress updates, selection changes, etc.
- **Zero config** — Built-in transports work out of the box
- **Transport-agnostic** — Swap in WebSocket, Worker, or any `postMessage` environment

## Install

```bash
npm install figma-plugin-rpc
```

> `@figma/plugin-typings` is an optional peer dependency (only needed for the built-in Figma transports).

## Quick start

### 1. Define your schema

Create a shared file that both your main thread and UI will import:

```ts
// rpc-schema.ts
import type { RpcProcedureSchema, RpcNotificationSchema } from 'figma-plugin-rpc';

export interface Procedures extends RpcProcedureSchema {
	'get-selection': {
		request: void;
		response: { nodeIds: string[] };
	};
	'create-rectangle': {
		request: { x: number; y: number; width: number; height: number };
		response: { nodeId: string };
	};
}

export interface Notifications extends RpcNotificationSchema {
	'selection-changed': { nodeIds: string[] };
}
```

### 2. Main thread (plugin code)

```ts
// code.ts
import { createRpcServer, FigmaMainTransport } from 'figma-plugin-rpc';
import type { Procedures, Notifications } from './rpc-schema';

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

// Notify UI when selection changes
figma.currentPage.on('selectionchange', () => {
	rpc.notify('selection-changed', {
		nodeIds: figma.currentPage.selection.map((n) => n.id),
	});
});

rpc.start();
```

### 3. UI (iframe)

```ts
// ui.ts
import { createRpcClient, FigmaUiTransport } from 'figma-plugin-rpc';
import type { Procedures, Notifications } from './rpc-schema';

const rpc = createRpcClient<Procedures, Notifications>(new FigmaUiTransport());
rpc.init();

// Call procedures with full type safety
const { nodeIds } = await rpc.call('get-selection');

const { nodeId } = await rpc.call('create-rectangle', {
	x: 100,
	y: 100,
	width: 200,
	height: 150,
});

// Subscribe to notifications
const unsubscribe = rpc.on('selection-changed', ({ nodeIds }) => {
	console.log('Selection changed:', nodeIds);
});

// Cleanup when done
unsubscribe();
```

## API

### Schema types

```ts
interface RpcProcedureSchema {
	[procedureName: string]: {
		request: unknown; // Use `void` for no payload
		response: unknown;
	};
}

interface RpcNotificationSchema {
	[notificationName: string]: unknown; // The notification payload
}
```

### `createRpcClient(transport, config?)`

Creates a client for the UI iframe.

| Method                                | Description                                             |
| ------------------------------------- | ------------------------------------------------------- |
| `init()`                              | Start listening for responses/notifications             |
| `destroy()`                           | Stop listening, reject pending requests, clear handlers |
| `call(procedure, payload?, options?)` | Call a procedure, returns `Promise<response>`           |
| `on(notification, handler)`           | Subscribe to a notification, returns `unsubscribe()`    |
| `getPendingCount()`                   | Number of in-flight requests                            |
| `isInitialized()`                     | Whether `init()` has been called                        |

**Config options:**

- `defaultTimeout` — Request timeout in ms (default: `30000`)
- `logger` — Custom logger implementing `Logger` interface (default: `noopLogger`)

### `createRpcServer(transport, config?)`

Creates a server for the plugin main thread.

| Method                                | Description                                  |
| ------------------------------------- | -------------------------------------------- |
| `start()`                             | Start listening for incoming procedure calls |
| `stop()`                              | Stop listening                               |
| `registerHandler(procedure, handler)` | Register a handler for a procedure           |
| `notify(notification, payload)`       | Send a notification to the client            |

**Config options:**

- `logger` — Custom logger implementing `Logger` interface (default: `noopLogger`)
- `onError` — Callback for unhandled errors in handlers

### Built-in transports

| Transport            | Context     | Description                                                                 |
| -------------------- | ----------- | --------------------------------------------------------------------------- |
| `FigmaUiTransport`   | UI iframe   | Wraps messages in `{ pluginMessage: ... }` for `postMessage`                |
| `FigmaMainTransport` | Main thread | Uses `figma.ui.postMessage` / `figma.ui.onmessage`, multiplexes subscribers |

### Custom transports

Implement the `RpcTransport` interface for any message-passing environment:

```ts
import type { RpcTransport } from 'figma-plugin-rpc';

class WebSocketTransport implements RpcTransport {
	private handlers = new Set<(message: unknown) => void>();

	constructor(private ws: WebSocket) {
		ws.addEventListener('message', (event) => {
			const data = JSON.parse(event.data);
			this.handlers.forEach((h) => h(data));
		});
	}

	send(message: unknown): void {
		this.ws.send(JSON.stringify(message));
	}

	onMessage(handler: (message: unknown) => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}
}

// Use it
const rpc = createRpcClient(new WebSocketTransport(ws));
```

## Examples

### Error handling

Handlers that throw will propagate the error to the client:

```ts
// Server
rpc.registerHandler('risky-operation', () => {
	throw new Error('Something went wrong');
});

// Client
try {
	await rpc.call('risky-operation');
} catch (error) {
	console.error(error.message); // "Something went wrong"
}
```

### Per-call timeouts

Override the default timeout for specific calls:

```ts
await rpc.call('slow-operation', payload, { timeout: 60000 }); // 60s
```

### Async handlers

Handlers can be async:

```ts
rpc.registerHandler('fetch-data', async () => {
	const response = await fetch('https://api.example.com/data');
	return response.json();
});
```

## License

MIT
