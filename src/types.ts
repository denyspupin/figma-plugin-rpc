export interface RpcProcedureSchema {
	[name: string]: {
		request: unknown;
		response: unknown;
		error?: unknown;
	};
}

export interface RpcNotificationSchema {
	[name: string]: unknown;
}

export type RpcProcedure<Schema extends RpcProcedureSchema = RpcProcedureSchema> = keyof Schema &
	string;

export type RpcNotification<Schema extends RpcNotificationSchema = RpcNotificationSchema> =
	keyof Schema & string;

export type RpcRequest<
	Schema extends RpcProcedureSchema,
	T extends RpcProcedure<Schema>,
> = Schema[T]['request'];

export type RpcResponse<
	Schema extends RpcProcedureSchema,
	T extends RpcProcedure<Schema>,
> = Schema[T]['response'];

export type RpcProcedureError<
	Schema extends RpcProcedureSchema,
	T extends RpcProcedure<Schema>,
> = Schema[T] extends { error: infer E } ? E : never;

export type RpcNotificationPayload<
	Schema extends RpcNotificationSchema,
	T extends RpcNotification<Schema>,
> = Schema[T];

export const PROTOCOL_VERSION = 1;

export interface RpcRequestMessage<
	Schema extends RpcProcedureSchema = RpcProcedureSchema,
	T extends RpcProcedure<Schema> = RpcProcedure<Schema>,
> {
	__rpc: true;
	v?: number;
	id: string;
	procedure: T;
	payload: RpcRequest<Schema, T>;
}

export type RpcResponseMessage<
	Schema extends RpcProcedureSchema = RpcProcedureSchema,
	T extends RpcProcedure<Schema> = RpcProcedure<Schema>,
> =
	| {
			__rpc: true;
			v?: number;
			id: string;
			procedure: T;
			response: RpcResponse<Schema, T>;
	  }
	| {
			__rpc: true;
			v?: number;
			id: string;
			procedure: T;
			error: string;
			code?: string;
			data?: unknown;
	  };

export interface RpcNotificationMessage<
	Schema extends RpcNotificationSchema = RpcNotificationSchema,
	T extends RpcNotification<Schema> = RpcNotification<Schema>,
> {
	__rpcNotification: true;
	v?: number;
	notification: T;
	payload: RpcNotificationPayload<Schema, T>;
}

function hasOwn(obj: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSupportedVersion(v: unknown): boolean {
	if (v === undefined) return true;
	return v === PROTOCOL_VERSION;
}

export function isRpcRequest(msg: unknown): msg is RpcRequestMessage {
	if (!isPlainObject(msg)) return false;
	if (!hasOwn(msg, '__rpc') || msg.__rpc !== true) return false;
	if (!hasOwn(msg, 'id') || typeof msg.id !== 'string' || msg.id.length === 0) return false;
	if (
		!hasOwn(msg, 'procedure') ||
		typeof msg.procedure !== 'string' ||
		msg.procedure.length === 0
	)
		return false;
	if (!hasOwn(msg, 'payload')) return false;
	if (!isSupportedVersion(msg.v)) return false;
	return true;
}

export function isRpcResponse(msg: unknown): msg is RpcResponseMessage {
	if (!isPlainObject(msg)) return false;
	if (!hasOwn(msg, '__rpc') || msg.__rpc !== true) return false;
	if (!hasOwn(msg, 'id') || typeof msg.id !== 'string' || msg.id.length === 0) return false;
	if (
		!hasOwn(msg, 'procedure') ||
		typeof msg.procedure !== 'string' ||
		msg.procedure.length === 0
	)
		return false;
	if (!isSupportedVersion(msg.v)) return false;
	const hasResponse = hasOwn(msg, 'response');
	const hasError = hasOwn(msg, 'error');
	if (hasResponse === hasError) return false;
	if (hasError && typeof msg.error !== 'string') return false;
	if (hasOwn(msg, 'code') && typeof msg.code !== 'string') return false;
	return true;
}

export function isRpcNotification(msg: unknown): msg is RpcNotificationMessage {
	if (!isPlainObject(msg)) return false;
	if (!hasOwn(msg, '__rpcNotification') || msg.__rpcNotification !== true) return false;
	if (
		!hasOwn(msg, 'notification') ||
		typeof msg.notification !== 'string' ||
		msg.notification.length === 0
	)
		return false;
	if (!hasOwn(msg, 'payload')) return false;
	if (!isSupportedVersion(msg.v)) return false;
	return true;
}
