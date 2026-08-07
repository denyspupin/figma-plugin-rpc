import { describe, expect, it } from 'vitest';
import {
	decodeRpcMessage,
	isValidRpcNotification,
	isValidRpcRequest,
	isValidRpcResponse,
} from '../src/protocol';

describe('decodeRpcMessage', () => {
	describe('non-object inputs', () => {
		it('rejects null', () => {
			const result = decodeRpcMessage(null);
			expect(result.ok).toBe(false);
		});

		it('rejects undefined', () => {
			expect(decodeRpcMessage(undefined).ok).toBe(false);
		});

		it('rejects numbers', () => {
			expect(decodeRpcMessage(42).ok).toBe(false);
		});

		it('rejects strings', () => {
			expect(decodeRpcMessage('hello').ok).toBe(false);
		});

		it('rejects booleans', () => {
			expect(decodeRpcMessage(true).ok).toBe(false);
		});

		it('rejects arrays', () => {
			expect(decodeRpcMessage([]).ok).toBe(false);
		});

		it('rejects functions', () => {
			expect(decodeRpcMessage(() => {}).ok).toBe(false);
		});
	});

	describe('request decoding', () => {
		const validRequest = {
			__rpc: true,
			id: 'req-1',
			procedure: 'add',
			payload: { a: 1, b: 2 },
		};

		it('decodes a valid version-1 request', () => {
			const result = decodeRpcMessage({ ...validRequest, v: 1 });
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.kind).toBe('request');
				if (result.value.kind === 'request') {
					expect(result.value.id).toBe('req-1');
					expect(result.value.procedure).toBe('add');
					expect(result.value.payload).toEqual({ a: 1, b: 2 });
					expect(result.value.version).toBe(1);
				}
			}
		});

		it('decodes a legacy request without v', () => {
			const result = decodeRpcMessage(validRequest);
			expect(result.ok).toBe(true);
			if (result.ok && result.value.kind === 'request') {
				expect(result.value.version).toBe(1);
			}
		});

		it('accepts payload set to undefined', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				payload: undefined,
			});
			expect(result.ok).toBe(true);
		});

		it('rejects missing id', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				procedure: 'add',
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		it('rejects empty string id', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: '',
				procedure: 'add',
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		it('rejects non-string id', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: 123,
				procedure: 'add',
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		it('rejects missing procedure', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: 'req-1',
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		it('rejects empty string procedure', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: 'req-1',
				procedure: '',
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		it('rejects missing payload property', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
			});
			expect(result.ok).toBe(false);
		});

		it('rejects unsupported version', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				v: 99,
				id: 'req-1',
				procedure: 'add',
				payload: {},
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.reason).toContain('unsupported protocol version');
				expect(result.error.correlation).toEqual({
					kind: 'request',
					id: 'req-1',
					procedure: 'add',
				});
			}
		});

		it('rejects non-number version', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				v: '1',
				id: 'req-1',
				procedure: 'add',
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		it('rejects NaN version', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				v: NaN,
				id: 'req-1',
				procedure: 'add',
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		it('rejects Infinity version', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				v: Infinity,
				id: 'req-1',
				procedure: 'add',
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		it('rejects inherited properties (id from prototype)', () => {
			const proto = { id: 'inherited-id', procedure: 'inherited-proc', payload: {} };
			const msg = Object.create(proto);
			msg.__rpc = true;
			const result = decodeRpcMessage(msg);
			expect(result.ok).toBe(false);
		});
	});

	describe('response decoding', () => {
		const validSuccessResponse = {
			__rpc: true,
			id: 'req-1',
			procedure: 'add',
			response: { result: 3 },
		};

		const validErrorResponse = {
			__rpc: true,
			id: 'req-1',
			procedure: 'add',
			error: 'Something failed',
		};

		it('decodes a valid success response', () => {
			const result = decodeRpcMessage({ ...validSuccessResponse, v: 1 });
			expect(result.ok).toBe(true);
			if (result.ok && result.value.kind === 'response') {
				expect(result.value.success).toBe(true);
				expect(result.value.response).toEqual({ result: 3 });
				expect(result.value.id).toBe('req-1');
				expect(result.value.procedure).toBe('add');
			}
		});

		it('decodes a valid error response', () => {
			const result = decodeRpcMessage({ ...validErrorResponse, v: 1 });
			expect(result.ok).toBe(true);
			if (result.ok && result.value.kind === 'response') {
				expect(result.value.success).toBe(false);
				expect(result.value.error).toBe('Something failed');
			}
		});

		it('decodes legacy response without v', () => {
			const result = decodeRpcMessage(validSuccessResponse);
			expect(result.ok).toBe(true);
		});

		it('decodes error response with code and data', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				error: 'Not found',
				code: 'NOT_FOUND',
				data: { id: 42 },
			});
			expect(result.ok).toBe(true);
			if (result.ok && result.value.kind === 'response') {
				expect(result.value.code).toBe('NOT_FOUND');
				expect(result.value.data).toEqual({ id: 42 });
			}
		});

		it('rejects both response and error present', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				response: { result: 3 },
				error: 'Something failed',
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.reason).toContain('both');
				expect(result.error.correlation).toEqual({
					kind: 'response',
					id: 'req-1',
					procedure: 'add',
				});
			}
		});

		it('rejects error-only fields on success responses', () => {
			expect(
				decodeRpcMessage({
					__rpc: true,
					id: 'req-1',
					procedure: 'add',
					response: { result: 3 },
					code: 'UNEXPECTED',
				}).ok,
			).toBe(false);
		});

		it('rejects neither response nor error present', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
			});
			expect(result.ok).toBe(false);
		});

		it('rejects non-string error', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				error: 123,
			});
			expect(result.ok).toBe(false);
		});

		it('rejects non-string code', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: 'req-1',
				procedure: 'add',
				error: 'fail',
				code: 123,
			});
			expect(result.ok).toBe(false);
		});

		it('rejects missing id', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				procedure: 'add',
				response: { result: 3 },
			});
			expect(result.ok).toBe(false);
		});

		it('rejects empty string id', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: '',
				procedure: 'add',
				response: { result: 3 },
			});
			expect(result.ok).toBe(false);
		});

		it('rejects missing procedure', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				id: 'req-1',
				response: { result: 3 },
			});
			expect(result.ok).toBe(false);
		});

		it('rejects unsupported version', () => {
			const result = decodeRpcMessage({
				__rpc: true,
				v: 2,
				id: 'req-1',
				procedure: 'add',
				response: { result: 3 },
			});
			expect(result.ok).toBe(false);
		});

		it('rejects inherited properties', () => {
			const proto = { id: 'inherited-id', procedure: 'inherited-proc', response: 'ok' };
			const msg = Object.create(proto);
			msg.__rpc = true;
			const result = decodeRpcMessage(msg);
			expect(result.ok).toBe(false);
		});
	});

	describe('notification decoding', () => {
		const validNotification = {
			__rpcNotification: true,
			notification: 'update',
			payload: { value: 'hello' },
		};

		it('decodes a valid version-1 notification', () => {
			const result = decodeRpcMessage({ ...validNotification, v: 1 });
			expect(result.ok).toBe(true);
			if (result.ok && result.value.kind === 'notification') {
				expect(result.value.notification).toBe('update');
				expect(result.value.payload).toEqual({ value: 'hello' });
				expect(result.value.version).toBe(1);
			}
		});

		it('decodes a legacy notification without v', () => {
			const result = decodeRpcMessage(validNotification);
			expect(result.ok).toBe(true);
		});

		it('accepts payload set to undefined', () => {
			const result = decodeRpcMessage({
				__rpcNotification: true,
				notification: 'update',
				payload: undefined,
			});
			expect(result.ok).toBe(true);
		});

		it('rejects missing notification name', () => {
			const result = decodeRpcMessage({
				__rpcNotification: true,
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		it('rejects empty string notification name', () => {
			const result = decodeRpcMessage({
				__rpcNotification: true,
				notification: '',
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		it('rejects missing payload property', () => {
			const result = decodeRpcMessage({
				__rpcNotification: true,
				notification: 'update',
			});
			expect(result.ok).toBe(false);
		});

		it('rejects unsupported version', () => {
			const result = decodeRpcMessage({
				__rpcNotification: true,
				v: 2,
				notification: 'update',
				payload: {},
			});
			expect(result.ok).toBe(false);
		});

		it('rejects inherited properties', () => {
			const proto = { notification: 'inherited', payload: {} };
			const msg = Object.create(proto);
			msg.__rpcNotification = true;
			const result = decodeRpcMessage(msg);
			expect(result.ok).toBe(false);
		});
	});

	describe('unrecognized messages', () => {
		it('rejects conflicting RPC markers', () => {
			const message = {
				__rpc: true,
				__rpcNotification: true,
				id: '1',
				procedure: 'add',
				notification: 'update',
				payload: {},
			};

			expect(decodeRpcMessage(message).ok).toBe(false);
			expect(isValidRpcRequest(message)).toBe(false);
			expect(isValidRpcNotification(message)).toBe(false);
		});

		it('rejects mixed request and response fields', () => {
			const message = {
				__rpc: true,
				id: '1',
				procedure: 'add',
				payload: {},
				response: {},
			};

			expect(decodeRpcMessage(message).ok).toBe(false);
			expect(isValidRpcRequest(message)).toBe(false);
			expect(isValidRpcResponse(message)).toBe(false);
		});

		it('rejects empty object', () => {
			expect(decodeRpcMessage({}).ok).toBe(false);
		});

		it('rejects object with __rpc false', () => {
			expect(
				decodeRpcMessage({ __rpc: false, id: '1', procedure: 'x', payload: {} }).ok,
			).toBe(false);
		});

		it('rejects object with __rpcNotification false', () => {
			expect(
				decodeRpcMessage({ __rpcNotification: false, notification: 'x', payload: {} }).ok,
			).toBe(false);
		});

		it('rejects __rpc without procedure or response/error', () => {
			expect(decodeRpcMessage({ __rpc: true, id: '1' }).ok).toBe(false);
		});
	});
});

describe('isValidRpcRequest', () => {
	it('returns true for valid request', () => {
		expect(
			isValidRpcRequest({ __rpc: true, id: '1', procedure: 'x', payload: undefined }),
		).toBe(true);
	});

	it('returns false for response', () => {
		expect(isValidRpcRequest({ __rpc: true, id: '1', procedure: 'x', response: 'ok' })).toBe(
			false,
		);
	});

	it('returns false for notification', () => {
		expect(
			isValidRpcRequest({ __rpcNotification: true, notification: 'x', payload: undefined }),
		).toBe(false);
	});

	it('returns false for null', () => {
		expect(isValidRpcRequest(null)).toBe(false);
	});

	it('returns false for missing payload', () => {
		expect(isValidRpcRequest({ __rpc: true, id: '1', procedure: 'x' })).toBe(false);
	});

	it('returns false for unsupported version', () => {
		expect(
			isValidRpcRequest({ __rpc: true, v: 2, id: '1', procedure: 'x', payload: undefined }),
		).toBe(false);
	});

	it('returns false for inherited properties', () => {
		const proto = { id: '1', procedure: 'x', payload: undefined };
		const msg = Object.create(proto);
		msg.__rpc = true;
		expect(isValidRpcRequest(msg)).toBe(false);
	});
});

describe('isValidRpcResponse', () => {
	it('returns true for success response', () => {
		expect(isValidRpcResponse({ __rpc: true, id: '1', procedure: 'x', response: 'ok' })).toBe(
			true,
		);
	});

	it('returns true for error response', () => {
		expect(isValidRpcResponse({ __rpc: true, id: '1', procedure: 'x', error: 'fail' })).toBe(
			true,
		);
	});

	it('returns false for request', () => {
		expect(
			isValidRpcResponse({ __rpc: true, id: '1', procedure: 'x', payload: undefined }),
		).toBe(false);
	});

	it('returns false for both response and error', () => {
		expect(
			isValidRpcResponse({
				__rpc: true,
				id: '1',
				procedure: 'x',
				response: 'ok',
				error: 'fail',
			}),
		).toBe(false);
	});

	it('returns false for null', () => {
		expect(isValidRpcResponse(null)).toBe(false);
	});

	it('returns false for non-string error', () => {
		expect(isValidRpcResponse({ __rpc: true, id: '1', procedure: 'x', error: 123 })).toBe(
			false,
		);
	});
});

describe('isValidRpcNotification', () => {
	it('returns true for valid notification', () => {
		expect(
			isValidRpcNotification({
				__rpcNotification: true,
				notification: 'x',
				payload: undefined,
			}),
		).toBe(true);
	});

	it('returns false for request', () => {
		expect(
			isValidRpcNotification({ __rpc: true, id: '1', procedure: 'x', payload: undefined }),
		).toBe(false);
	});

	it('returns false for null', () => {
		expect(isValidRpcNotification(null)).toBe(false);
	});

	it('returns false for missing notification name', () => {
		expect(isValidRpcNotification({ __rpcNotification: true, payload: undefined })).toBe(false);
	});

	it('returns false for missing payload', () => {
		expect(isValidRpcNotification({ __rpcNotification: true, notification: 'x' })).toBe(false);
	});
});
