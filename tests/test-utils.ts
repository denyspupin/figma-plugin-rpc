import type { RpcTransport } from '../src/transport';

export class TestTransport implements RpcTransport {
	private handlers = new Set<(message: unknown) => void>();
	public sent: unknown[] = [];
	public peer: TestTransport | null = null;

	static createPair(): [TestTransport, TestTransport] {
		const a = new TestTransport();
		const b = new TestTransport();
		a.peer = b;
		b.peer = a;
		return [a, b];
	}

	send(message: unknown): void {
		this.sent.push(message);
		if (this.peer) {
			this.peer.deliver(message);
		}
	}

	onMessage(handler: (message: unknown) => void): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	deliver(message: unknown): void {
		for (const handler of this.handlers) {
			handler(message);
		}
	}

	getSentCount(): number {
		return this.sent.length;
	}

	getLastSent(): unknown {
		return this.sent[this.sent.length - 1];
	}

	reset(): void {
		this.sent = [];
	}
}
