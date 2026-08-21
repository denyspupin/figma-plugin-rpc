import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcClient, type RpcNotificationSchema, type RpcProcedureSchema } from '../src';
import { TestTransport } from './test-utils';

interface TestProcedures extends RpcProcedureSchema {
	add: { request: { a: number; b: number }; response: { result: number } };
	'get-data': { request: void; response: { data: string } };
	slow: { request: void; response: { ok: boolean } };
}

interface TestNotifications extends RpcNotificationSchema {
	progress: { percent: number };
	data: { items: string[] };
}

describe('RpcClient', () => {
	let transport: TestTransport;
	let client: RpcClient<TestProcedures, TestNotifications>;

	beforeEach(() => {
		[transport] = TestTransport.createPair();
		client = new RpcClient<TestProcedures, TestNotifications>(transport);
		client.start();
	});

	afterEach(() => {
		client.stop();
	});

	it('throws if call is made before start', async () => {
		const uninitClient = new RpcClient<TestProcedures, TestNotifications>(transport);
		await expect(uninitClient.call('add', { a: 1, b: 2 })).rejects.toThrow('not initialized');
	});

	it('generates unique request ids without Web Crypto', () => {
		const ids = new Set<string>();
		for (let i = 0; i < 100; i++) {
			client.call('add', { a: 1, b: 2 }).catch(() => {});
			ids.add((transport.getLastSent() as { id: string }).id);
		}
		expect(ids.size).toBe(100);
	});

	it('sends a request message with correct shape', () => {
		client.call('add', { a: 1, b: 2 }).catch(() => {});

		expect(transport.getSentCount()).toBe(1);
		const msg = transport.getLastSent() as Record<string, unknown>;
		expect(msg.__rpc).toBe(true);
		expect(msg.procedure).toBe('add');
		expect(msg.payload).toEqual({ a: 1, b: 2 });
		expect(typeof msg.id).toBe('string');
	});

	it('resolves when matching response arrives', async () => {
		const promise = client.call('add', { a: 1, b: 2 });

		const sent = transport.getLastSent() as { id: string };
		transport.deliver({
			__rpc: true,
			id: sent.id,
			procedure: 'add',
			response: { result: 3 },
		});

		const result = await promise;
		expect(result).toEqual({ result: 3 });
	});

	it('rejects when error response arrives', async () => {
		const promise = client.call('get-data');

		const sent = transport.getLastSent() as { id: string };
		transport.deliver({
			__rpc: true,
			id: sent.id,
			procedure: 'get-data',
			error: 'Data not found',
		});

		await expect(promise).rejects.toThrow('Data not found');
	});

	it('rejects a correlated malformed response immediately', async () => {
		const promise = client.call('get-data');

		const sent = transport.getLastSent() as { id: string };
		transport.deliver({
			__rpc: true,
			id: sent.id,
			procedure: 'get-data',
			response: { data: 'ok' },
			error: 'Something went wrong',
		});

		await expect(promise).rejects.toThrow('Protocol error');
		expect(client.getPendingCount()).toBe(0);
	});

	it.each([
		['code-only response', { code: 'MISSING_ERROR' }],
		['mixed request/response', { payload: undefined, response: { data: 'ok' } }],
		[
			'conflicting RPC markers',
			{ __rpcNotification: true, notification: 'progress', response: { data: 'ok' } },
		],
	])('rejects a correlated malformed %s immediately', async (_name, malformedFields) => {
		const promise = client.call('get-data');
		const sent = transport.getLastSent() as { id: string };

		transport.deliver({
			__rpc: true,
			id: sent.id,
			procedure: 'get-data',
			...malformedFields,
		});

		await expect(promise).rejects.toThrow('Protocol error');
		expect(client.getPendingCount()).toBe(0);
	});

	it('ignores responses for unknown ids', () => {
		client.call('add', { a: 1, b: 2 }).catch(() => {});
		expect(client.getPendingCount()).toBe(1);

		transport.deliver({
			__rpc: true,
			id: 'nonexistent',
			procedure: 'add',
			response: { result: 0 },
		});

		expect(client.getPendingCount()).toBe(1);
	});

	it('rejects pending on timeout', async () => {
		vi.useFakeTimers();

		try {
			const fastClient = new RpcClient<TestProcedures, TestNotifications>(transport, {
				defaultTimeout: 100,
			});
			fastClient.start();

			const promise = fastClient.call('slow');

			vi.advanceTimersByTime(101);

			await expect(promise).rejects.toThrow(/timed out/);

			fastClient.stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it('supports per-call timeout override', async () => {
		vi.useFakeTimers();

		try {
			const promise = client.call('slow', undefined, { timeout: 50 });

			vi.advanceTimersByTime(51);
			await expect(promise).rejects.toThrow(/timed out/);
		} finally {
			vi.useRealTimers();
		}
	});

	it('clears timeout on response', async () => {
		vi.useFakeTimers();

		try {
			const promise = client.call('add', { a: 1, b: 2 });
			const sent = transport.getLastSent() as { id: string };

			transport.deliver({
				__rpc: true,
				id: sent.id,
				procedure: 'add',
				response: { result: 3 },
			});

			await expect(promise).resolves.toEqual({ result: 3 });
			expect(client.getPendingCount()).toBe(0);

			vi.advanceTimersByTime(100_000);
		} finally {
			vi.useRealTimers();
		}
	});

	it('dispatches notifications to subscribers', () => {
		const handler = vi.fn();
		client.on('progress', handler);

		transport.deliver({
			__rpcNotification: true,
			notification: 'progress',
			payload: { percent: 50 },
		});

		expect(handler).toHaveBeenCalledWith({ percent: 50 });
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('supports multiple subscribers for the same notification', () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		client.on('data', handler1);
		client.on('data', handler2);

		transport.deliver({
			__rpcNotification: true,
			notification: 'data',
			payload: { items: ['a', 'b'] },
		});

		expect(handler1).toHaveBeenCalledWith({ items: ['a', 'b'] });
		expect(handler2).toHaveBeenCalledWith({ items: ['a', 'b'] });
	});

	it('unsubscribe stops delivery', () => {
		const handler = vi.fn();
		const unsub = client.on('progress', handler);

		transport.deliver({
			__rpcNotification: true,
			notification: 'progress',
			payload: { percent: 50 },
		});
		expect(handler).toHaveBeenCalledTimes(1);

		unsub();

		transport.deliver({
			__rpcNotification: true,
			notification: 'progress',
			payload: { percent: 75 },
		});
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('does not crash when notification has no subscribers', () => {
		expect(() => {
			transport.deliver({
				__rpcNotification: true,
				notification: 'progress',
				payload: { percent: 50 },
			});
		}).not.toThrow();
	});

	it('catches handler errors without crashing', () => {
		const errorHandler = vi.fn(() => {
			throw new Error('handler error');
		});
		client.on('progress', errorHandler);

		const goodHandler = vi.fn();
		client.on('progress', goodHandler);

		transport.deliver({
			__rpcNotification: true,
			notification: 'progress',
			payload: { percent: 50 },
		});

		expect(errorHandler).toHaveBeenCalled();
		expect(goodHandler).toHaveBeenCalled();
	});

	it('stop rejects pending and clears listeners', async () => {
		const promise = client.call('add', { a: 1, b: 2 });
		client.stop();

		await expect(promise).rejects.toThrow(/stopped/);
		expect(client.getPendingCount()).toBe(0);
	});

	it('start is idempotent', () => {
		const handler = vi.fn();
		client.on('progress', handler);
		client.start();
		client.start();

		transport.deliver({
			__rpcNotification: true,
			notification: 'progress',
			payload: { percent: 50 },
		});

		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('stop is idempotent', async () => {
		client.stop();
		client.stop();
		await expect(client.call('add', { a: 1, b: 2 })).rejects.toThrow('not initialized');
	});

	it('getPendingCount tracks in-flight requests', () => {
		expect(client.getPendingCount()).toBe(0);

		client.call('add', { a: 1, b: 2 }).catch(() => {});
		expect(client.getPendingCount()).toBe(1);

		client.call('get-data').catch(() => {});
		expect(client.getPendingCount()).toBe(2);
	});

	it('stop clears notification handlers', () => {
		const handler = vi.fn();
		client.on('progress', handler);

		client.stop();
		client.start();

		transport.deliver({
			__rpcNotification: true,
			notification: 'progress',
			payload: { percent: 50 },
		});

		expect(handler).not.toHaveBeenCalled();
	});

	it('unsubscribe prunes empty handler sets', () => {
		const handler = vi.fn();
		const unsub = client.on('progress', handler);
		unsub();

		transport.deliver({
			__rpcNotification: true,
			notification: 'progress',
			payload: { percent: 50 },
		});

		expect(handler).not.toHaveBeenCalled();

		const newHandler = vi.fn();
		client.on('progress', newHandler);

		transport.deliver({
			__rpcNotification: true,
			notification: 'progress',
			payload: { percent: 75 },
		});

		expect(newHandler).toHaveBeenCalledWith({ percent: 75 });
	});

	describe('AbortSignal support', () => {
		it('rejects with AbortError when signal is aborted', async () => {
			const controller = new AbortController();
			const promise = client.call('slow', undefined, { signal: controller.signal });

			controller.abort();

			await expect(promise).rejects.toThrow(/aborted/);
			await expect(promise).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }));
			expect(client.getPendingCount()).toBe(0);
		});

		it('rejects immediately if signal is already aborted', async () => {
			const controller = new AbortController();
			controller.abort();

			const promise = client.call('slow', undefined, { signal: controller.signal });

			await expect(promise).rejects.toThrow(/aborted/);
			await expect(promise).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }));
			expect(client.getPendingCount()).toBe(0);
			expect(transport.getSentCount()).toBe(0);
		});

		it('clears timeout when aborted', async () => {
			vi.useFakeTimers();

			try {
				const controller = new AbortController();
				const promise = client.call('slow', undefined, {
					signal: controller.signal,
					timeout: 10000,
				});

				controller.abort();

				await expect(promise).rejects.toThrow(/aborted/);
				expect(client.getPendingCount()).toBe(0);

				vi.advanceTimersByTime(20000);
			} finally {
				vi.useRealTimers();
			}
		});

		it('cleans up abort listener on successful response', async () => {
			const controller = new AbortController();
			const promise = client.call('add', { a: 1, b: 2 }, { signal: controller.signal });

			const sent = transport.getLastSent() as { id: string };
			transport.deliver({
				__rpc: true,
				id: sent.id,
				procedure: 'add',
				response: { result: 3 },
			});

			await expect(promise).resolves.toEqual({ result: 3 });
			expect(client.getPendingCount()).toBe(0);

			controller.abort();
		});

		it('cleans up abort listener on error response', async () => {
			const controller = new AbortController();
			const promise = client.call('get-data', undefined, { signal: controller.signal });

			const sent = transport.getLastSent() as { id: string };
			transport.deliver({
				__rpc: true,
				id: sent.id,
				procedure: 'get-data',
				error: 'Data not found',
			});

			await expect(promise).rejects.toThrow('Data not found');
			expect(client.getPendingCount()).toBe(0);

			controller.abort();
		});

		it('cleans up abort listener on timeout', async () => {
			vi.useFakeTimers();

			try {
				const controller = new AbortController();
				const fastClient = new RpcClient<TestProcedures, TestNotifications>(transport, {
					defaultTimeout: 100,
				});
				fastClient.start();

				const promise = fastClient.call('slow', undefined, { signal: controller.signal });

				vi.advanceTimersByTime(101);

				await expect(promise).rejects.toThrow(/timed out/);
				expect(fastClient.getPendingCount()).toBe(0);

				controller.abort();

				fastClient.stop();
			} finally {
				vi.useRealTimers();
			}
		});

		it('works with void payload and signal', async () => {
			const controller = new AbortController();
			const promise = client.call('get-data', undefined, { signal: controller.signal });

			const sent = transport.getLastSent() as { id: string };
			transport.deliver({
				__rpc: true,
				id: sent.id,
				procedure: 'get-data',
				response: { data: 'test' },
			});

			await expect(promise).resolves.toEqual({ data: 'test' });
		});

		it('works with payload and signal', async () => {
			const controller = new AbortController();
			const promise = client.call('add', { a: 5, b: 3 }, { signal: controller.signal });

			const sent = transport.getLastSent() as { id: string };
			transport.deliver({
				__rpc: true,
				id: sent.id,
				procedure: 'add',
				response: { result: 8 },
			});

			await expect(promise).resolves.toEqual({ result: 8 });
		});

		it('works with timeout and signal together', async () => {
			vi.useFakeTimers();

			try {
				const controller = new AbortController();
				const promise = client.call('slow', undefined, {
					timeout: 50,
					signal: controller.signal,
				});

				vi.advanceTimersByTime(51);

				await expect(promise).rejects.toThrow(/timed out/);
			} finally {
				vi.useRealTimers();
			}
		});

		it('abort after response does not affect other requests', async () => {
			const controller1 = new AbortController();
			const controller2 = new AbortController();

			const promise1 = client.call('add', { a: 1, b: 2 }, { signal: controller1.signal });
			const promise2 = client.call('add', { a: 3, b: 4 }, { signal: controller2.signal });

			const sent1 = transport.sent[0] as { id: string };
			const sent2 = transport.sent[1] as { id: string };

			transport.deliver({
				__rpc: true,
				id: sent1.id,
				procedure: 'add',
				response: { result: 3 },
			});

			await expect(promise1).resolves.toEqual({ result: 3 });

			controller1.abort();

			transport.deliver({
				__rpc: true,
				id: sent2.id,
				procedure: 'add',
				response: { result: 7 },
			});

			await expect(promise2).resolves.toEqual({ result: 7 });
		});
	});

	describe('Structured errors', () => {
		it('rejects with RpcError when response has code', async () => {
			const promise = client.call('get-data');

			const sent = transport.getLastSent() as { id: string };
			transport.deliver({
				__rpc: true,
				id: sent.id,
				procedure: 'get-data',
				error: 'Item not found',
				code: 'NOT_FOUND',
				data: { id: 42 },
			});

			await expect(promise).rejects.toThrow('Item not found');
			await expect(promise).rejects.toThrow(
				expect.objectContaining({
					name: 'RpcError',
					code: 'NOT_FOUND',
					data: { id: 42 },
				}),
			);
		});

		it('rejects with plain Error when response has no code (back-compat)', async () => {
			const promise = client.call('get-data');

			const sent = transport.getLastSent() as { id: string };
			transport.deliver({
				__rpc: true,
				id: sent.id,
				procedure: 'get-data',
				error: 'Data not found',
			});

			await expect(promise).rejects.toThrow('Data not found');
			await expect(promise).rejects.toThrow(
				expect.objectContaining({
					name: 'Error',
				}),
			);
		});

		it('rejects with RpcError without data when data is not provided', async () => {
			const promise = client.call('get-data');

			const sent = transport.getLastSent() as { id: string };
			transport.deliver({
				__rpc: true,
				id: sent.id,
				procedure: 'get-data',
				error: 'Access denied',
				code: 'FORBIDDEN',
			});

			await expect(promise).rejects.toThrow('Access denied');
			await expect(promise).rejects.toThrow(
				expect.objectContaining({
					name: 'RpcError',
					code: 'FORBIDDEN',
				}),
			);
		});
	});

	describe('Send failure', () => {
		it('synchronous send failure rejects the promise and cleans up', async () => {
			const brokenTransport = {
				send: () => {
					throw new Error('transport broken');
				},
				onMessage: () => () => {},
			};
			const c = new RpcClient<TestProcedures, TestNotifications>(
				brokenTransport as unknown as TestTransport,
			);
			c.start();

			const promise = c.call('add', { a: 1, b: 2 });
			await expect(promise).rejects.toThrow('transport broken');
			expect(c.getPendingCount()).toBe(0);

			c.stop();
		});

		it('send failure clears the timer', async () => {
			const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
			const brokenTransport = {
				send: () => {
					throw new Error('transport broken');
				},
				onMessage: () => () => {},
			};
			const c = new RpcClient<TestProcedures, TestNotifications>(
				brokenTransport as unknown as TestTransport,
			);
			c.start();

			await c.call('add', { a: 1, b: 2 }).catch(() => {});
			expect(clearTimeoutSpy).toHaveBeenCalled();

			clearTimeoutSpy.mockRestore();
			c.stop();
		});

		it('send failure cleans up abort listener', async () => {
			const brokenTransport = {
				send: () => {
					throw new Error('transport broken');
				},
				onMessage: () => () => {},
			};
			const c = new RpcClient<TestProcedures, TestNotifications>(
				brokenTransport as unknown as TestTransport,
			);
			c.start();

			const ac = new AbortController();
			const removeSpy = vi.spyOn(ac.signal, 'removeEventListener');

			await c.call('add', { a: 1, b: 2 }, { signal: ac.signal }).catch(() => {});
			expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));

			removeSpy.mockRestore();
			c.stop();
		});
	});

	describe('Procedure correlation', () => {
		it('rejects response with mismatched procedure name', async () => {
			const promise = client.call('add', { a: 1, b: 2 });

			const sent = transport.getLastSent() as { id: string };
			transport.deliver({
				__rpc: true,
				id: sent.id,
				procedure: 'wrong-procedure',
				response: { result: 99 },
			});

			await expect(promise).rejects.toThrow('Protocol error');
			expect(client.getPendingCount()).toBe(0);
		});
	});

	it('stop clears handlers registered before start', () => {
		const [freshTransport] = TestTransport.createPair();
		const c = new RpcClient<TestProcedures, TestNotifications>(freshTransport);
		const handler = vi.fn();
		c.on('progress', handler);

		c.stop();
		c.start();
		freshTransport.deliver({
			__rpcNotification: true,
			notification: 'progress',
			payload: { percent: 50 },
		});

		expect(handler).not.toHaveBeenCalled();
		c.stop();
	});
});
