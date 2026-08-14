import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	RpcError,
	RpcServer,
	type RpcMiddleware,
	type RpcNotificationSchema,
	type RpcProcedureSchema,
} from '../src';
import { TestTransport } from './test-utils';

interface TestProcedures extends RpcProcedureSchema {
	add: { request: { a: number; b: number }; response: { result: number } };
	fail: { request: void; response: { ok: boolean } };
}

interface TestNotifications extends RpcNotificationSchema {
	update: { value: string };
}

describe('RpcServer', () => {
	let transport: TestTransport;
	let server: RpcServer<TestProcedures, TestNotifications>;

	beforeEach(() => {
		[transport] = TestTransport.createPair();
		server = new RpcServer<TestProcedures, TestNotifications>(transport);
		server.start();
	});

	afterEach(() => {
		server.stop();
	});

	it('registers handlers', () => {
		const handler = vi.fn(() => ({ result: 3 }));
		const returned = server.registerHandler('add', handler);

		expect(returned).toBe(server);
	});

	it('processes incoming requests and sends response', async () => {
		server.registerHandler('add', ({ a, b }) => ({ result: a + b }));

		transport.deliver({
			__rpc: true,
			id: 'req-1',
			procedure: 'add',
			payload: { a: 1, b: 2 },
		});

		await vi.waitFor(() => {
			expect(transport.getSentCount()).toBe(1);
		});

		const response = transport.getLastSent() as Record<string, unknown>;
		expect(response.__rpc).toBe(true);
		expect(response.id).toBe('req-1');
		expect(response.procedure).toBe('add');
		expect(response.response).toEqual({ result: 3 });
	});

	it('handles async handlers', async () => {
		server.registerHandler('add', async ({ a, b }) => {
			await new Promise((r) => setTimeout(r, 10));
			return { result: a + b };
		});

		transport.deliver({
			__rpc: true,
			id: 'req-1',
			procedure: 'add',
			payload: { a: 5, b: 10 },
		});

		await vi.waitFor(() => {
			const response = transport.getLastSent() as Record<string, unknown>;
			expect(response.response).toEqual({ result: 15 });
		});
	});

	it('sends error when handler throws', async () => {
		server.registerHandler('fail', () => {
			throw new Error('Something broke');
		});

		transport.deliver({
			__rpc: true,
			id: 'req-1',
			procedure: 'fail',
			payload: undefined,
		});

		await vi.waitFor(() => {
			expect(transport.getSentCount()).toBe(1);
		});

		const response = transport.getLastSent() as Record<string, unknown>;
		expect(response.error).toBe('Something broke');
		expect(response.id).toBe('req-1');
	});

	it('sends error for unknown procedure', async () => {
		transport.deliver({
			__rpc: true,
			id: 'req-1',
			procedure: 'nonexistent',
			payload: {},
		});

		await vi.waitFor(() => {
			expect(transport.getSentCount()).toBe(1);
		});

		const response = transport.getLastSent() as Record<string, unknown>;
		expect(response.error).toContain('Unknown procedure');
	});

	it('processes RPC messages and sends a response', async () => {
		server.registerHandler('add', () => ({ result: 0 }));

		transport.deliver({
			__rpc: true,
			id: 'req-1',
			procedure: 'add',
			payload: { a: 1, b: 2 },
		});

		await vi.waitFor(() => {
			expect(transport.getSentCount()).toBe(1);
		});
		const response = transport.getLastSent() as Record<string, unknown>;
		expect(response.response).toEqual({ result: 0 });
	});

	it('ignores non-RPC messages', async () => {
		transport.deliver({ type: 'other' });

		await new Promise((r) => setTimeout(r, 10));
		expect(transport.getSentCount()).toBe(0);
	});

	it('calls onError callback when handler throws', async () => {
		const onError = vi.fn();
		const errorServer = new RpcServer<TestProcedures, TestNotifications>(transport, {
			onError,
		});
		errorServer.registerHandler('fail', () => {
			throw new Error('oops');
		});
		errorServer.start();

		transport.deliver({
			__rpc: true,
			id: 'req-1',
			procedure: 'fail',
			payload: undefined,
		});

		await vi.waitFor(() => {
			expect(onError).toHaveBeenCalledWith('fail', expect.any(Error));
		});

		errorServer.stop();
	});

	it('notify sends a notification message', () => {
		server.notify('update', { value: 'hello' });

		expect(transport.getSentCount()).toBe(1);
		const msg = transport.getLastSent() as Record<string, unknown>;
		expect(msg.__rpcNotification).toBe(true);
		expect(msg.notification).toBe('update');
		expect(msg.payload).toEqual({ value: 'hello' });
	});

	it('start/stop are idempotent', () => {
		server.start();
		server.start();
		server.stop();
		server.stop();
	});

	it('stop prevents further message processing', async () => {
		server.stop();

		server.registerHandler('add', () => ({ result: 99 }));

		transport.deliver({
			__rpc: true,
			id: 'req-1',
			procedure: 'add',
			payload: { a: 1, b: 2 },
		});

		expect(transport.getSentCount()).toBe(0);
	});

	describe('Structured errors', () => {
		it('sends RpcError with code and data when handler throws RpcError', async () => {
			server.registerHandler('fail', () => {
				throw new RpcError('NOT_FOUND', 'Item not found', { id: 42 });
			});

			transport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'fail',
				payload: undefined,
			});

			await vi.waitFor(() => {
				expect(transport.getSentCount()).toBe(1);
			});

			const response = transport.getLastSent() as Record<string, unknown>;
			expect(response.error).toBe('Item not found');
			expect(response.code).toBe('NOT_FOUND');
			expect(response.data).toEqual({ id: 42 });
		});

		it('sends plain error when handler throws regular Error', async () => {
			server.registerHandler('fail', () => {
				throw new Error('Something broke');
			});

			transport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'fail',
				payload: undefined,
			});

			await vi.waitFor(() => {
				expect(transport.getSentCount()).toBe(1);
			});

			const response = transport.getLastSent() as Record<string, unknown>;
			expect(response.error).toBe('Something broke');
			expect(response.code).toBeUndefined();
			expect(response.data).toBeUndefined();
		});

		it('sends RpcError without data when thrown without data', async () => {
			server.registerHandler('fail', () => {
				throw new RpcError('FORBIDDEN', 'Access denied');
			});

			transport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'fail',
				payload: undefined,
			});

			await vi.waitFor(() => {
				expect(transport.getSentCount()).toBe(1);
			});

			const response = transport.getLastSent() as Record<string, unknown>;
			expect(response.error).toBe('Access denied');
			expect(response.code).toBe('FORBIDDEN');
			expect(response.data).toBeUndefined();
		});
	});

	describe('Handler safety', () => {
		it('returns a protocol error for a correlated unsupported request version', async () => {
			transport.deliver({
				__rpc: true,
				v: 2,
				id: 'req-version',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(transport.getSentCount()).toBe(1);
			});
			const response = transport.getLastSent() as Record<string, unknown>;
			expect(response.id).toBe('req-version');
			expect(response.error).toContain('unsupported protocol version');
		});

		it.each([
			['mixed request/response', { payload: { a: 1, b: 2 }, response: { result: 3 } }],
			[
				'conflicting RPC markers',
				{
					__rpcNotification: true,
					notification: 'progress',
					payload: { a: 1, b: 2 },
				},
			],
		])('returns a protocol error for a correlated %s', async (_name, malformedFields) => {
			transport.deliver({
				__rpc: true,
				id: 'req-malformed',
				procedure: 'add',
				...malformedFields,
			});

			await vi.waitFor(() => {
				expect(transport.getSentCount()).toBe(1);
			});
			const response = transport.getLastSent() as Record<string, unknown>;
			expect(response.id).toBe('req-malformed');
			expect(response.procedure).toBe('add');
			expect(response.error).toContain('Protocol error');
		});

		it('returns unknown procedure error for "toString" when not registered', async () => {
			transport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'toString',
				payload: {},
			});

			await vi.waitFor(() => {
				expect(transport.getSentCount()).toBe(1);
			});

			const response = transport.getLastSent() as Record<string, unknown>;
			expect(response.error).toContain('Unknown procedure');
		});

		it('returns unknown procedure error for "constructor" when not registered', async () => {
			transport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'constructor',
				payload: {},
			});

			await vi.waitFor(() => {
				expect(transport.getSentCount()).toBe(1);
			});

			const response = transport.getLastSent() as Record<string, unknown>;
			expect(response.error).toContain('Unknown procedure');
		});

		it('returns unknown procedure error for "__proto__" when not registered', async () => {
			transport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: '__proto__',
				payload: {},
			});

			await vi.waitFor(() => {
				expect(transport.getSentCount()).toBe(1);
			});

			const response = transport.getLastSent() as Record<string, unknown>;
			expect(response.error).toContain('Unknown procedure');
		});

		it('returns unknown procedure error for "hasOwnProperty" when not registered', async () => {
			transport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'hasOwnProperty',
				payload: {},
			});

			await vi.waitFor(() => {
				expect(transport.getSentCount()).toBe(1);
			});

			const response = transport.getLastSent() as Record<string, unknown>;
			expect(response.error).toContain('Unknown procedure');
		});
	});

	describe('Error containment', () => {
		it('handler failure is correctly serialized', async () => {
			server.registerHandler('fail', async () => {
				throw new RpcError('BOOM', 'async boom', { detail: 42 });
			});

			transport.deliver({
				__rpc: true,
				id: 'req-2',
				procedure: 'fail',
				payload: undefined,
			});

			await vi.waitFor(() => {
				expect(transport.getSentCount()).toBe(1);
			});

			const response = transport.getLastSent() as Record<string, unknown>;
			expect(response.error).toBe('async boom');
			expect(response.code).toBe('BOOM');
			expect(response.data).toEqual({ detail: 42 });
		});

		it('logger failure does not become unhandled rejection', async () => {
			const [freshTransport] = TestTransport.createPair();
			const throwingLogger = {
				log: () => {
					throw new Error('logger broken');
				},
				debug: () => {
					throw new Error('logger broken');
				},
				warn: () => {
					throw new Error('logger broken');
				},
				error: () => {
					throw new Error('logger broken');
				},
			};
			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				logger: throwingLogger,
			});
			s.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.response).toEqual({ result: 3 });

			s.stop();
		});

		it('onError callback failure does not become unhandled rejection', async () => {
			const [freshTransport] = TestTransport.createPair();
			const throwingOnError = vi.fn(() => {
				throw new Error('onError broken');
			});
			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				onError: throwingOnError,
			});
			s.registerHandler('fail', () => {
				throw new Error('handler error');
			});
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'fail',
				payload: undefined,
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			expect(throwingOnError).toHaveBeenCalledTimes(1);
			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.error).toBe('handler error');

			s.stop();
		});

		it('transport send failure during response does not become unhandled rejection', async () => {
			const listeners = new Set<(msg: unknown) => void>();
			const brokenTransport = {
				send: () => {
					throw new Error('transport broken');
				},
				onMessage: (handler: (msg: unknown) => void) => {
					listeners.add(handler);
					return () => {
						listeners.delete(handler);
					};
				},
			};
			const s = new RpcServer<TestProcedures, TestNotifications>(
				brokenTransport as unknown as TestTransport,
			);
			s.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			s.start();

			const deliver = (msg: unknown) => listeners.forEach((h) => h(msg));

			deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await new Promise((r) => setTimeout(r, 20));
			s.stop();
		});

		it('reports transport send failures through logger and onError', async () => {
			const listeners = new Set<(msg: unknown) => void>();
			const transportError = new Error('transport broken');
			const brokenTransport = {
				send: () => {
					throw transportError;
				},
				onMessage: (handler: (msg: unknown) => void) => {
					listeners.add(handler);
					return () => listeners.delete(handler);
				},
			};
			const logger = {
				log: vi.fn(),
				debug: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
			};
			const onError = vi.fn();
			const s = new RpcServer<TestProcedures, TestNotifications>(brokenTransport, {
				logger,
				onError,
			});
			s.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			s.start();

			for (const listener of listeners) {
				listener({
					__rpc: true,
					id: 'req-1',
					procedure: 'add',
					payload: { a: 1, b: 2 },
				});
			}

			await vi.waitFor(() => {
				expect(onError).toHaveBeenCalledWith('add', transportError);
			});
			expect(logger.error).toHaveBeenCalledWith(
				expect.stringContaining('Transport send failed'),
				transportError,
			);
			s.stop();
		});

		it('handler overwrite warning continues working', () => {
			const warnLogger = {
				log: () => {},
				debug: () => {},
				warn: vi.fn(),
				error: () => {},
			};
			const [freshTransport] = TestTransport.createPair();
			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				logger: warnLogger,
			});
			s.registerHandler('add', () => ({ result: 1 }));
			s.registerHandler('add', () => ({ result: 2 }));

			expect(warnLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Overwriting'));
		});
	});

	describe('Middleware', () => {
		it('executes middleware in correct order (first registered = outermost)', async () => {
			const order: string[] = [];
			const [freshTransport] = TestTransport.createPair();
			const mw1: RpcMiddleware = async (ctx) => {
				order.push('mw1-before');
				const result = await ctx.next();
				order.push('mw1-after');
				return result;
			};
			const mw2: RpcMiddleware = async (ctx) => {
				order.push('mw2-before');
				const result = await ctx.next();
				order.push('mw2-after');
				return result;
			};

			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [mw1, mw2],
			});
			s.registerHandler('add', ({ a, b }) => {
				order.push('handler');
				return { result: a + b };
			});
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			expect(order).toEqual([
				'mw1-before',
				'mw2-before',
				'handler',
				'mw2-after',
				'mw1-after',
			]);
			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.response).toEqual({ result: 3 });

			s.stop();
		});

		it('short-circuits when middleware returns without calling next', async () => {
			const handler = vi.fn(() => ({ result: 99 }));
			const [freshTransport] = TestTransport.createPair();
			const shortCircuit: RpcMiddleware = async () => {
				return { result: 0, cached: true };
			};

			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [shortCircuit],
			});
			s.registerHandler('add', handler);
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			expect(handler).not.toHaveBeenCalled();
			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.response).toEqual({ result: 0, cached: true });

			s.stop();
		});

		it('short-circuits with RpcError when middleware throws RpcError', async () => {
			const [freshTransport] = TestTransport.createPair();
			const rateLimit: RpcMiddleware = async () => {
				throw new RpcError('RATE_LIMITED', 'Too many requests', { retryAfter: 5 });
			};

			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [rateLimit],
			});
			s.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.error).toBe('Too many requests');
			expect(response.code).toBe('RATE_LIMITED');
			expect(response.data).toEqual({ retryAfter: 5 });

			s.stop();
		});

		it('sends error when middleware throws plain Error', async () => {
			const onError = vi.fn();
			const [freshTransport] = TestTransport.createPair();
			const failing: RpcMiddleware = async () => {
				throw new Error('Middleware exploded');
			};

			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [failing],
				onError,
			});
			s.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			expect(onError).toHaveBeenCalledWith('add', expect.any(Error));
			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.error).toBe('Middleware exploded');
			expect(response.code).toBeUndefined();

			s.stop();
		});

		it('transforms response via middleware', async () => {
			const [freshTransport] = TestTransport.createPair();
			const transform: RpcMiddleware = async (ctx) => {
				const result = (await ctx.next()) as { result: number };
				return { ...result, enriched: true };
			};

			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [transform],
			});
			s.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.response).toEqual({ result: 3, enriched: true });

			s.stop();
		});

		it('supports config array + .use() mix (config runs before .use())', async () => {
			const order: string[] = [];
			const [freshTransport] = TestTransport.createPair();
			const configMw: RpcMiddleware = async (ctx) => {
				order.push('config');
				return ctx.next();
			};
			const useMw: RpcMiddleware = async (ctx) => {
				order.push('use');
				return ctx.next();
			};

			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [configMw],
			});
			s.use(useMw);
			s.registerHandler('add', ({ a, b }) => {
				order.push('handler');
				return { result: a + b };
			});
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			expect(order).toEqual(['config', 'use', 'handler']);

			s.stop();
		});

		it('works with sync (non-promise) middleware', async () => {
			const [freshTransport] = TestTransport.createPair();
			const syncMw: RpcMiddleware = (ctx) => ctx.next();

			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [syncMw],
			});
			s.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.response).toEqual({ result: 3 });

			s.stop();
		});

		it('validation middleware: rejects invalid payload with RpcError', async () => {
			const [freshTransport] = TestTransport.createPair();
			const validator: RpcMiddleware = async (ctx) => {
				if (ctx.procedure === 'add') {
					const payload = ctx.payload as { a: unknown; b: unknown };
					if (typeof payload.a !== 'number' || typeof payload.b !== 'number') {
						throw new RpcError('VALIDATION', 'a and b must be numbers', {
							field: 'payload',
						});
					}
				}
				return ctx.next();
			};

			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [validator],
			});
			s.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 'not a number', b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.error).toBe('a and b must be numbers');
			expect(response.code).toBe('VALIDATION');
			expect(response.data).toEqual({ field: 'payload' });

			s.stop();
		});

		it('.use() after start() affects subsequent requests', async () => {
			const [freshTransport] = TestTransport.createPair();
			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport);
			s.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			const firstResponse = freshTransport.getLastSent() as Record<string, unknown>;
			expect(firstResponse.response).toEqual({ result: 3 });

			const mw: RpcMiddleware = async (ctx) => {
				const result = (await ctx.next()) as { result: number };
				return { result: result.result * 10 };
			};
			s.use(mw);

			freshTransport.deliver({
				__rpc: true,
				id: 'req-2',
				procedure: 'add',
				payload: { a: 2, b: 3 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(2);
			});

			const secondResponse = freshTransport.getLastSent() as Record<string, unknown>;
			expect(secondResponse.response).toEqual({ result: 50 });

			s.stop();
		});

		it('error normalization: middleware catches handler error and transforms it', async () => {
			const [freshTransport] = TestTransport.createPair();
			const normalize: RpcMiddleware = async (ctx) => {
				try {
					return await ctx.next();
				} catch {
					throw new RpcError('INTERNAL', 'Something went wrong', { sanitized: true });
				}
			};

			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [normalize],
			});
			s.registerHandler('fail', () => {
				throw new Error('sensitive internal error message');
			});
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'fail',
				payload: undefined,
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.error).toBe('Something went wrong');
			expect(response.code).toBe('INTERNAL');
			expect(response.data).toEqual({ sanitized: true });

			s.stop();
		});

		it('short-circuit stops the chain (inner middleware never runs)', async () => {
			const order: string[] = [];
			const [freshTransport] = TestTransport.createPair();
			const mw1: RpcMiddleware = async (ctx) => {
				order.push('mw1-before');
				const result = await ctx.next();
				order.push('mw1-after');
				return result;
			};
			const mw2: RpcMiddleware = async () => {
				order.push('mw2-before');
				return { result: -1, intercepted: true };
			};
			const mw3: RpcMiddleware = async (ctx) => {
				order.push('mw3-before');
				const result = await ctx.next();
				order.push('mw3-after');
				return result;
			};

			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [mw1, mw2, mw3],
			});
			s.registerHandler('add', ({ a, b }) => {
				order.push('handler');
				return { result: a + b };
			});
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			expect(order).toEqual(['mw1-before', 'mw2-before', 'mw1-after']);
			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.response).toEqual({ result: -1, intercepted: true });

			s.stop();
		});

		it('middleware does async work before and after next() (timing pattern)', async () => {
			const timings: Record<string, { before: number; after: number; duration: number }> = {};
			const [freshTransport] = TestTransport.createPair();
			const timing: RpcMiddleware = async (ctx) => {
				const before = Date.now();
				await new Promise((r) => setTimeout(r, 10));
				const result = await ctx.next();
				await new Promise((r) => setTimeout(r, 10));
				const after = Date.now();
				timings[ctx.procedure] = { before, after, duration: after - before };
				return result;
			};

			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [timing],
			});
			s.registerHandler('add', async ({ a, b }) => {
				await new Promise((r) => setTimeout(r, 15));
				return { result: a + b };
			});
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			expect(timings['add']).toBeDefined();
			expect(timings['add'].duration).toBeGreaterThanOrEqual(30);
			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.response).toEqual({ result: 3 });

			s.stop();
		});

		it('empty middleware array works (regression)', async () => {
			const [freshTransport] = TestTransport.createPair();
			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				middleware: [],
			});
			s.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			s.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.response).toEqual({ result: 3 });

			s.stop();
		});
	});
});
