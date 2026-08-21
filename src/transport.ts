/// <reference types="@figma/plugin-typings" />

export interface RpcTransport {
	send(message: unknown): void;
	onMessage(handler: (message: unknown) => void): () => void;
}

export class FigmaUiTransport implements RpcTransport {
	private handlers = new Set<(message: unknown) => void>();
	private listener: ((event: MessageEvent) => void) | null = null;

	send(message: unknown): void {
		parent.postMessage({ pluginMessage: message }, '*');
	}

	onMessage(handler: (message: unknown) => void): () => void {
		this.handlers.add(handler);

		if (!this.listener) {
			this.listener = (event: MessageEvent) => {
				if (event.source !== parent) {
					return;
				}

				const msg = event.data?.pluginMessage;
				if (msg !== undefined) {
					for (const h of this.handlers) {
						h(msg);
					}
				}
			};
			window.addEventListener('message', this.listener);
		}

		return () => {
			this.handlers.delete(handler);
			if (this.handlers.size === 0 && this.listener) {
				window.removeEventListener('message', this.listener);
				this.listener = null;
			}
		};
	}
}

export class FigmaMainTransport implements RpcTransport {
	private handlers = new Set<(message: unknown) => void>();
	private messageHandler: ((pluginMessage: unknown) => void) | null = null;

	send(message: unknown): void {
		figma.ui.postMessage(message);
	}

	onMessage(handler: (message: unknown) => void): () => void {
		this.handlers.add(handler);

		if (!this.messageHandler) {
			this.messageHandler = (pluginMessage: unknown) => {
				for (const h of this.handlers) {
					h(pluginMessage);
				}
			};
			figma.ui.on('message', this.messageHandler);
		}

		return () => {
			this.handlers.delete(handler);
			if (this.handlers.size === 0 && this.messageHandler) {
				figma.ui.off('message', this.messageHandler);
				this.messageHandler = null;
			}
		};
	}
}
