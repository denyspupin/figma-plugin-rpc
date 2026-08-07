import { nanoid } from 'nanoid';
import type {
	RpcNotification,
	RpcNotificationPayload,
	RpcProcedure,
	RpcRequest,
	RpcRequestMessage,
	RpcResponse,
	ProcedureConstraint,
} from './types';
import { PROTOCOL_VERSION } from './types';
import { decodeRpcMessage, type DecodedRpcResponse } from './protocol';
import { formatDuration, noopLogger, type Logger } from './transport';
import type { RpcTransport } from './transport';
import { RpcError } from './error';
import { PendingCall } from './pending-call';

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

class RpcClient<Procedures extends ProcedureConstraint<Procedures>, Notifications extends object> {
	private pending = new Map<string, PendingCall>();
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
		this.safeLog('log', '[RpcClient] Initialized');
	}

	destroy(): void {
		if (this.initialized) {
			this.unsubscribeTransport?.();
		}
		this.unsubscribeTransport = null;

		for (const [, call] of this.pending) {
			call.reject(new Error(`RPC client destroyed while "${call.procedure}" was pending`));
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
			return Promise.reject(new Error('RPC client not initialized. Call init() first.'));
		}

		const [payload, options] = args;
		const id = nanoid();
		const timeout = options?.timeout ?? this.config.defaultTimeout;
		const startTime = Date.now();

		this.safeLog('debug', `[RpcClient] "${procedure}"`);

		return new Promise<RpcResponse<Procedures, T>>((resolve, reject) => {
			const signal = options?.signal;

			if (signal?.aborted) {
				const error = new Error(`RPC call "${procedure}" was aborted`);
				error.name = 'AbortError';
				reject(error);
				return;
			}

			let cleanupAbort: (() => void) | undefined;

			const timeoutId = setTimeout(() => {
				const call = this.pending.get(id);
				if (call) {
					const elapsed = Date.now() - call.startTime;
					call.reject(
						new Error(
							`RPC call "${procedure}" timed out after ${formatDuration(elapsed)} (limit: ${formatDuration(timeout)})`,
						),
					);
				}
			}, timeout);

			if (signal && typeof signal.addEventListener === 'function') {
				const abortHandler = () => {
					const call = this.pending.get(id);
					if (call) {
						const error = new Error(`RPC call "${procedure}" was aborted`);
						error.name = 'AbortError';
						call.reject(error);
					}
				};

				signal.addEventListener('abort', abortHandler, { once: true });

				cleanupAbort = () => {
					signal.removeEventListener('abort', abortHandler);
				};
			}

			const call = new PendingCall({
				id,
				procedure,
				startTime,
				resolve: resolve as (value: unknown) => void,
				reject,
				timeoutId,
				cleanupAbort,
				onSettle: (settledId) => {
					this.pending.delete(settledId);
				},
			});

			this.pending.set(id, call);

			const message: RpcRequestMessage<Procedures, T> = {
				__rpc: true,
				v: PROTOCOL_VERSION,
				id,
				procedure,
				payload,
			};

			try {
				this.transport.send(message);
			} catch (error) {
				call.reject(error instanceof Error ? error : new Error(String(error)));
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
			if (correlation?.kind === 'response') {
				const call = this.pending.get(correlation.id);
				if (call) {
					call.reject(
						new Error(
							`Protocol error for "${call.procedure}": ${decoded.error.reason}`,
						),
					);
				}
			}

			this.safeLog(
				'debug',
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
			call.reject(
				new Error(
					`Protocol error: response procedure "${procedure}" does not match pending "${call.procedure}" for id "${id}"`,
				),
			);
			return;
		}

		const duration = call.duration();

		if (!decoded.success) {
			const error = decoded.error ?? 'Unknown error';
			if (decoded.code) {
				call.reject(new RpcError(decoded.code, error, decoded.data));
			} else {
				call.reject(new Error(error));
			}
			this.safeLog('error', `[RpcClient] Error in "${procedure}": ${error}`);
		} else {
			call.resolve(decoded.response);
			this.safeLog(
				'debug',
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
				this.safeLog('error', `[RpcClient] Error in handler for "${notification}":`, error);
			}
		}
	}

	private safeLog(level: 'log' | 'debug' | 'warn' | 'error', ...args: unknown[]): void {
		try {
			this.config.logger[level](...args);
		} catch {
			// logging must not alter client lifecycle or settlement
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
	Procedures extends ProcedureConstraint<Procedures>,
	Notifications extends object,
>(
	transport: RpcTransport,
	config?: Partial<RpcClientConfig>,
): RpcClient<Procedures, Notifications> {
	return new RpcClient<Procedures, Notifications>(transport, config);
}

export { RpcClient, createRpcClient };
