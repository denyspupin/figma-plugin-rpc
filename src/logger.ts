/** Implementations must not throw; a throwing logger violates the logging contract. */
export interface Logger {
	log(...args: unknown[]): void;
	debug(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

export const noopLogger: Logger = {
	log: () => {},
	debug: () => {},
	warn: () => {},
	error: () => {},
};

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	const remainingMs = ms % 1000;
	if (remainingMs === 0) return `${seconds}s`;
	return `${seconds}s ${remainingMs}ms`;
}
