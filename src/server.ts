import type {
	RpcNotification,
	RpcNotificationMessage,
	RpcNotificationPayload,
	RpcProcedure,
	RpcRequest,
	RpcResponse,
	RpcResponseMessage,
	OpenRpcProcedureSchema,
	ProcedureConstraint,
} from './types';
import { decodeRpcMessage } from './protocol';
import { formatDuration, noopLogger, type Logger } from './logger';
import type { RpcTransport } from './transport';
import { RpcError } from './error';

type RpcHandler<Schema extends ProcedureConstraint<Schema>, T extends RpcProcedure<Schema>> = (
	payload: RpcRequest<Schema, T>,
) => RpcResponse<Schema, T> | Promise<RpcResponse<Schema, T>>;

/**
 * Per-request middleware context, discriminated by procedure name: narrowing
 * on `ctx.procedure` narrows `ctx.payload` to that procedure's request type.
 * Without a schema type parameter, `procedure` is `string` and `payload`
 * is `unknown`.
 */
export type RpcMiddlewareContext<
	Procedures extends ProcedureConstraint<Procedures> = OpenRpcProcedureSchema,
> = {
	[T in RpcProcedure<Procedures>]: {
		id: string;
		procedure: T;
		payload: RpcRequest<Procedures, T>;
		next: () => Promise<unknown>;
	};
}[RpcProcedure<Procedures>];

export type RpcMiddleware<
	Procedures extends ProcedureConstraint<Procedures> = OpenRpcProcedureSchema,
> = (ctx: RpcMiddlewareContext<Procedures>) => Promise<unknown>;

export interface RpcServerConfig<Procedures extends ProcedureConstraint<Procedures>> {
	logger: Logger;
	/** Must not throw; a throwing callback violates the server's error contract. */
	onError?: (procedure: string, error: Error) => void;
	middleware?: RpcMiddleware<Procedures>[];
}

class RpcServer<Procedures extends ProcedureConstraint<Procedures>, Notifications extends object> {
	private handlers = new Map<string, RpcHandler<Procedures, RpcProcedure<Procedures>>>();
	private config: RpcServerConfig<Procedures>;
	private middleware: RpcMiddleware<Procedures>[] = [];
	private unsubscribeTransport: (() => void) | null = null;
	private running = false;

	constructor(
		private transport: RpcTransport,
		config: Partial<RpcServerConfig<Procedures>> = {},
	) {
		this.config = { logger: noopLogger, ...config };
		this.middleware = config.middleware ?? [];
	}

	start(): void {
		if (this.running) {
			return;
		}

		this.unsubscribeTransport = this.transport.onMessage((msg) => {
			void this.processMessage(msg);
		});
		this.running = true;
		this.config.logger.log('[RpcServer] Started');
	}

	stop(): void {
		if (!this.running) return;

		this.unsubscribeTransport?.();
		this.unsubscribeTransport = null;
		this.running = false;
	}

	use(middleware: RpcMiddleware<Procedures>): this {
		this.middleware.push(middleware);
		return this;
	}

	registerHandler<T extends RpcProcedure<Procedures>>(
		procedure: T,
		handler: RpcHandler<Procedures, T>,
	): this {
		if (this.handlers.has(procedure)) {
			this.config.logger.warn(`[RpcServer] Overwriting existing handler for "${procedure}"`);
		}

		this.handlers.set(
			procedure,
			handler as unknown as RpcHandler<Procedures, RpcProcedure<Procedures>>,
		);

		return this;
	}

	private processMessage(msg: unknown): void | Promise<void> {
		const decoded = decodeRpcMessage(msg);

		if (!decoded.ok) {
			const correlation = decoded.error.correlation;
			if (correlation?.procedure) {
				this.sendError(
					correlation.id,
					correlation.procedure,
					`Protocol error: ${decoded.error.reason}`,
				);
			}
			this.config.logger.debug(
				`[RpcServer] Ignoring malformed message: ${decoded.error.reason}`,
			);
			return;
		}

		const value = decoded.value;

		if (value.kind !== 'request') {
			return;
		}

		const startTime = Date.now();
		this.config.logger.debug(`[RpcServer] "${value.procedure}"`);

		return this.executeHandler(value.id, value.procedure, value.payload, startTime);
	}

	private async executeHandler(
		id: string,
		procedure: string,
		payload: unknown,
		startTime: number,
	): Promise<void> {
		const handler = this.handlers.get(procedure);

		if (!handler) {
			this.sendError(id, procedure, `Unknown procedure: "${procedure}"`);
			this.config.logger.error(`[RpcServer] Error: No handler for "${procedure}"`);
			return;
		}

		try {
			// The wire-level procedure name is only known at runtime; the context
			// is shaped to the schema's discriminated union for middleware.
			const ctx = { id, procedure, payload } as unknown as RpcMiddlewareContext<Procedures>;
			const chain: () => Promise<unknown> = this.middleware.reduceRight<
				() => Promise<unknown>
			>(
				(next, mw) => () => Promise.resolve(mw({ ...ctx, next })),
				() =>
					Promise.resolve(
						handler(payload as RpcRequest<Procedures, RpcProcedure<Procedures>>),
					),
			);

			const response = await chain();

			this.config.logger.debug(
				`[RpcServer] "${procedure}" completed in ${formatDuration(Date.now() - startTime)}`,
			);

			this.sendResponse(id, procedure, response);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const rpcError = error instanceof RpcError ? error : undefined;
			this.sendError(id, procedure, errorMessage, rpcError);
			this.config.logger.error(`[RpcServer] Error in "${procedure}":`, error);
			this.config.onError?.(
				procedure,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	notify<T extends RpcNotification<Notifications>>(
		notification: T,
		payload: RpcNotificationPayload<Notifications, T>,
	): void {
		const message: RpcNotificationMessage<Notifications, T> = {
			__rpcNotification: true,
			notification,
			payload,
		};

		this.transport.send(message);
	}

	private sendResponse(id: string, procedure: string, response: unknown): void {
		try {
			const message: RpcResponseMessage = {
				__rpc: true,
				id,
				procedure,
				response,
			};
			this.transport.send(message);
		} catch (error) {
			this.reportSendFailure(procedure, error);
		}
	}

	private sendError(id: string, procedure: string, error: string, rpcError?: RpcError): void {
		try {
			const message: RpcResponseMessage = {
				__rpc: true,
				id,
				procedure,
				error,
				...(rpcError && { code: rpcError.code, data: rpcError.data }),
			};
			this.transport.send(message);
		} catch (sendFailure) {
			this.reportSendFailure(procedure, sendFailure);
		}
	}

	private reportSendFailure(procedure: string, error: unknown): void {
		const normalized = error instanceof Error ? error : new Error(String(error));
		this.config.logger.error(
			`[RpcServer] Transport send failed for "${procedure}":`,
			normalized,
		);
		this.config.onError?.(procedure, normalized);
	}
}

function createRpcServer<
	Procedures extends ProcedureConstraint<Procedures>,
	Notifications extends object,
>(
	transport: RpcTransport,
	config?: Partial<RpcServerConfig<Procedures>>,
): RpcServer<Procedures, Notifications> {
	return new RpcServer<Procedures, Notifications>(transport, config);
}

export { RpcServer, createRpcServer };
export type { RpcHandler };
