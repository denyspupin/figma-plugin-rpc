export interface PendingCallConfig {
	id: string;
	procedure: string;
	startTime: number;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
	onSettle: (id: string) => void;
	cleanupAbort?: () => void;
}

export class PendingCall {
	private settled = false;
	private readonly config: PendingCallConfig;

	constructor(config: PendingCallConfig) {
		this.config = config;
	}

	get id(): string {
		return this.config.id;
	}

	get procedure(): string {
		return this.config.procedure;
	}

	get startTime(): number {
		return this.config.startTime;
	}

	get isSettled(): boolean {
		return this.settled;
	}

	duration(): number {
		return Date.now() - this.config.startTime;
	}

	resolve(value: unknown): void {
		if (this.settled) return;
		this.settle();
		this.config.resolve(value);
	}

	reject(error: Error): void {
		if (this.settled) return;
		this.settle();
		this.config.reject(error);
	}

	private settle(): void {
		this.settled = true;
		clearTimeout(this.config.timeoutId);
		this.config.cleanupAbort?.();
		this.config.onSettle(this.config.id);
	}
}
