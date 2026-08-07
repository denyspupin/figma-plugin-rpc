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

export function isRpcRequest(msg: unknown): msg is RpcRequestMessage {
	return (
		typeof msg === 'object' &&
		msg !== null &&
		'__rpc' in msg &&
		(msg as Record<string, unknown>).__rpc === true &&
		'procedure' in msg &&
		'payload' in msg
	);
}

export function isRpcResponse(msg: unknown): msg is RpcResponseMessage {
	return (
		typeof msg === 'object' &&
		msg !== null &&
		'__rpc' in msg &&
		(msg as Record<string, unknown>).__rpc === true &&
		'id' in msg &&
		'procedure' in msg &&
		('response' in msg || 'error' in msg)
	);
}

export function isRpcNotification(msg: unknown): msg is RpcNotificationMessage {
	return (
		typeof msg === 'object' &&
		msg !== null &&
		'__rpcNotification' in msg &&
		(msg as Record<string, unknown>).__rpcNotification === true
	);
}
