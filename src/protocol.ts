import type { RpcNotificationMessage, RpcRequestMessage, RpcResponseMessage } from './types';
import { PROTOCOL_VERSION } from './types';

export interface DecodedRpcRequest {
	kind: 'request';
	id: string;
	procedure: string;
	payload: unknown;
	version: number;
}

export interface DecodedRpcResponse {
	kind: 'response';
	id: string;
	procedure: string;
	version: number;
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
	version: number;
}

export type DecodedRpcMessage = DecodedRpcRequest | DecodedRpcResponse | DecodedRpcNotification;

export interface DecodeError {
	reason: string;
}

export type DecodeResult =
	{ ok: true; value: DecodedRpcMessage } | { ok: false; error: DecodeError };

const hasOwn = (obj: object, key: string): boolean =>
	Object.prototype.hasOwnProperty.call(obj, key);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function readVersion(msg: Record<string, unknown>): number | undefined {
	if (!hasOwn(msg, 'v')) {
		return undefined;
	}

	const v = msg.v;
	if (v === undefined) {
		return undefined;
	}

	if (typeof v !== 'number' || !Number.isFinite(v)) {
		return -1;
	}

	return v;
}

function isSupportedVersion(version: number | undefined): boolean {
	return version === undefined || version === PROTOCOL_VERSION;
}

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

function decodeRequest(msg: Record<string, unknown>): DecodedRpcRequest | DecodeError {
	const version = readVersion(msg);
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

	if (!isSupportedVersion(version)) {
		return { reason: `unsupported protocol version: ${version}` };
	}

	return {
		kind: 'request',
		id,
		procedure,
		payload: msg.payload,
		version: version ?? PROTOCOL_VERSION,
	};
}

function decodeResponse(msg: Record<string, unknown>): DecodedRpcResponse | DecodeError {
	const version = readVersion(msg);
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

	if (!isSupportedVersion(version)) {
		return { reason: `unsupported protocol version: ${version}` };
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
			version: version ?? PROTOCOL_VERSION,
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

	return {
		kind: 'response',
		id,
		procedure,
		version: version ?? PROTOCOL_VERSION,
		success: true,
		response: msg.response,
	};
}

function decodeNotification(msg: Record<string, unknown>): DecodedRpcNotification | DecodeError {
	const version = readVersion(msg);
	const notification = readNonEmptyString(msg, 'notification');

	if (!notification) {
		return { reason: 'notification missing valid "notification"' };
	}

	if (!hasOwn(msg, 'payload')) {
		return { reason: 'notification missing "payload" property' };
	}

	if (!isSupportedVersion(version)) {
		return { reason: `unsupported protocol version: ${version}` };
	}

	return {
		kind: 'notification',
		notification,
		payload: msg.payload,
		version: version ?? PROTOCOL_VERSION,
	};
}

export function decodeRpcMessage(raw: unknown): DecodeResult {
	if (!isPlainObject(raw)) {
		return { ok: false, error: { reason: 'message is not an object' } };
	}

	const isRpcFlag = hasOwn(raw, '__rpc') && raw.__rpc === true;
	const isNotificationFlag = hasOwn(raw, '__rpcNotification') && raw.__rpcNotification === true;

	if (isRpcFlag) {
		const hasResponseOrError = hasOwn(raw, 'response') || hasOwn(raw, 'error');

		if (hasResponseOrError) {
			const result = decodeResponse(raw);
			if ('reason' in result) {
				return { ok: false, error: result };
			}

			return { ok: true, value: result };
		}

		if (hasOwn(raw, 'procedure')) {
			const result = decodeRequest(raw);
			if ('reason' in result) {
				return { ok: false, error: result };
			}

			return { ok: true, value: result };
		}

		return {
			ok: false,
			error: { reason: '__rpc message has neither procedure nor response/error' },
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

export function isValidRpcRequest(msg: unknown): msg is RpcRequestMessage {
	const result = decodeRpcMessage(msg);
	return result.ok && result.value.kind === 'request';
}

export function isValidRpcResponse(msg: unknown): msg is RpcResponseMessage {
	const result = decodeRpcMessage(msg);
	return result.ok && result.value.kind === 'response';
}

export function isValidRpcNotification(msg: unknown): msg is RpcNotificationMessage {
	const result = decodeRpcMessage(msg);
	return result.ok && result.value.kind === 'notification';
}
