import type { RpcNotificationMessage, RpcRequestMessage, RpcResponseMessage } from './types';

export interface DecodedRpcRequest {
	kind: 'request';
	id: string;
	procedure: string;
	payload: unknown;
}

export interface DecodedRpcResponse {
	kind: 'response';
	id: string;
	procedure: string;
	success: boolean;
	response?: unknown;
	error?: string;
	code?: string;
	data?: unknown;
}

export interface DecodedRpcNotification {
	kind: 'notification';
	notification: string;
	payload: unknown;
}

export type DecodedRpcMessage = DecodedRpcRequest | DecodedRpcResponse | DecodedRpcNotification;

export interface DecodeError {
	reason: string;
	correlation?: {
		id: string;
		procedure?: string;
	};
}

export type DecodeResult =
	{ ok: true; value: DecodedRpcMessage } | { ok: false; error: DecodeError };

const hasOwn = (obj: object, key: string): boolean =>
	Object.prototype.hasOwnProperty.call(obj, key);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function readNonEmptyString(msg: Record<string, unknown>, key: string): string | undefined {
	if (!hasOwn(msg, key)) {
		return undefined;
	}

	const value = msg[key];
	if (typeof value !== 'string' || value.length === 0) {
		return undefined;
	}

	return value;
}

function withCorrelation(error: DecodeError, msg: Record<string, unknown>): DecodeError {
	const id = readNonEmptyString(msg, 'id');
	if (!id) return error;

	const procedure = readNonEmptyString(msg, 'procedure');
	return {
		...error,
		correlation: {
			id,
			...(procedure && { procedure }),
		},
	};
}

function decodeRequest(msg: Record<string, unknown>): DecodedRpcRequest | DecodeError {
	const id = readNonEmptyString(msg, 'id');
	const procedure = readNonEmptyString(msg, 'procedure');

	if (!id) {
		return { reason: 'request missing valid "id"' };
	}

	if (!procedure) {
		return { reason: 'request missing valid "procedure"' };
	}

	if (!hasOwn(msg, 'payload')) {
		return { reason: 'request missing "payload" property' };
	}

	return {
		kind: 'request',
		id,
		procedure,
		payload: msg.payload,
	};
}

function decodeResponse(msg: Record<string, unknown>): DecodedRpcResponse | DecodeError {
	const id = readNonEmptyString(msg, 'id');
	const procedure = readNonEmptyString(msg, 'procedure');

	if (!id) {
		return { reason: 'response missing valid "id"' };
	}

	if (!procedure) {
		return { reason: 'response missing valid "procedure"' };
	}

	const hasResponse = hasOwn(msg, 'response');
	const hasError = hasOwn(msg, 'error');

	if (hasResponse && hasError) {
		return { reason: 'response contains both "response" and "error"' };
	}

	if (!hasResponse && !hasError) {
		return { reason: 'response contains neither "response" nor "error"' };
	}

	if (hasError) {
		const errorMessage = msg.error;
		if (typeof errorMessage !== 'string') {
			return { reason: 'response "error" is not a string' };
		}

		const result: DecodedRpcResponse = {
			kind: 'response',
			id,
			procedure,
			success: false,
			error: errorMessage,
		};

		if (hasOwn(msg, 'code')) {
			const code = msg.code;
			if (typeof code !== 'string') {
				return { reason: 'response "code" is not a string' };
			}

			result.code = code;
		}

		if (hasOwn(msg, 'data')) {
			result.data = msg.data;
		}

		return result;
	}

	if (hasOwn(msg, 'code') || hasOwn(msg, 'data')) {
		return { reason: 'success response contains error-only fields' };
	}

	return {
		kind: 'response',
		id,
		procedure,
		success: true,
		response: msg.response,
	};
}

function decodeNotification(msg: Record<string, unknown>): DecodedRpcNotification | DecodeError {
	const notification = readNonEmptyString(msg, 'notification');

	if (!notification) {
		return { reason: 'notification missing valid "notification"' };
	}

	if (!hasOwn(msg, 'payload')) {
		return { reason: 'notification missing "payload" property' };
	}

	return {
		kind: 'notification',
		notification,
		payload: msg.payload,
	};
}

export function decodeRpcMessage(raw: unknown): DecodeResult {
	if (!isPlainObject(raw)) {
		return { ok: false, error: { reason: 'message is not an object' } };
	}

	const isRpcFlag = hasOwn(raw, '__rpc') && raw.__rpc === true;
	const isNotificationFlag = hasOwn(raw, '__rpcNotification') && raw.__rpcNotification === true;

	if (isRpcFlag && isNotificationFlag) {
		return {
			ok: false,
			error: withCorrelation({ reason: 'message contains conflicting RPC markers' }, raw),
		};
	}

	if (isRpcFlag) {
		const hasPayload = hasOwn(raw, 'payload');
		const hasResponseFields =
			hasOwn(raw, 'response') ||
			hasOwn(raw, 'error') ||
			hasOwn(raw, 'code') ||
			hasOwn(raw, 'data');

		if (hasPayload && hasResponseFields) {
			return {
				ok: false,
				error: withCorrelation(
					{ reason: 'message mixes request and response fields' },
					raw,
				),
			};
		}

		if (hasResponseFields) {
			const result = decodeResponse(raw);
			if ('reason' in result) {
				return { ok: false, error: withCorrelation(result, raw) };
			}

			return { ok: true, value: result };
		}

		if (hasPayload || hasOwn(raw, 'procedure')) {
			const result = decodeRequest(raw);
			if ('reason' in result) {
				return { ok: false, error: withCorrelation(result, raw) };
			}

			return { ok: true, value: result };
		}

		return {
			ok: false,
			error: withCorrelation(
				{ reason: '__rpc message has neither procedure nor response/error' },
				raw,
			),
		};
	}

	if (isNotificationFlag) {
		const result = decodeNotification(raw);
		if ('reason' in result) {
			return { ok: false, error: result };
		}

		return { ok: true, value: result };
	}

	return { ok: false, error: { reason: 'unrecognized message format' } };
}

export function isRpcRequest(msg: unknown): msg is RpcRequestMessage {
	const result = decodeRpcMessage(msg);
	return result.ok && result.value.kind === 'request';
}

export function isRpcResponse(msg: unknown): msg is RpcResponseMessage {
	const result = decodeRpcMessage(msg);
	return result.ok && result.value.kind === 'response';
}

export function isRpcNotification(msg: unknown): msg is RpcNotificationMessage {
	const result = decodeRpcMessage(msg);
	return result.ok && result.value.kind === 'notification';
}

/** @deprecated Use {@link isRpcRequest}; removed in v2. */
export const isValidRpcRequest = isRpcRequest;
/** @deprecated Use {@link isRpcResponse}; removed in v2. */
export const isValidRpcResponse = isRpcResponse;
/** @deprecated Use {@link isRpcNotification}; removed in v2. */
export const isValidRpcNotification = isRpcNotification;
