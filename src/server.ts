import type {
	RpcNotification,
	RpcNotificationMessage,
	RpcNotificationPayload,
	RpcNotificationSchema,
	RpcProcedure,
	RpcProcedureSchema,
	RpcRequest,
	RpcResponse,
	RpcResponseMessage,
} from './types';
import { isRpcRequest, PROTOCOL_VERSION } from './types';
import { formatDuration, noopLogger, type Logger } from './transport';
import type { RpcTransport } from './transport';
import { RpcError } from './error';

type RpcHandler<Schema extends RpcProcedureSchema, T extends RpcProcedure<Schema>> = (
	payload: RpcRequest<Schema, T>,
) => RpcResponse<Schema, T> | Promise<RpcResponse<Schema, T>>;

type HandlerRegistry<Schema extends RpcProcedureSchema> = {
	[K in RpcProcedure<Schema>]?: RpcHandler<Schema, K>;
};

export interface RpcServerConfig {
	logger: Logger;
	onError?: (procedure: string, error: Error) => void;
}

const DEFAULT_CONFIG: RpcServerConfig = {
	logger: noopLogger,
};

class RpcServer<
	Procedures extends RpcProcedureSchema,
	Notifications extends RpcNotificationSchema,
> {
	private handlers: HandlerRegistry<Procedures> = {};
	private config: RpcServerConfig;
	private unsubscribeTransport: (() => void) | null = null;
	private running = false;

	constructor(
		private transport: RpcTransport,
		config: Partial<RpcServerConfig> = {},
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
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

	registerHandler<T extends RpcProcedure<Procedures>>(
		procedure: T,
		handler: RpcHandler<Procedures, T>,
	): this {
		if (this.handlers[procedure]) {
			this.config.logger.warn(`[RpcServer] Overwriting existing handler for "${procedure}"`);
		}

		this.handlers[procedure] = handler as HandlerRegistry<Procedures>[T];

		return this;
	}

	private async processMessage(msg: unknown): Promise<boolean> {
		if (!isRpcRequest(msg)) {
			return false;
		}

		const { id, procedure } = msg;
		const startTime = Date.now();

		this.config.logger.debug(`[RpcServer] "${procedure}"`);

		const handler = this.handlers[procedure as RpcProcedure<Procedures>];

		if (!handler) {
			this.sendError(id, procedure, `Unknown procedure: "${procedure}"`);
			this.config.logger.error(`[RpcServer] Error: No handler for "${procedure}"`);
			return true;
		}

		try {
			const response = await Promise.resolve(
				(handler as RpcHandler<Procedures, RpcProcedure<Procedures>>)(
					msg.payload as RpcRequest<Procedures, RpcProcedure<Procedures>>,
				),
			);

			this.config.logger.debug(
				`[RpcServer] "${procedure}" completed in ${formatDuration(Date.now() - startTime)}`,
			);

			this.sendResponse(
				id,
				procedure,
				response as RpcResponse<Procedures, RpcProcedure<Procedures>>,
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const rpcError = error instanceof RpcError ? error : undefined;
			this.sendError(id, procedure, errorMessage, rpcError);
			this.config.logger.error(`[RpcServer] Error in "${procedure}":`, error);

			if (this.config.onError) {
				this.config.onError(
					procedure,
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}

		return true;
	}

	notify<T extends RpcNotification<Notifications>>(
		notification: T,
		payload: RpcNotificationPayload<Notifications, T>,
	): void {
		const message: RpcNotificationMessage<Notifications, T> = {
			__rpcNotification: true,
			v: PROTOCOL_VERSION,
			notification,
			payload,
		};

		this.transport.send(message);
	}

	private sendResponse<T extends RpcProcedure<Procedures>>(
		id: string,
		procedure: T,
		response: RpcResponse<Procedures, T>,
	): void {
		const message: RpcResponseMessage = {
			__rpc: true,
			v: PROTOCOL_VERSION,
			id,
			procedure,
			response,
		};

		this.transport.send(message);
	}

	private sendError(id: string, procedure: string, error: string, rpcError?: RpcError): void {
		const message: RpcResponseMessage = {
			__rpc: true,
			v: PROTOCOL_VERSION,
			id,
			procedure,
			error,
			...(rpcError && { code: rpcError.code, data: rpcError.data }),
		};

		this.transport.send(message);
	}
}

function createRpcServer<
	Procedures extends RpcProcedureSchema,
	Notifications extends RpcNotificationSchema,
>(
	transport: RpcTransport,
	config?: Partial<RpcServerConfig>,
): RpcServer<Procedures, Notifications> {
	return new RpcServer<Procedures, Notifications>(transport, config);
}

export { RpcServer, createRpcServer };
export type { RpcHandler };
