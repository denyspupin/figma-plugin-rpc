// jsdom environment required: FigmaUiTransport uses window.addEventListener / window.postMessage
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FigmaMainTransport, FigmaUiTransport } from '../src';

describe('FigmaUiTransport', () => {
	let postMessageSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		postMessageSpy = vi.spyOn(window, 'postMessage');
	});

	afterEach(() => {
		postMessageSpy.mockRestore();
	});

	it('send wraps message in pluginMessage envelope', () => {
		const transport = new FigmaUiTransport();
		const message = { __rpc: true, id: '1', procedure: 'test', payload: {} };

		transport.send(message);

		expect(postMessageSpy).toHaveBeenCalledWith({ pluginMessage: message }, '*');
	});

	it('onMessage unwraps pluginMessage and calls handler', () => {
		const transport = new FigmaUiTransport();
		const handler = vi.fn();
		transport.onMessage(handler);

		const message = { __rpc: true, id: '1', procedure: 'test', response: {} };
		window.dispatchEvent(new MessageEvent('message', { data: { pluginMessage: message } }));

		expect(handler).toHaveBeenCalledWith(message);
	});

	it('onMessage ignores messages without pluginMessage', () => {
		const transport = new FigmaUiTransport();
		const handler = vi.fn();
		transport.onMessage(handler);

		window.dispatchEvent(new MessageEvent('message', { data: { other: true } }));

		expect(handler).not.toHaveBeenCalled();
	});

	it('unsubscribe removes listener', () => {
		const transport = new FigmaUiTransport();
		const handler = vi.fn();
		const unsub = transport.onMessage(handler);

		unsub();

		window.dispatchEvent(
			new MessageEvent('message', { data: { pluginMessage: { test: true } } }),
		);

		expect(handler).not.toHaveBeenCalled();
	});

	it('multiple subscribers all receive messages', () => {
		const transport = new FigmaUiTransport();
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		transport.onMessage(handler1);
		transport.onMessage(handler2);

		window.dispatchEvent(
			new MessageEvent('message', { data: { pluginMessage: { test: true } } }),
		);

		expect(handler1).toHaveBeenCalled();
		expect(handler2).toHaveBeenCalled();
	});
});

describe('FigmaMainTransport', () => {
	let mockPostMessage: ReturnType<typeof vi.fn>;
	let mockOn: ReturnType<typeof vi.fn>;
	let mockOff: ReturnType<typeof vi.fn>;
	let registeredHandlers: Set<(pluginMessage: unknown) => void>;

	beforeEach(() => {
		mockPostMessage = vi.fn();
		registeredHandlers = new Set();
		mockOn = vi.fn((type: string, callback: (pluginMessage: unknown) => void) => {
			if (type === 'message') {
				registeredHandlers.add(callback);
			}
		});
		mockOff = vi.fn((type: string, callback: (pluginMessage: unknown) => void) => {
			if (type === 'message') {
				registeredHandlers.delete(callback);
			}
		});

		vi.stubGlobal('figma', {
			ui: {
				postMessage: mockPostMessage,
				on: mockOn,
				off: mockOff,
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function simulateMessage(message: unknown) {
		for (const handler of registeredHandlers) {
			handler(message);
		}
	}

	it('send calls figma.ui.postMessage', () => {
		const transport = new FigmaMainTransport();
		const message = { __rpc: true, id: '1', procedure: 'test', response: {} };

		transport.send(message);

		expect(mockPostMessage).toHaveBeenCalledWith(message);
	});

	it('onMessage registers a message handler via figma.ui.on', () => {
		const transport = new FigmaMainTransport();
		const handler = vi.fn();
		transport.onMessage(handler);

		expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));

		const message = { __rpc: true, id: '1', procedure: 'test', payload: {} };
		simulateMessage(message);

		expect(handler).toHaveBeenCalledWith(message);
	});

	it('unsubscribe removes handler via figma.ui.off when last handler removed', () => {
		const transport = new FigmaMainTransport();
		const handler = vi.fn();
		const unsub = transport.onMessage(handler);

		unsub();

		expect(mockOff).toHaveBeenCalledWith('message', expect.any(Function));
	});

	it('unsubscribe does not call figma.ui.off if other handlers remain', () => {
		const transport = new FigmaMainTransport();
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		const unsub1 = transport.onMessage(handler1);
		transport.onMessage(handler2);

		unsub1();

		expect(mockOff).not.toHaveBeenCalled();

		const message = { test: true };
		simulateMessage(message);

		expect(handler1).not.toHaveBeenCalled();
		expect(handler2).toHaveBeenCalledWith(message);
	});

	it('multiple subscribers share single figma.ui.on registration', () => {
		const transport = new FigmaMainTransport();
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		transport.onMessage(handler1);
		transport.onMessage(handler2);

		expect(mockOn).toHaveBeenCalledTimes(1);

		simulateMessage({ test: true });

		expect(handler1).toHaveBeenCalled();
		expect(handler2).toHaveBeenCalled();
	});

	it('does not interfere with other figma.ui.on listeners', () => {
		const externalHandler = vi.fn();
		figma.ui.on('message', externalHandler);

		const transport = new FigmaMainTransport();
		const rpcHandler = vi.fn();
		transport.onMessage(rpcHandler);

		const message = { test: true };
		simulateMessage(message);

		expect(rpcHandler).toHaveBeenCalledWith(message);
		expect(externalHandler).toHaveBeenCalledWith(message);
	});
});
