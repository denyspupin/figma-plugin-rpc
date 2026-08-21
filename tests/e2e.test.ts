import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	RpcClient,
	RpcError,
	RpcServer,
	type RpcNotificationSchema,
	type RpcProcedureSchema,
} from '../src';
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
		client.start();
		server.start();
	});

	afterEach(() => {
		client.stop();
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

		try {
			server.registerHandler('slow', async () => {
				await new Promise((r) => setTimeout(r, 10000));
				return { ok: true };
			});

			const promise = client.call('slow', undefined, { timeout: 100 });

			vi.advanceTimersByTime(101);

			await expect(promise).rejects.toThrow(/timed out/);
		} finally {
			vi.useRealTimers();
		}
	});

	it('rejects calls to schema-defined procedures with no registered handler', async () => {
		const promise = client.call('fail');

		await expect(promise).rejects.toThrow(/Unknown procedure/);
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

	it('cleans up properly on client stop', async () => {
		server.registerHandler('add', ({ a, b }) => ({ result: a + b }));

		const result = await client.call('add', { a: 1, b: 2 });
		expect(result).toEqual({ result: 3 });

		client.stop();

		await expect(client.call('add', { a: 3, b: 4 })).rejects.toThrow('not initialized');
	});

	it('cleans up properly on server stop', async () => {
		server.registerHandler('add', ({ a, b }) => ({ result: a + b }));

		const result = await client.call('add', { a: 1, b: 2 });
		expect(result).toEqual({ result: 3 });

		server.stop();

		vi.useFakeTimers();
		try {
			const promise = client.call('add', { a: 3, b: 4 });
			vi.advanceTimersByTime(30001);
			await expect(promise).rejects.toThrow(/timed out/);
		} finally {
			vi.useRealTimers();
		}
	});

	describe('Structured errors', () => {
		it('propagates RpcError from server to client with code and data', async () => {
			server.registerHandler('fail', () => {
				throw new RpcError('VALIDATION', 'Invalid input', { field: 'email' });
			});

			try {
				await client.call('fail');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RpcError);
				const rpcError = error as RpcError;
				expect(rpcError.code).toBe('VALIDATION');
				expect(rpcError.message).toBe('Invalid input');
				expect(rpcError.data).toEqual({ field: 'email' });
			}
		});

		it('propagates plain Error as plain Error (back-compat)', async () => {
			server.registerHandler('fail', () => {
				throw new Error('Something went wrong');
			});

			try {
				await client.call('fail');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect(error).not.toBeInstanceOf(RpcError);
				expect((error as Error).message).toBe('Something went wrong');
			}
		});

		it('propagates RpcError without data', async () => {
			server.registerHandler('fail', () => {
				throw new RpcError('FORBIDDEN', 'Access denied');
			});

			try {
				await client.call('fail');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(RpcError);
				const rpcError = error as RpcError;
				expect(rpcError.code).toBe('FORBIDDEN');
				expect(rpcError.message).toBe('Access denied');
				expect(rpcError.data).toBeUndefined();
			}
		});
	});
});
