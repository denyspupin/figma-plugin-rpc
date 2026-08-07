export class RpcError extends Error {
	public readonly code: string;
	public readonly data?: unknown;

	constructor(code: string, message: string, data?: unknown) {
		super(message);
		this.name = 'RpcError';
		this.code = code;
		this.data = data;
	}
}
