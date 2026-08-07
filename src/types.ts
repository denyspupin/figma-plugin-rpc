// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RpcProcedureSchema {}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RpcNotificationSchema {}

export interface RpcProcedureDefinition {
	request: unknown;
	response: unknown;
	error?: unknown;
}

export type ProcedureConstraint<Schema> = {
	[K in Extract<keyof Schema, string>]-?: RpcProcedureDefinition;
};

interface OpenRpcProcedureSchema {
	[name: string]: RpcProcedureDefinition;
}

interface OpenRpcNotificationSchema {
	[name: string]: unknown;
}

export type RpcProcedure<Schema extends RpcProcedureSchema = OpenRpcProcedureSchema> = Extract<
	keyof Schema,
	string
>;

export type RpcNotification<Schema extends object = OpenRpcNotificationSchema> = Extract<
	keyof Schema,
	string
>;

export type RpcRequest<
	Schema extends ProcedureConstraint<Schema>,
	T extends RpcProcedure<Schema>,
> = Schema[T]['request'];

export type RpcResponse<
	Schema extends ProcedureConstraint<Schema>,
	T extends RpcProcedure<Schema>,
> = Schema[T]['response'];

export type RpcProcedureError<
	Schema extends ProcedureConstraint<Schema>,
	T extends RpcProcedure<Schema>,
> = 'error' extends keyof Schema[T]
	? Schema[T] extends { error?: infer E }
		? Exclude<E, undefined>
		: never
	: never;

export type RpcNotificationPayload<
	Schema extends object,
	T extends RpcNotification<Schema>,
> = Schema[T];

export const PROTOCOL_VERSION = 1;

export interface RpcRequestMessage<
	Schema extends ProcedureConstraint<Schema> = OpenRpcProcedureSchema,
	T extends RpcProcedure<Schema> = RpcProcedure<Schema>,
> {
	__rpc: true;
	v?: number;
	id: string;
	procedure: T;
	payload: RpcRequest<Schema, T>;
}

export type RpcResponseMessage<
	Schema extends ProcedureConstraint<Schema> = OpenRpcProcedureSchema,
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
	Schema extends object = OpenRpcNotificationSchema,
	T extends RpcNotification<Schema> = RpcNotification<Schema>,
> {
	__rpcNotification: true;
	v?: number;
	notification: T;
	payload: RpcNotificationPayload<Schema, T>;
}
