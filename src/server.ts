import type {
	RpcNotification,
	RpcNotificationMessage,
	RpcNotificationPayload,
	RpcNotificationSchema,
	RpcProcedure,
	RpcRequest,
	RpcResponse,
	RpcResponseMessage,
	ProcedureConstraint,
} from './types';
import { PROTOCOL_VERSION } from './types';
import { decodeRpcMessage } from './protocol';
import { formatDuration, noopLogger, type Logger } from './transport';
import type { RpcTransport } from './transport';
import { RpcError } from './error';

type RpcHandler<Schema extends ProcedureConstraint<Schema>, T extends RpcProcedure<Schema>> = (
	payload: RpcRequest<Schema, T>,
) => RpcResponse<Schema, T> | Promise<RpcResponse<Schema, T>>;

export type RpcValidator = (procedure: string, payload: unknown) => void | RpcError;

export interface RpcServerConfig {
	logger: Logger;
	onError?: (procedure: string, error: Error) => void;
	validator?: RpcValidator;
}

const DEFAULT_CONFIG: RpcServerConfig = {
	logger: noopLogger,
};

class RpcServer<
	Procedures extends ProcedureConstraint<Procedures>,
	Notifications extends RpcNotificationSchema,
> {
	private handlers = new Map<string, RpcHandler<Procedures, RpcProcedure<Procedures>>>();
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
			try {
				const result = this.processMessage(msg);
				if (result && typeof result.then === 'function') {
					result.catch(() => {});
				}
			} catch {
				// synchronous failure in processMessage is swallowed
			}
		});
		this.running = true;
		this.safeLog('log', '[RpcServer] Started');
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
		if (this.handlers.has(procedure)) {
			this.safeLog('warn', `[RpcServer] Overwriting existing handler for "${procedure}"`);
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
			this.safeLog(
				'debug',
				`[RpcServer] Ignoring malformed message: ${decoded.error.reason}`,
			);
			return;
		}

		const value = decoded.value;

		if (value.kind !== 'request') {
			return;
		}

		const startTime = Date.now();
		this.safeLog('debug', `[RpcServer] "${value.procedure}"`);

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
			this.safeSendError(id, procedure, `Unknown procedure: "${procedure}"`);
			this.safeLog('error', `[RpcServer] Error: No handler for "${procedure}"`);
			return;
		}

		if (this.config.validator) {
			let validationError: void | RpcError;
			try {
				validationError = this.config.validator(procedure, payload);
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				this.safeSendError(id, procedure, err.message);
				this.safeLog('error', `[RpcServer] Validator threw in "${procedure}":`, error);
				this.safeOnError(procedure, err);
				return;
			}

			if (validationError) {
				this.safeSendError(id, procedure, validationError.message, validationError);
				this.safeLog(
					'error',
					`[RpcServer] Validation error in "${procedure}": ${validationError.message}`,
				);
				return;
			}
		}

		try {
			const response = await Promise.resolve(
				handler(payload as RpcRequest<Procedures, RpcProcedure<Procedures>>),
			);

			this.safeLog(
				'debug',
				`[RpcServer] "${procedure}" completed in ${formatDuration(Date.now() - startTime)}`,
			);

			this.safeSendResponse(id, procedure, response);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const rpcError = error instanceof RpcError ? error : undefined;
			this.safeSendError(id, procedure, errorMessage, rpcError);
			this.safeLog('error', `[RpcServer] Error in "${procedure}":`, error);
			this.safeOnError(procedure, error instanceof Error ? error : new Error(String(error)));
		}
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

	private safeSendResponse(id: string, procedure: string, response: unknown): void {
		try {
			const message: RpcResponseMessage = {
				__rpc: true,
				v: PROTOCOL_VERSION,
				id,
				procedure,
				response,
			};
			this.transport.send(message);
		} catch {
			// transport send failure during response — nothing more we can do
		}
	}

	private safeSendError(id: string, procedure: string, error: string, rpcError?: RpcError): void {
		try {
			const message: RpcResponseMessage = {
				__rpc: true,
				v: PROTOCOL_VERSION,
				id,
				procedure,
				error,
				...(rpcError && { code: rpcError.code, data: rpcError.data }),
			};
			this.transport.send(message);
		} catch {
			// transport send failure during error response — nothing more we can do
		}
	}

	private safeLog(level: 'log' | 'debug' | 'warn' | 'error', ...args: unknown[]): void {
		try {
			this.config.logger[level](...args);
		} catch {
			// logger failure must not create unhandled rejections
		}
	}

	private safeOnError(procedure: string, error: Error): void {
		if (!this.config.onError) return;
		try {
			this.config.onError(procedure, error);
		} catch {
			// onError callback failure must not create unhandled rejections
		}
	}
}

function createRpcServer<
	Procedures extends ProcedureConstraint<Procedures>,
	Notifications extends RpcNotificationSchema,
>(
	transport: RpcTransport,
	config?: Partial<RpcServerConfig>,
): RpcServer<Procedures, Notifications> {
	return new RpcServer<Procedures, Notifications>(transport, config);
}

export { RpcServer, createRpcServer };
export type { RpcHandler };
