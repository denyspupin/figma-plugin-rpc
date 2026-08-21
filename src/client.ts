import type {
	RpcNotification,
	RpcNotificationPayload,
	RpcProcedure,
	RpcRequest,
	RpcRequestMessage,
	RpcResponse,
	ProcedureConstraint,
} from './types';
import { decodeRpcMessage, type DecodedRpcResponse } from './protocol';
import { formatDuration, noopLogger, type Logger } from './logger';
import type { RpcTransport } from './transport';
import { RpcError } from './error';

type NotificationHandler<Schema extends object, T extends RpcNotification<Schema>> = (
	payload: RpcNotificationPayload<Schema, T>,
) => void;

export interface RpcClientConfig {
	defaultTimeout: number;
	logger: Logger;
}

const DEFAULT_CONFIG: RpcClientConfig = {
	defaultTimeout: 30_000,
	logger: noopLogger,
};

interface PendingEntry {
	procedure: string;
	startTime: number;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	settle: () => void;
}

class RpcClient<Procedures extends ProcedureConstraint<Procedures>, Notifications extends object> {
	private pending = new Map<string, PendingEntry>();
	private notificationHandlers = new Map<string, Set<(payload: unknown) => void>>();
	private initialized = false;
	private unsubscribeTransport: (() => void) | null = null;
	private config: RpcClientConfig;

