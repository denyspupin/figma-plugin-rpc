import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingCall } from '../src/pending-call';

describe('PendingCall', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const createCall = (overrides: Partial<ConstructorParameters<typeof PendingCall>[0]> = {}) => {
		const resolve = vi.fn();
		const reject = vi.fn();
		const timeoutId = setTimeout(() => {}, 30_000);
		const onSettle = vi.fn();

		const call = new PendingCall({
			id: 'test-id',
			procedure: 'test-procedure',
			startTime: Date.now(),
			resolve,
			reject,
			timeoutId,
			onSettle,
			...overrides,
		});

		return { call, resolve, reject, timeoutId, onSettle };
	};

	it('exposes id, procedure, and startTime', () => {
		const { call } = createCall();
		expect(call.id).toBe('test-id');
		expect(call.procedure).toBe('test-procedure');
		expect(call.startTime).toBe(Date.now());
	});

	it('is not settled initially', () => {
		const { call } = createCall();
		expect(call.isSettled).toBe(false);
	});

	it('calculates duration', () => {
		const startTime = Date.now();
		const { call } = createCall({ startTime });
		vi.advanceTimersByTime(500);
		expect(call.duration()).toBe(500);
	});

	describe('resolve', () => {
		it('resolves the promise and settles', () => {
			const { call, resolve, onSettle } = createCall();
			call.resolve({ result: 42 });

			expect(resolve).toHaveBeenCalledWith({ result: 42 });
			expect(call.isSettled).toBe(true);
			expect(onSettle).toHaveBeenCalledWith('test-id');
		});

		it('clears the timeout on resolve', () => {
			const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
			const { call, timeoutId } = createCall();
			call.resolve('ok');

			expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId);
			clearTimeoutSpy.mockRestore();
		});

		it('cleans up abort listener on resolve', () => {
			const cleanupAbort = vi.fn();
			const { call } = createCall({ cleanupAbort });
			call.resolve('ok');

			expect(cleanupAbort).toHaveBeenCalledTimes(1);
		});

		it('is idempotent — second resolve is ignored', () => {
			const { call, resolve } = createCall();
			call.resolve('first');
			call.resolve('second');

			expect(resolve).toHaveBeenCalledTimes(1);
			expect(resolve).toHaveBeenCalledWith('first');
		});

		it('resolve after reject is ignored', () => {
			const { call, resolve, reject } = createCall();
			call.reject(new Error('fail'));
			call.resolve('too late');

			expect(reject).toHaveBeenCalledTimes(1);
			expect(resolve).not.toHaveBeenCalled();
		});
	});

	describe('reject', () => {
		it('rejects the promise and settles', () => {
			const { call, reject, onSettle } = createCall();
			const error = new Error('boom');
			call.reject(error);

			expect(reject).toHaveBeenCalledWith(error);
			expect(call.isSettled).toBe(true);
			expect(onSettle).toHaveBeenCalledWith('test-id');
		});

		it('clears the timeout on reject', () => {
			const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
			const { call, timeoutId } = createCall();
			call.reject(new Error('fail'));

			expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId);
			clearTimeoutSpy.mockRestore();
		});

		it('cleans up abort listener on reject', () => {
			const cleanupAbort = vi.fn();
			const { call } = createCall({ cleanupAbort });
			call.reject(new Error('fail'));

			expect(cleanupAbort).toHaveBeenCalledTimes(1);
		});

		it('is idempotent — second reject is ignored', () => {
			const { call, reject } = createCall();
			call.reject(new Error('first'));
			call.reject(new Error('second'));

			expect(reject).toHaveBeenCalledTimes(1);
			expect(reject).toHaveBeenCalledWith(new Error('first'));
		});
	});

	describe('onSettle callback', () => {
		it('is called exactly once on resolve', () => {
			const { call, onSettle } = createCall();
			call.resolve('ok');
			call.resolve('again');
			call.reject(new Error('too late'));

			expect(onSettle).toHaveBeenCalledTimes(1);
			expect(onSettle).toHaveBeenCalledWith('test-id');
		});

		it('is called exactly once on reject', () => {
			const { call, onSettle } = createCall();
			call.reject(new Error('fail'));
			call.reject(new Error('again'));
			call.resolve('too late');

			expect(onSettle).toHaveBeenCalledTimes(1);
		});
	});

	describe('without cleanupAbort', () => {
		it('settle works without cleanupAbort', () => {
			const { call } = createCall({ cleanupAbort: undefined });
			expect(() => call.resolve('ok')).not.toThrow();
		});
	});
});
