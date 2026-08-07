import { describe, expect, it } from 'vitest';
import { isRpcNotification, isRpcRequest, isRpcResponse, PROTOCOL_VERSION } from '../src/types';

describe('PROTOCOL_VERSION', () => {
	it('is defined and equals 1', () => {
		expect(PROTOCOL_VERSION).toBe(1);
	});
});

describe('isRpcRequest', () => {
	it('returns true for valid request', () => {
		expect(
			isRpcRequest({
				__rpc: true,
				id: 'abc',
				procedure: 'test',
				payload: { foo: 'bar' },
			}),
		).toBe(true);
	});

	it('returns true for request with protocol version', () => {
		expect(
			isRpcRequest({
				__rpc: true,
				v: 1,
				id: 'abc',
				procedure: 'test',
				payload: { foo: 'bar' },
			}),
		).toBe(true);
	});

	it('returns true for request with void payload', () => {
		expect(
			isRpcRequest({
				__rpc: true,
				id: 'abc',
				procedure: 'test',
				payload: undefined,
			}),
		).toBe(true);
	});

	it('returns false for response', () => {
		expect(
			isRpcRequest({
				__rpc: true,
				id: 'abc',
				procedure: 'test',
				response: { ok: true },
			}),
		).toBe(false);
	});

	it('returns false for missing procedure', () => {
		expect(isRpcRequest({ __rpc: true, id: 'abc', payload: {} })).toBe(false);
	});

	it('returns false for missing payload', () => {
		expect(isRpcRequest({ __rpc: true, id: 'abc', procedure: 'test' })).toBe(false);
	});

	it('returns false for __rpc !== true', () => {
		expect(
			isRpcRequest({
				__rpc: false,
				id: 'abc',
				procedure: 'test',
				payload: {},
			}),
		).toBe(false);
	});

	it('returns false for null', () => {
		expect(isRpcRequest(null)).toBe(false);
	});

	it('returns false for non-object', () => {
		expect(isRpcRequest('string')).toBe(false);
		expect(isRpcRequest(42)).toBe(false);
		expect(isRpcRequest(undefined)).toBe(false);
	});
});

describe('isRpcResponse', () => {
	it('returns true for success response', () => {
		expect(
			isRpcResponse({
				__rpc: true,
				id: 'abc',
				procedure: 'test',
				response: { ok: true },
			}),
		).toBe(true);
	});

	it('returns true for response with protocol version', () => {
		expect(
			isRpcResponse({
				__rpc: true,
				v: 1,
				id: 'abc',
				procedure: 'test',
				response: { ok: true },
			}),
		).toBe(true);
	});

	it('returns true for error response', () => {
		expect(
			isRpcResponse({
				__rpc: true,
				id: 'abc',
				procedure: 'test',
				error: 'Something went wrong',
			}),
		).toBe(true);
	});

	it('returns false for request', () => {
		expect(
			isRpcResponse({
				__rpc: true,
				id: 'abc',
				procedure: 'test',
				payload: {},
			}),
		).toBe(false);
	});

	it('returns false for notification', () => {
		expect(
			isRpcResponse({
				__rpcNotification: true,
				notification: 'test',
				payload: {},
			}),
		).toBe(false);
	});

	it('returns false for response without id', () => {
		expect(
			isRpcResponse({
				__rpc: true,
				procedure: 'test',
				response: {},
			}),
		).toBe(false);
	});

	it('returns false for response without procedure', () => {
		expect(
			isRpcResponse({
				__rpc: true,
				id: 'abc',
				response: {},
			}),
		).toBe(false);
	});

	it('returns false for __rpc !== true', () => {
		expect(
			isRpcResponse({
				__rpc: false,
				id: 'abc',
				procedure: 'test',
				response: {},
			}),
		).toBe(false);
	});

	it('returns false when both response and error are present', () => {
		expect(
			isRpcResponse({
				__rpc: true,
				id: 'abc',
				procedure: 'test',
				response: { ok: true },
				error: 'Something went wrong',
			}),
		).toBe(false);
	});
});

describe('isRpcNotification', () => {
	it('returns true for valid notification', () => {
		expect(
			isRpcNotification({
				__rpcNotification: true,
				notification: 'test',
				payload: { data: 42 },
			}),
		).toBe(true);
	});

	it('returns true for notification with protocol version', () => {
		expect(
			isRpcNotification({
				__rpcNotification: true,
				v: 1,
				notification: 'test',
				payload: { data: 42 },
			}),
		).toBe(true);
	});

	it('returns false for request', () => {
		expect(
			isRpcNotification({
				__rpc: true,
				id: 'abc',
				procedure: 'test',
				payload: {},
			}),
		).toBe(false);
	});

	it('returns false for response', () => {
		expect(
			isRpcNotification({
				__rpc: true,
				id: 'abc',
				procedure: 'test',
				response: {},
			}),
		).toBe(false);
	});

	it('returns false for __rpcNotification !== true', () => {
		expect(
			isRpcNotification({
				__rpcNotification: false,
				notification: 'test',
				payload: {},
			}),
		).toBe(false);
	});

	it('returns false for null', () => {
		expect(isRpcNotification(null)).toBe(false);
	});
});
