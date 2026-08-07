import { nanoid } from 'nanoid';
import type {
	RpcNotification,
	RpcNotificationPayload,
	RpcNotificationSchema,
	RpcProcedure,
	RpcProcedureSchema,
	RpcRequest,
	RpcRequestMessage,
	RpcResponse,
	RpcResponseMessage,
} from './types';
import { isRpcNotification, isRpcResponse, PROTOCOL_VERSION } from './types';
import { formatDuration, noopLogger, type Logger } from './transport';
import type { RpcTransport } from './transport';

interface PendingRequest<T = unknown> {
	resolve: (value: T) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
	procedure: string;
	startTime: number;
}

type NotificationHandler<
	Schema extends RpcNotificationSchema,
	T extends RpcNotification<Schema>,
> = (payload: RpcNotificationPayload<Schema, T>) => void;

export interface RpcClientConfig {
	defaultTimeout: number;
	logger: Logger;
}

const DEFAULT_CONFIG: RpcClientConfig = {
	defaultTimeout: 30_000,
	logger: noopLogger,
};

class RpcClient<
	Procedures extends RpcProcedureSchema,
	Notifications extends RpcNotificationSchema,
> {
	private pending = new Map<string, PendingRequest>();
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

	init(): void {
		if (this.initialized) {
			return;
		}

		this.unsubscribeTransport = this.transport.onMessage((msg) => this.onMessage(msg));
		this.initialized = true;
		this.config.logger.log('[RpcClient] Initialized');
	}

	destroy(): void {
		if (!this.initialized) return;

		this.unsubscribeTransport?.();
		this.unsubscribeTransport = null;

		for (const [, request] of this.pending) {
			clearTimeout(request.timeoutId);
			request.reject(
				new Error(`RPC client destroyed while "${request.procedure}" was pending`),
			);
		}

		this.pending.clear();
		this.notificationHandlers.clear();
		this.initialized = false;
	}

	call<T extends RpcProcedure<Procedures>>(
		procedure: T,
		...args: RpcRequest<Procedures, T> extends void
			? [payload?: void, options?: { timeout?: number }]
			: [payload: RpcRequest<Procedures, T>, options?: { timeout?: number }]
	): Promise<RpcResponse<Procedures, T>> {
		if (!this.initialized) {
			return Promise.reject(new Error('RPC client not initialized. Call init() first.'));
		}

		const [payload, options] = args;
		const id = nanoid();
		const timeout = options?.timeout ?? this.config.defaultTimeout;
		const startTime = Date.now();

		this.config.logger.debug(`[RpcClient] "${procedure}"`);

		return new Promise<RpcResponse<Procedures, T>>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					const elapsed = Date.now() - startTime;
					reject(
						new Error(
							`RPC call "${procedure}" timed out after ${formatDuration(elapsed)} (limit: ${formatDuration(timeout)})`,
						),
					);
				}
			}, timeout);

			this.pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeoutId,
				procedure,
				startTime,
			});

			const message: RpcRequestMessage<Procedures, T> = {
				__rpc: true,
				v: PROTOCOL_VERSION,
				id,
				procedure,
				payload,
			};

			this.transport.send(message);
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
		if (isRpcResponse(msg)) {
			this.handleResponse(msg);
			return;
		}

		if (isRpcNotification(msg)) {
			this.handleNotification(msg.notification, msg.payload);
			return;
		}
	}

	private handleResponse(msg: RpcResponseMessage): void {
		const { id, procedure } = msg;
		const pending = this.pending.get(id);

		if (!pending) {
			return;
		}

		clearTimeout(pending.timeoutId);
		this.pending.delete(id);

		const duration = Date.now() - pending.startTime;

		if ('error' in msg) {
			this.config.logger.error(`[RpcClient] Error in "${procedure}": ${msg.error}`);
			pending.reject(new Error(msg.error));
		} else {
			this.config.logger.debug(
				`[RpcClient] "${procedure}" completed in ${formatDuration(duration)}`,
			);
			pending.resolve(msg.response);
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

	getPendingCount(): number {
		return this.pending.size;
	}

	isInitialized(): boolean {
		return this.initialized;
	}
}

function createRpcClient<
	Procedures extends RpcProcedureSchema,
	Notifications extends RpcNotificationSchema,
>(
	transport: RpcTransport,
	config?: Partial<RpcClientConfig>,
): RpcClient<Procedures, Notifications> {
	return new RpcClient<Procedures, Notifications>(transport, config);
}

export { RpcClient, createRpcClient };
