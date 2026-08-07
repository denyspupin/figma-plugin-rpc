import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RpcError, RpcServer, type RpcNotificationSchema, type RpcProcedureSchema } from '../src';
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
		it('thrown validator invokes onError exactly once', async () => {
			const onError = vi.fn();
			const [freshTransport] = TestTransport.createPair();
			const validator = vi.fn(() => {
				throw new Error('validator exploded');
			});
			const s = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				validator,
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

			expect(onError).toHaveBeenCalledTimes(1);
			expect(onError).toHaveBeenCalledWith('add', expect.any(Error));
			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.error).toBe('validator exploded');

			s.stop();
		});

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

	describe('Validator', () => {
		it('calls validator before handler and proceeds when valid', async () => {
			const [freshTransport] = TestTransport.createPair();
			const validator = vi.fn(() => undefined);
			const validServer = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				validator,
			});
			validServer.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			validServer.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 1, b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			expect(validator).toHaveBeenCalledWith('add', { a: 1, b: 2 });
			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.response).toEqual({ result: 3 });

			validServer.stop();
		});

		it('rejects with RpcError when validator returns error', async () => {
			const [freshTransport] = TestTransport.createPair();
			const validator = vi.fn(
				() => new RpcError('VALIDATION', 'Invalid payload', { field: 'a' }),
			);
			const validServer = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				validator,
			});
			validServer.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			validServer.start();

			freshTransport.deliver({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: { a: 'not a number', b: 2 },
			});

			await vi.waitFor(() => {
				expect(freshTransport.getSentCount()).toBe(1);
			});

			expect(validator).toHaveBeenCalledWith('add', { a: 'not a number', b: 2 });
			const response = freshTransport.getLastSent() as Record<string, unknown>;
			expect(response.error).toBe('Invalid payload');
			expect(response.code).toBe('VALIDATION');
			expect(response.data).toEqual({ field: 'a' });

			validServer.stop();
		});

		it('does not call handler when validation fails', async () => {
			const [freshTransport] = TestTransport.createPair();
			const handler = vi.fn(() => ({ result: 0 }));
			const validator = vi.fn(() => new RpcError('VALIDATION', 'Invalid'));
			const validServer = new RpcServer<TestProcedures, TestNotifications>(freshTransport, {
				validator,
			});
			validServer.registerHandler('add', handler);
			validServer.start();

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

			validServer.stop();
		});

		it('works without validator (no validation)', async () => {
			const [freshTransport] = TestTransport.createPair();
			const noValidatorServer = new RpcServer<TestProcedures, TestNotifications>(
				freshTransport,
			);
			noValidatorServer.registerHandler('add', ({ a, b }) => ({ result: a + b }));
			noValidatorServer.start();

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

			noValidatorServer.stop();
		});
	});
});
