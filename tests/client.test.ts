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
		client.init();
	});

	afterEach(() => {
		client.destroy();
	});

	it('throws if call is made before init', async () => {
		const uninitClient = new RpcClient<TestProcedures, TestNotifications>(transport);
		await expect(uninitClient.call('add', { a: 1, b: 2 })).rejects.toThrow('not initialized');
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

		const fastClient = new RpcClient<TestProcedures, TestNotifications>(transport, {
			defaultTimeout: 100,
		});
		fastClient.init();

		const promise = fastClient.call('slow');

		vi.advanceTimersByTime(101);

		await expect(promise).rejects.toThrow(/timed out/);

		fastClient.destroy();
		vi.useRealTimers();
	});

	it('supports per-call timeout override', async () => {
		vi.useFakeTimers();

		const promise = client.call('slow', undefined, { timeout: 50 });

		vi.advanceTimersByTime(51);
		await expect(promise).rejects.toThrow(/timed out/);

		vi.useRealTimers();
	});

	it('clears timeout on response', async () => {
		vi.useFakeTimers();

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

		vi.useRealTimers();
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

	it('destroys: rejects pending and clears listeners', async () => {
		const promise = client.call('add', { a: 1, b: 2 });
		client.destroy();

		await expect(promise).rejects.toThrow(/destroyed/);
		expect(client.getPendingCount()).toBe(0);
		expect(client.isInitialized()).toBe(false);
	});

	it('init is idempotent', () => {
		client.init();
		client.init();
		expect(client.isInitialized()).toBe(true);
	});

	it('destroy is idempotent', () => {
		client.destroy();
		client.destroy();
		expect(client.isInitialized()).toBe(false);
	});

	it('getPendingCount tracks in-flight requests', () => {
		expect(client.getPendingCount()).toBe(0);

		client.call('add', { a: 1, b: 2 }).catch(() => {});
		expect(client.getPendingCount()).toBe(1);

		client.call('get-data').catch(() => {});
		expect(client.getPendingCount()).toBe(2);
	});
});
