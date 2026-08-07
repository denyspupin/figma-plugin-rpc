import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcClient, RpcServer, type RpcNotificationSchema, type RpcProcedureSchema } from '../src';
import { TestTransport } from './test-utils';

interface TestProcedures extends RpcProcedureSchema {
	add: { request: { a: number; b: number }; response: { result: number } };
	'get-data': { request: void; response: { data: string } };
	fail: { request: void; response: { ok: boolean } };
	slow: { request: void; response: { ok: boolean } };
}

interface TestNotifications extends RpcNotificationSchema {
	progress: { percent: number };
	'data-update': { items: string[] };
}

describe('E2E: RpcClient + RpcServer', () => {
	let clientTransport: TestTransport;
	let serverTransport: TestTransport;
	let client: RpcClient<TestProcedures, TestNotifications>;
	let server: RpcServer<TestProcedures, TestNotifications>;

	beforeEach(() => {
		[clientTransport, serverTransport] = TestTransport.createPair();
		client = new RpcClient<TestProcedures, TestNotifications>(clientTransport);
		server = new RpcServer<TestProcedures, TestNotifications>(serverTransport);
		client.init();
		server.start();
	});

	afterEach(() => {
		client.destroy();
		server.stop();
	});

	it('handles call/response correctly', async () => {
		server.registerHandler('add', ({ a, b }) => ({ result: a + b }));

		const result = await client.call('add', { a: 5, b: 7 });

		expect(result).toEqual({ result: 12 });
	});

	it('handles void request payload', async () => {
		server.registerHandler('get-data', () => ({ data: 'hello world' }));

		const result = await client.call('get-data');

		expect(result).toEqual({ data: 'hello world' });
	});

	it('propagates errors from server to client', async () => {
		server.registerHandler('fail', () => {
			throw new Error('Something went wrong');
		});

		await expect(client.call('fail')).rejects.toThrow('Something went wrong');
	});

	it('handles async handlers', async () => {
		server.registerHandler('add', async ({ a, b }) => {
			await new Promise((r) => setTimeout(r, 10));
			return { result: a + b };
		});

		const result = await client.call('add', { a: 3, b: 4 });

		expect(result).toEqual({ result: 7 });
	});

	it('handles server notifications', async () => {
		const handler = vi.fn();
		client.on('progress', handler);

		server.notify('progress', { percent: 50 });

		await vi.waitFor(() => {
			expect(handler).toHaveBeenCalledWith({ percent: 50 });
		});
	});

	it('handles multiple notifications', async () => {
		const progressHandler = vi.fn();
		const dataHandler = vi.fn();
		client.on('progress', progressHandler);
		client.on('data-update', dataHandler);

		server.notify('progress', { percent: 25 });
		server.notify('data-update', { items: ['a', 'b'] });
		server.notify('progress', { percent: 75 });

		await vi.waitFor(() => {
			expect(progressHandler).toHaveBeenCalledTimes(2);
			expect(progressHandler).toHaveBeenLastCalledWith({ percent: 75 });
			expect(dataHandler).toHaveBeenCalledWith({ items: ['a', 'b'] });
		});
	});

	it('handles timeout correctly', async () => {
		vi.useFakeTimers();

		server.registerHandler('slow', async () => {
			await new Promise((r) => setTimeout(r, 10000));
			return { ok: true };
		});

		const promise = client.call('slow', undefined, { timeout: 100 });

		vi.advanceTimersByTime(101);

		await expect(promise).rejects.toThrow(/timed out/);

		vi.useRealTimers();
	});

	it('handles unknown procedure on server', async () => {
		server.registerHandler('add', () => ({ result: 0 }));

		const promise = client.call('add', { a: 1, b: 2 });

		const result = await promise;
		expect(result).toEqual({ result: 0 });
	});

	it('handles concurrent calls', async () => {
		server.registerHandler('add', async ({ a, b }) => {
			await new Promise((r) => setTimeout(r, 10));
			return { result: a + b };
		});

		const [r1, r2, r3] = await Promise.all([
			client.call('add', { a: 1, b: 2 }),
			client.call('add', { a: 3, b: 4 }),
			client.call('add', { a: 5, b: 6 }),
		]);

		expect(r1).toEqual({ result: 3 });
		expect(r2).toEqual({ result: 7 });
		expect(r3).toEqual({ result: 11 });
	});

	it('cleans up properly on destroy', async () => {
		server.registerHandler('add', ({ a, b }) => ({ result: a + b }));

		const result = await client.call('add', { a: 1, b: 2 });
		expect(result).toEqual({ result: 3 });

		client.destroy();

		await expect(client.call('add', { a: 3, b: 4 })).rejects.toThrow('not initialized');
	});

	it('cleans up properly on server stop', async () => {
		server.registerHandler('add', ({ a, b }) => ({ result: a + b }));

		const result = await client.call('add', { a: 1, b: 2 });
		expect(result).toEqual({ result: 3 });

		server.stop();

		vi.useFakeTimers();
		const promise = client.call('add', { a: 3, b: 4 });
		vi.advanceTimersByTime(30001);
		await expect(promise).rejects.toThrow(/timed out/);
		vi.useRealTimers();
	});
});
