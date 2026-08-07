# figma-plugin-rpc

[![npm version](https://img.shields.io/npm/v/figma-plugin-rpc?cacheSeconds=0)](https://www.npmjs.com/package/figma-plugin-rpc)
[![npm downloads](https://img.shields.io/npm/dm/figma-plugin-rpc?cacheSeconds=0)](https://www.npmjs.com/package/figma-plugin-rpc)
[![CI](https://github.com/denyspupin/figma-plugin-rpc/actions/workflows/ci.yml/badge.svg)](https://github.com/denyspupin/figma-plugin-rpc/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/denyspupin/figma-plugin-rpc?cacheSeconds=0)](./LICENSE)

> Type-safe RPC for Figma plugins — request/response procedures and server→client notifications over postMessage, with built-in Figma transports.

A transport-agnostic, schema-driven RPC layer for Figma plugins. Provides typed request/response procedures and streaming notifications between the plugin main thread and the UI iframe, with built-in Figma transports and pluggable transports for any `postMessage` environment.

## Features

- **Type-safe** — Define your procedure & notification schema once, get full type inference on both sides
- **Transport-agnostic** — Core is decoupled from the transport layer; swap implementations freely
- **Built-in Figma adapters** — `FigmaUiTransport` and `FigmaMainTransport` work out of the box
- **Request/response procedures** — with per-call timeouts and error propagation
- **Server→client notifications** — pub/sub pattern with typed payloads (enables streaming RPC)
- **Zero runtime deps** — only `nanoid` for request correlation
- **Dual ESM/CJS** — ships both module formats with TypeScript declarations

## Install

```bash
npm install figma-plugin-rpc
```

`@figma/plugin-typings` is an optional peer dependency (only needed when using `FigmaUiTransport` / `FigmaMainTransport`).

## Quick start

### 1. Define your schema (shared between main & UI)

```ts
import type { RpcProcedureSchema, RpcNotificationSchema } from 'figma-plugin-rpc';

export interface MyProcedures extends RpcProcedureSchema {
	'get-variables': {
		request: void;
		response: { variables: { id: string; name: string }[] };
	};
	'variableSearch.start': {
		request: { variableId: string };
		response: { started: boolean };
	};
}

export interface MyNotifications extends RpcNotificationSchema {
	'variableSearch.results': {
		searchId: string;
		results: { nodeId: string }[];
		isComplete: boolean;
	};
}
```

### 2. UI side (iframe)

```ts
import { createRpcClient, FigmaUiTransport } from 'figma-plugin-rpc';
import type { MyProcedures, MyNotifications } from './shared';

const rpc = createRpcClient<MyProcedures, MyNotifications>(new FigmaUiTransport());
rpc.init();

const { variables } = await rpc.call('get-variables');

rpc.on('variableSearch.results', (payload) => {
	console.log(payload.results, payload.isComplete);
});

await rpc.call('variableSearch.start', { variableId: 'v1' });
```

### 3. Main side (plugin thread)

```ts
import { createRpcServer, FigmaMainTransport } from 'figma-plugin-rpc';
import type { MyProcedures, MyNotifications } from './shared';

const rpc = createRpcServer<MyProcedures, MyNotifications>(new FigmaMainTransport());

rpc.registerHandler('get-variables', () => {
	return { variables: [{ id: 'v1', name: 'Color/Primary' }] };
});

rpc.registerHandler('variableSearch.start', (payload) => {
	rpc.notify('variableSearch.results', {
		searchId: payload.variableId,
		results: [],
		isComplete: true,
	});
	return { started: true };
});

rpc.start();
```

## API

### `RpcTransport` interface

```ts
interface RpcTransport {
	send(message: unknown): void;
	onMessage(handler: (message: unknown) => void): () => void;
}
```

The core is transport-agnostic. Implement this interface to support any message-passing environment.

### `FigmaUiTransport`

For the UI iframe. Wraps messages in `{ pluginMessage: ... }` on send, unwraps on receive.

### `FigmaMainTransport`

For the plugin main thread. Uses `figma.ui.postMessage` on send, `figma.ui.onmessage` on receive. Multiplexes multiple subscribers over Figma's single-callback `onmessage` API. Forwards messages to any pre-existing `onmessage` handler that was set before the transport was created.

### `RpcClient<Procedures, Notifications>`

| Method                                | Description                                                          |
| ------------------------------------- | -------------------------------------------------------------------- |
| `init()`                              | Start listening for responses/notifications                          |
| `destroy()`                           | Stop listening, reject pending requests, clear notification handlers |
| `call(procedure, payload?, options?)` | Call a procedure, returns `Promise<response>`                        |
| `on(notification, handler)`           | Subscribe to a notification, returns `unsubscribe()`                 |
| `getPendingCount()`                   | Number of in-flight requests                                         |
| `isInitialized()`                     | Whether `init()` has been called                                     |

### `RpcServer<Procedures, Notifications>`

| Method                                | Description                                                       |
| ------------------------------------- | ----------------------------------------------------------------- |
| `start()`                             | Start listening for incoming procedure calls                      |
| `stop()`                              | Stop listening                                                    |
| `registerHandler(procedure, handler)` | Register a handler for a procedure                                |
| `notify(notification, payload)`       | Send a notification to the client                                 |
| `processMessage(msg)`                 | Manually feed a message (returns `true` if it was an RPC request) |

## Custom transports

```ts
import type { RpcTransport } from 'figma-plugin-rpc';

class WebSocketTransport implements RpcTransport {
	// ...
}

const rpc = createRpcClient(new WebSocketTransport(ws));
```

## License

MIT
