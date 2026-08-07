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
- [Compatibility](#compatibility)
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
- **Validation** — Pluggable runtime validation (zod, valibot, or hand-written)
- **Zero config** — Built-in transports work out of the box
- **Transport-agnostic** — Swap in WebSocket, Worker, or any `postMessage` environment

## Features

| Feature             | Description                                                        |
| ------------------- | ------------------------------------------------------------------ |
| Full type inference | Request and response types flow from schema to handlers to callers |
| Async handlers      | Return promises from handlers, await on the client                 |
| Notifications       | Fire-and-forget messages from server to client                     |
| Timeouts            | Per-call or global timeout with clear error messages               |
| Cancellation        | Cancel pending calls with `AbortSignal`                            |
| Structured errors   | Throw `RpcError` with code and data, catch with type safety        |
| Runtime validation  | Validate payloads before handlers execute                          |
| Custom transports   | Implement `RpcTransport` for any messaging environment             |
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
interface RpcProcedureSchema {
	[procedureName: string]: {
		request: unknown; // Use `void` for no payload
		response: unknown;
		error?: unknown; // Optional typed error
	};
}

interface RpcNotificationSchema {
	[notificationName: string]: unknown;
}
```

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

Structured error with code and optional data.

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

// Catch on client
try {
	await rpc.call('delete-node', { nodeId: '123:456' });
} catch (error) {
	if (error instanceof RpcError) {
		console.error(`Code: ${error.code}`); // 'NODE_NOT_FOUND'
		console.error(`Data:`, error.data); // { nodeId: '123:456' }
	}
}
```

### `PROTOCOL_VERSION`

The current protocol version (currently `1`). Useful for debugging or custom transport implementations.

```ts
import { PROTOCOL_VERSION } from 'figma-plugin-rpc';
console.log(PROTOCOL_VERSION); // 1
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

For typed error handling, use `RpcError`:

```ts
// rpc-schema.ts
export interface Procedures extends RpcProcedureSchema {
	checkout: {
		request: { cartId: string };
		response: { orderId: string };
		error: { code: 'CART_EMPTY' | 'PAYMENT_FAILED'; details?: string };
	};
}

// Server
rpc.registerHandler('checkout', ({ cartId }) => {
	const cart = getCart(cartId);

	if (cart.items.length === 0) {
		throw new RpcError('CART_EMPTY', 'Cart is empty', { cartId });
	}

	const paymentResult = await processPayment(cart);
	if (!paymentResult.success) {
		throw new RpcError('PAYMENT_FAILED', 'Payment declined', {
			reason: paymentResult.declineReason,
		});
	}

	return { orderId: paymentResult.orderId };
});

// Client
try {
	const { orderId } = await rpc.call('checkout', { cartId: 'cart_123' });
	console.log('Order placed:', orderId);
} catch (error) {
	if (error instanceof RpcError) {
		switch (error.code) {
			case 'CART_EMPTY':
				showEmptyCartWarning();
				break;
			case 'PAYMENT_FAILED':
				showPaymentError(error.data?.reason);
				break;
		}
	}
}
```

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

Cancel in-flight requests using `AbortController`:

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
		console.log('Request was cancelled');
	}
}
```

#### React example with cleanup

```tsx
function DataFetcher() {
	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		const controller = new AbortController();

		async function fetchData() {
			setLoading(true);
			try {
				const result = await rpc.call(
					'fetch-data',
					{ query },
					{
						signal: controller.signal,
					},
				);
				setData(result);
			} catch (error) {
				if (error.name !== 'AbortError') {
					console.error(error);
				}
			} finally {
				setLoading(false);
			}
		}

		fetchData();

		// Cleanup: cancel request when component unmounts
		return () => controller.abort();
	}, [query]);

	return loading ? <Spinner /> : <DataView data={data} />;
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

#### With Valibot

```ts
import * as v from 'valibot';
import { RpcError } from 'figma-plugin-rpc';

const validators = {
	'create-rectangle': v.object({
		x: v.number(),
		y: v.number(),
		width: v.pipe(v.number(), v.minValue(0)),
		height: v.pipe(v.number(), v.minValue(0)),
	}),
};

const rpc = createRpcServer<Procedures, Notifications>(transport, {
	validator: (procedure, payload) => {
		const schema = validators[procedure];
		if (!schema) return;

		const result = v.safeParse(schema, payload);
		if (!result.success) {
			return new RpcError('VALIDATION_ERROR', result.issues.map((i) => i.message).join(', '));
		}
	},
});
```

#### Hand-written validator

No dependencies required:

```ts
const rpc = createRpcServer<Procedures, Notifications>(transport, {
	validator: (procedure, payload) => {
		if (procedure === 'create-rectangle') {
			const { x, y, width, height } = payload as any;

			if (typeof x !== 'number' || typeof y !== 'number') {
				return new RpcError('VALIDATION_ERROR', 'x and y must be numbers');
			}
			if (width <= 0 || height <= 0) {
				return new RpcError('VALIDATION_ERROR', 'width and height must be positive');
			}
		}
	},
});
```

### Custom transports

Implement `RpcTransport` for any messaging environment:

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
const ws = new WebSocket('wss://example.com/rpc');
const rpc = createRpcClient<Procedures, Notifications>(new WebSocketTransport(ws));
rpc.init();
```

#### Web Worker transport

```ts
class WorkerTransport implements RpcTransport {
	private handlers = new Set<(message: unknown) => void>();

	constructor(private worker: Worker) {
		worker.addEventListener('message', (event) => {
			this.handlers.forEach((h) => h(event.data));
		});
	}

	send(message: unknown): void {
		this.worker.postMessage(message);
	}

	onMessage(handler: (message: unknown) => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}
}

// In main thread
const worker = new Worker('./worker.ts');
const rpc = createRpcClient<Procedures, Notifications>(new WorkerTransport(worker));

// In worker
const rpc = createRpcServer<Procedures, Notifications>(new WorkerTransport(self as any));
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

## Compatibility

### Wire format

The 0.x wire format (messages without a version field) is fully supported. The library treats absent `v` as version 1, so old clients and servers continue to work.

### TypeScript

Requires TypeScript 5.0 or later for full type inference.

### Figma plugin typings

The built-in transports (`FigmaUiTransport`, `FigmaMainTransport`) require `@figma/plugin-typings` as a peer dependency. If you're using custom transports, this dependency is optional.

## License

MIT
