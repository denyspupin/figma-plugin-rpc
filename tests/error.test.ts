import { describe, expect, it } from 'vitest';
import { RpcError } from '../src/error';

describe('RpcError', () => {
	it('creates an error with code and message', () => {
		const error = new RpcError('NOT_FOUND', 'Resource not found');

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(RpcError);
		expect(error.name).toBe('RpcError');
		expect(error.code).toBe('NOT_FOUND');
		expect(error.message).toBe('Resource not found');
		expect(error.data).toBeUndefined();
	});

	it('creates an error with code, message, and data', () => {
		const data = { field: 'email', reason: 'invalid format' };
		const error = new RpcError('VALIDATION', 'Validation failed', data);

		expect(error.code).toBe('VALIDATION');
		expect(error.message).toBe('Validation failed');
		expect(error.data).toEqual(data);
	});

	it('has a proper stack trace', () => {
		const error = new RpcError('TEST', 'Test error');

		expect(error.stack).toBeDefined();
		expect(error.stack).toContain('RpcError');
	});
});
