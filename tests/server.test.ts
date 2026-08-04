import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcServer, type RpcNotificationSchema, type RpcProcedureSchema } from '../src';
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
});
