# figma-plugin-rpc

[![npm version](https://img.shields.io/npm/v/figma-plugin-rpc?cacheSeconds=0)](https://www.npmjs.com/package/figma-plugin-rpc)
[![npm downloads](https://img.shields.io/npm/dm/figma-plugin-rpc?cacheSeconds=0)](https://www.npmjs.com/package/figma-plugin-rpc)
[![CI](https://github.com/denyspupin/figma-plugin-rpc/actions/workflows/ci.yml/badge.svg)](https://github.com/denyspupin/figma-plugin-rpc/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/denyspupin/figma-plugin-rpc?cacheSeconds=0)](./LICENSE)

Type-safe RPC between Figma's main thread and UI iframe. Define procedures once, get full TypeScript inference on both sides.

## Contents

- [Why?](#why)
- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [API reference](#api-reference)
- [Guides](#guides)
- [Compile-time safety](#compile-time-safety)
- [Protocol versioning](#protocol-versioning)
- [Custom transports](#custom-transports)
- [License](#license)

## Why?

Figma plugins run in two isolated contexts:

- **Main thread** — Access to `figma.*` APIs, no DOM
- **UI iframe** — Your React/Vue/Svelte app, no `figma.*` APIs

Communicating between them requires `postMessage`, which is untyped and error-prone. `figma-plugin-rpc` gives you:

- **Type-safe procedures** — Define once, full inference on both sides
- **Streaming notifications** — Server-to-client pub/sub for progress, selection changes, etc.
- **Structured errors** — Typed error codes and data with `RpcError`
- **Cancellation** — Abort in-flight calls with `AbortSignal`
- **Validation** — Pluggable runtime validation (e.g., zod)
- **Zero config** — Built-in transports work out of the box

## Features

| Feature             | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| Full type inference | Request and response types flow from schema to handlers to callers |
| Async handlers      | Return promises from handlers, await on the client                 |
| Notifications       | Fire-and-forget messages from server to client                     |
| Timeouts            | Per-call or global timeout with clear error messages               |
| Cancellation        | Stop awaiting with `AbortSignal` (client-side only)                |
| Structured errors   | Throw `RpcError` with code and data; check `instanceof` on client  |
| Runtime validation  | Validate payloads before handlers execute                          |
| Protocol decoding   | All wire messages are validated before reaching client/server      |
| Protocol versioning | Wire format includes version field for future upgrades             |

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

const { nodeIds } = await rpc.call('get-selection');

const { nodeId } = await rpc.call('create-rectangle', {
	x: 100,
	y: 100,
	width: 200,
	height: 150,
});

const unsubscribe = rpc.on('selection-changed', ({ nodeIds }) => {
	console.log('Selection changed:', nodeIds);
});

// Cleanup when done
unsubscribe();
```

## Core concepts

### Schema-first design

Everything starts with your schema. Define your procedures and notifications in a shared file, then import the types everywhere.

```ts
// rpc-schema.ts
import type { RpcProcedureSchema, RpcNotificationSchema } from 'figma-plugin-rpc';

export interface Procedures extends RpcProcedureSchema {
	// Request with payload
	'create-node': {
		request: { type: 'rectangle' | 'ellipse'; x: number; y: number };
		response: { nodeId: string };
	};

	// Request without payload (use void)
	'get-document-info': {
		request: void;
		response: { pageCount: number; selectionCount: number };
	};

	// With typed error
	'delete-node': {
		request: { nodeId: string };
		response: { success: boolean };
		error: { code: 'NODE_NOT_FOUND' | 'NODE_LOCKED'; nodeId: string };
	};
}

export interface Notifications extends RpcNotificationSchema {
	'document-changed': { type: 'selection' | 'page-switch'; data: unknown };
	progress: { operation: string; percent: number };
}
```

### Transport abstraction

The library is transport-agnostic. Built-in transports handle Figma's `postMessage` wrapping:

| Transport            | Context     | Description                                                  |
| -------------------- | ----------- | ------------------------------------------------------------ |
| `FigmaUiTransport`   | UI iframe   | Wraps messages in `{ pluginMessage: ... }` for `postMessage` |
| `FigmaMainTransport` | Main thread | Uses `figma.ui.postMessage` / `figma.ui.on('message', ...)`  |

## API reference

### Schema types

```ts
// Marker interfaces — extend these with your concrete procedures/notifications
interface RpcProcedureSchema {}
interface RpcNotificationSchema {}

// Your schema preserves literal procedure names
interface Procedures extends RpcProcedureSchema {
	'create-node': {
		request: { type: 'rectangle' | 'ellipse'; x: number; y: number };
		response: { nodeId: string };
		error?: { code: string; message: string }; // optional typed error shape
	};
}
```

> **Note:** The `error` member in a procedure definition is a type-level contract. You can extract it with `RpcProcedureError<Procedures, 'create-node'>`, but TypeScript `catch` values are always `unknown`. Use `instanceof RpcError` to narrow.

### `createRpcClient(transport, config?)`

Creates a client for the UI iframe.

```ts
import { createRpcClient, FigmaUiTransport } from 'figma-plugin-rpc';
import type { Procedures, Notifications } from './rpc-schema';

const rpc = createRpcClient<Procedures, Notifications>(new FigmaUiTransport(), {
	defaultTimeout: 60_000, // 60 seconds
	logger: console, // or custom logger
});

rpc.init();
```

**Methods:**

| Method                                | Description                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `init()`                              | Start listening for responses/notifications. Must be called before `call()`. |
| `destroy()`                           | Stop listening, reject pending requests, clear handlers.                     |
| `call(procedure, payload?, options?)` | Call a procedure, returns `Promise<response>`.                               |
| `on(notification, handler)`           | Subscribe to a notification, returns `unsubscribe()` function.               |
| `getPendingCount()`                   | Number of in-flight requests.                                                |
| `isInitialized()`                     | Whether `init()` has been called.                                            |

**Config options:**

| Option           | Type     | Default      | Description                                   |
| ---------------- | -------- | ------------ | --------------------------------------------- |
| `defaultTimeout` | `number` | `30000`      | Request timeout in milliseconds               |
| `logger`         | `Logger` | `noopLogger` | Custom logger implementing `Logger` interface |

### `createRpcServer(transport, config?)`

Creates a server for the plugin main thread.

```ts
import { createRpcServer, FigmaMainTransport } from 'figma-plugin-rpc';
import type { Procedures, Notifications } from './rpc-schema';

const rpc = createRpcServer<Procedures, Notifications>(new FigmaMainTransport(), {
	logger: console,
	onError: (procedure, error) => {
		console.error(`Error in ${procedure}:`, error);
	},
	validator: (procedure, payload) => {
		// Return RpcError to reject, void to pass
	},
});

rpc.start();
```

**Methods:**

| Method                                | Description                                                      |
| ------------------------------------- | ---------------------------------------------------------------- |
| `start()`                             | Start listening for incoming procedure calls.                    |
| `stop()`                              | Stop listening.                                                  |
| `registerHandler(procedure, handler)` | Register a handler for a procedure. Returns `this` for chaining. |
| `notify(notification, payload)`       | Send a notification to the client.                               |

**Config options:**

| Option      | Type                         | Default      | Description                                   |
| ----------- | ---------------------------- | ------------ | --------------------------------------------- |
| `logger`    | `Logger`                     | `noopLogger` | Custom logger implementing `Logger` interface |
| `onError`   | `(procedure, error) => void` | —            | Callback for unhandled errors in handlers     |
| `validator` | `RpcValidator`               | —            | Runtime validation function                   |

### `RpcError`

Structured error with code and optional data. Throw in handlers, check with `instanceof` on the client.

```ts
import { RpcError } from 'figma-plugin-rpc';

// Throw in handler
rpc.registerHandler('delete-node', ({ nodeId }) => {
	const node = figma.getNodeById(nodeId);
	if (!node) {
		throw new RpcError('NODE_NOT_FOUND', `Node ${nodeId} does not exist`, { nodeId });
	}
	node.remove();
	return { success: true };
});

// Catch on client — TypeScript catch values are `unknown`
try {
	await rpc.call('delete-node', { nodeId: '123:456' });
} catch (error) {
	if (error instanceof RpcError) {
		console.error(`Code: ${error.code}`); // 'NODE_NOT_FOUND'
		console.error(`Data:`, error.data); // { nodeId: '123:456' }
	}
}
```

## Guides

### Error handling

#### Basic error propagation

Errors thrown in handlers are automatically propagated to the client:

```ts
// Server
rpc.registerHandler('risky-operation', () => {
	if (somethingWentWrong) {
		throw new Error('Something went wrong');
	}
	return { success: true };
});

// Client
try {
	await rpc.call('risky-operation');
} catch (error) {
	console.error(error.message); // "Something went wrong"
}
```

#### Structured errors with RpcError

Use `RpcError` to throw errors with a code and optional data. Check with `instanceof` on the client:

```ts
// Server
rpc.registerHandler('delete-node', ({ nodeId }) => {
	const node = figma.getNodeById(nodeId);

	if (!node) {
		throw new RpcError('NOT_FOUND', `Node ${nodeId} does not exist`, { nodeId });
	}

	if (node.locked) {
		throw new RpcError('LOCKED', `Node ${nodeId} is locked`, { nodeId });
	}

	node.remove();
	return { success: true };
});

// Client — catch is `unknown`, narrow with instanceof
try {
	await rpc.call('delete-node', { nodeId: '123:456' });
} catch (error) {
	if (error instanceof RpcError) {
		console.error(`Error code: ${error.code}`); // 'NOT_FOUND' or 'LOCKED'
		console.error(`Error data:`, error.data); // { nodeId: '123:456' }

		if (error.code === 'NOT_FOUND') {
			showNotFoundDialog();
		}
	}
}
```

> The `error` field in your procedure schema is a type-level contract extractable with `RpcProcedureError`. At runtime, always use `instanceof RpcError` to check and `error.code` to discriminate.

#### Global error handler

Capture unhandled errors for logging or analytics:

```ts
const rpc = createRpcServer<Procedures, Notifications>(transport, {
	onError: (procedure, error) => {
		analytics.track('rpc_error', {
			procedure,
			message: error.message,
			stack: error.stack,
		});
	},
});
```

### Timeouts

#### Global timeout

Set a default timeout for all calls:

```ts
const rpc = createRpcClient<Procedures, Notifications>(transport, {
	defaultTimeout: 60_000, // 60 seconds
});
```

#### Per-call timeout

Override the timeout for specific calls:

```ts
// This call gets 2 minutes
const result = await rpc.call('export-document', payload, {
	timeout: 120_000,
});
```

#### Timeout errors

When a call times out, you get a clear error message:

```ts
try {
	await rpc.call('slow-operation');
} catch (error) {
	console.error(error.message);
	// "RPC call "slow-operation" timed out after 30s (limit: 30s)"
}
```

### Cancellation with AbortSignal

Use `AbortController` to stop awaiting a request on the client side.

> **Important:** Aborting cancels the client's wait for the response. The server handler **continues executing** — there is no server-side cancellation protocol. Use abort for UI responsiveness (e.g., superseded searches), not for stopping expensive server work.

```ts
// Create a controller
const controller = new AbortController();

// Pass the signal to the call
const promise = rpc.call('long-running-task', payload, {
	signal: controller.signal,
});

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
	await promise;
} catch (error) {
	if (error.name === 'AbortError') {
		console.log('Stopped awaiting (server may still be running)');
	}
}
```

#### React search with cancellation

```tsx
function SearchInput() {
	const [query, setQuery] = useState('');
	const [results, setResults] = useState([]);
	const abortRef = useRef<AbortController | null>(null);

	const handleSearch = useCallback(async (value: string) => {
		// Cancel previous request
		abortRef.current?.abort();

		if (!value.trim()) {
			setResults([]);
			return;
		}

		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const { items } = await rpc.call(
				'search-nodes',
				{ query: value },
				{ signal: controller.signal },
			);
			setResults(items);
		} catch (error) {
			if (error.name !== 'AbortError') {
				console.error(error);
			}
		}
	}, []);

	// Debounce search
	useEffect(() => {
		const timeout = setTimeout(() => handleSearch(query), 300);
		return () => clearTimeout(timeout);
	}, [query, handleSearch]);

	return (
		<div>
			<input value={query} onChange={(e) => setQuery(e.target.value)} />
			<ResultsList items={results} />
		</div>
	);
}
```

### Runtime validation

Validate payloads before handlers execute. Works with any validation library.

#### With Zod

```ts
import { z } from 'zod';
import { RpcError } from 'figma-plugin-rpc';

const validators = {
	'create-rectangle': z.object({
		x: z.number(),
		y: z.number(),
		width: z.number().positive(),
		height: z.number().positive(),
	}),
	'create-ellipse': z.object({
		cx: z.number(),
		cy: z.number(),
		rx: z.number().positive(),
		ry: z.number().positive(),
	}),
};

const rpc = createRpcServer<Procedures, Notifications>(transport, {
	validator: (procedure, payload) => {
		const schema = validators[procedure];
		if (!schema) return; // No validator for this procedure

		const result = schema.safeParse(payload);
		if (!result.success) {
			return new RpcError(
				'VALIDATION_ERROR',
				result.error.issues.map((i) => i.message).join(', '),
				{ issues: result.error.issues },
			);
		}
	},
});
```

### Notifications

#### Progress updates

```ts
// Server
rpc.registerHandler('process-images', async ({ imageIds }) => {
	const total = imageIds.length;

	for (let i = 0; i < total; i++) {
		await processImage(imageIds[i]);

		rpc.notify('progress', {
			operation: 'process-images',
			percent: Math.round(((i + 1) / total) * 100),
		});
	}

	return { processed: total };
});

// Client
const unsubscribe = rpc.on('progress', ({ operation, percent }) => {
	updateProgressBar(operation, percent);
});

const result = await rpc.call('process-images', { imageIds });
unsubscribe();
```

#### Selection sync

```ts
// Server — notify on selection change
figma.currentPage.on('selectionchange', () => {
	rpc.notify('selection-changed', {
		nodeIds: figma.currentPage.selection.map((n) => n.id),
	});
});

// Client — react to selection changes
rpc.on('selection-changed', ({ nodeIds }) => {
	setSelectedNodes(nodeIds);
});
```

### Logging

Enable logging for debugging:

```ts
const rpc = createRpcClient<Procedures, Notifications>(transport, {
	logger: console,
});

// Or use a custom logger
const rpc = createRpcServer<Procedures, Notifications>(transport, {
	logger: {
		log: (...args) => analytics.log('rpc', ...args),
		debug: (...args) => console.debug('[RPC]', ...args),
		warn: (...args) => console.warn('[RPC]', ...args),
		error: (...args) => sentry.captureException(...args),
	},
});
```

### Compile-time safety

The schema types preserve literal procedure and notification names. Unknown names fail at compile time:

```ts
// OK — known procedure
await rpc.call('get-selection');

// Compile error — unknown procedure
await rpc.call('typo-procedure'); // Error!

// Compile error — wrong payload type
await rpc.call('create-rectangle', { x: 'not a number' }); // Error!
```

### Protocol versioning

The wire protocol includes a version field (`v: 1`). The library:

- **Sends** version 1 on all outgoing messages
- **Accepts** messages with `v: 1` or no `v` (legacy compatibility)
- **Rejects** messages with unsupported versions (e.g., `v: 2`)

Malformed messages are silently ignored with a debug log entry.

### Custom transports

Implement `RpcTransport` to create your own transport:

```ts
import type { RpcTransport } from 'figma-plugin-rpc';

class MyTransport implements RpcTransport {
	send(message: unknown): void {
		// Send message to peer
	}

	onMessage(handler: (message: unknown) => void): () => void {
		// Register handler, return unsubscribe function
		return () => {
			// Cleanup
		};
	}
}
```

> **Security note:** `FigmaUiTransport` validates `event.source === parent` before accepting messages. Custom transports should implement equivalent source validation when receiving messages from untrusted contexts.

## License

MIT