	constructor(
		private transport: RpcTransport,
		config: Partial<RpcClientConfig> = {},
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * @deprecated Use {@link start}.
	 */
	init(): void {
		this.start();
	}

	start(): void {
		if (this.initialized) {
			return;
		}

		this.unsubscribeTransport = this.transport.onMessage((msg) => this.onMessage(msg));
		this.initialized = true;
		this.config.logger.log('[RpcClient] Initialized');
	}

	/**
	 * @deprecated Use {@link stop}.
	 */
	destroy(): void {
		this.stop();
	}

	stop(): void {
		if (this.initialized) {
			this.unsubscribeTransport?.();
		}
		this.unsubscribeTransport = null;

		for (const call of this.pending.values()) {
			call.settle();
			call.reject(new Error(`RPC client stopped while "${call.procedure}" was pending`));
		}

		this.pending.clear();
		this.notificationHandlers.clear();
		this.initialized = false;
	}

	call<T extends RpcProcedure<Procedures>>(
		procedure: T,
		...args: RpcRequest<Procedures, T> extends void
			? [payload?: void, options?: { timeout?: number; signal?: AbortSignal }]
			: [
					payload: RpcRequest<Procedures, T>,
					options?: { timeout?: number; signal?: AbortSignal },
				]
	): Promise<RpcResponse<Procedures, T>> {
		if (!this.initialized) {
			return Promise.reject(new Error('RPC client not initialized. Call start() first.'));
		}

		const [payload, options] = args;
		const id = crypto.randomUUID();
		const timeout = options?.timeout ?? this.config.defaultTimeout;
		const startTime = Date.now();

		this.config.logger.debug(`[RpcClient] "${procedure}"`);

		return new Promise<RpcResponse<Procedures, T>>((resolve, reject) => {
			const signal = options?.signal;

			if (signal?.aborted) {
				const error = new Error(`RPC call "${procedure}" was aborted`);
				error.name = 'AbortError';
				reject(error);
				return;
			}

			let settled = false;
			let cleanupAbort: (() => void) | undefined;

			const settle = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timeoutId);
				cleanupAbort?.();
				this.pending.delete(id);
			};

			const timeoutId = setTimeout(() => {
				if (!settled) {
					settle();
					const elapsed = Date.now() - startTime;
					reject(
						new Error(
							`RPC call "${procedure}" timed out after ${formatDuration(elapsed)} (limit: ${formatDuration(timeout)})`,
						),
					);
				}
			}, timeout);

			if (signal) {
				const abortHandler = () => {
					if (!settled) {
						settle();
						const error = new Error(`RPC call "${procedure}" was aborted`);
						error.name = 'AbortError';
						reject(error);
					}
				};

				signal.addEventListener('abort', abortHandler, { once: true });

				cleanupAbort = () => {
					signal.removeEventListener('abort', abortHandler);
				};
			}

			const entry: PendingEntry = {
				procedure,
				startTime,
				resolve: resolve as (value: unknown) => void,
				reject,
				settle,
			};
			this.pending.set(id, entry);

			const message: RpcRequestMessage<Procedures, T> = {
				__rpc: true,
				id,
				procedure,
				payload,
			};

			try {
				this.transport.send(message);
			} catch (error) {
				settle();
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	on<T extends RpcNotification<Notifications>>(
		notification: T,
		handler: NotificationHandler<Notifications, T>,
	): () => void {
		let handlers = this.notificationHandlers.get(notification);
		if (!handlers) {
			handlers = new Set();
			this.notificationHandlers.set(notification, handlers);
		}

		const typedHandlers = handlers as Set<NotificationHandler<Notifications, T>>;
		typedHandlers.add(handler);

		return () => {
			typedHandlers.delete(handler);
			if (typedHandlers.size === 0) {
				this.notificationHandlers.delete(notification);
			}
		};
	}

	private onMessage(msg: unknown): void {
		const decoded = decodeRpcMessage(msg);

		if (!decoded.ok) {
			const correlation = decoded.error.correlation;
			if (correlation) {
				const call = this.pending.get(correlation.id);
				if (call) {
					call.settle();
					call.reject(
						new Error(
							`Protocol error for "${call.procedure}": ${decoded.error.reason}`,
						),
					);
				}
			}

			this.config.logger.debug(
				`[RpcClient] Ignoring malformed message: ${decoded.error.reason}`,
			);
			return;
		}

		const value = decoded.value;

		if (value.kind === 'response') {
			this.handleDecodedResponse(value);
			return;
		}

		if (value.kind === 'notification') {
			this.handleNotification(value.notification, value.payload);
			return;
		}
	}

	private handleDecodedResponse(decoded: DecodedRpcResponse): void {
		const { id, procedure } = decoded;
		const call = this.pending.get(id);

		if (!call) {
			return;
		}

		if (call.procedure !== procedure) {
			call.settle();
			call.reject(
				new Error(
					`Protocol error: response procedure "${procedure}" does not match pending "${call.procedure}" for id "${id}"`,
				),
			);
			return;
		}

		const duration = Date.now() - call.startTime;

		if (!decoded.success) {
			const error = decoded.error ?? 'Unknown error';
			call.settle();
			if (decoded.code) {
				call.reject(new RpcError(decoded.code, error, decoded.data));
			} else {
				call.reject(new Error(error));
			}
			this.config.logger.error(`[RpcClient] Error in "${procedure}": ${error}`);
		} else {
			call.settle();
			call.resolve(decoded.response);
			this.config.logger.debug(
				`[RpcClient] "${procedure}" completed in ${formatDuration(duration)}`,
			);
		}
	}

	private handleNotification(notification: string, payload: unknown): void {
		const handlers = this.notificationHandlers.get(notification);
		if (!handlers || handlers.size === 0) {
			return;
		}

		for (const handler of handlers) {
			try {
				handler(payload);
			} catch (error) {
				this.config.logger.error(
					`[RpcClient] Error in handler for "${notification}":`,
					error,
				);
			}
		}
	}

	/** Diagnostics aid: number of in-flight requests. */
	getPendingCount(): number {
		return this.pending.size;
	}

	/**
	 * @deprecated Initialization state is observable through behavior; removed in v2.
	 */
	isInitialized(): boolean {
		return this.initialized;
	}
}

function createRpcClient<
	Procedures extends ProcedureConstraint<Procedures>,
	Notifications extends object,
>(
	transport: RpcTransport,
	config?: Partial<RpcClientConfig>,
): RpcClient<Procedures, Notifications> {
	return new RpcClient<Procedures, Notifications>(transport, config);
}

export { RpcClient, createRpcClient };
