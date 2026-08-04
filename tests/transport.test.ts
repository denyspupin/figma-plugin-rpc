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
	let currentOnMessage: ((msg: unknown) => void) | undefined;
	let mockOnMessageSetter: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockPostMessage = vi.fn();
		currentOnMessage = undefined;
		mockOnMessageSetter = vi.fn((fn: (msg: unknown) => void) => {
			currentOnMessage = fn;
		});

		vi.stubGlobal('figma', {
			ui: {
				postMessage: mockPostMessage,
				set onmessage(fn: (msg: unknown) => void) {
					mockOnMessageSetter(fn);
				},
				get onmessage() {
					return currentOnMessage;
				},
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('send calls figma.ui.postMessage', () => {
		const transport = new FigmaMainTransport();
		const message = { __rpc: true, id: '1', procedure: 'test', response: {} };

		transport.send(message);

		expect(mockPostMessage).toHaveBeenCalledWith(message);
	});

	it('onMessage sets figma.ui.onmessage and dispatches to handler', () => {
		const transport = new FigmaMainTransport();
		const handler = vi.fn();
		transport.onMessage(handler);

		expect(mockOnMessageSetter).toHaveBeenCalled();

		const onmessageFn = mockOnMessageSetter.mock.calls[0][0] as (msg: unknown) => void;
		const message = { __rpc: true, id: '1', procedure: 'test', payload: {} };
		onmessageFn(message);

		expect(handler).toHaveBeenCalledWith(message);
	});

	it('unsubscribe restores original onmessage when last handler removed', () => {
		const originalHandler = vi.fn();
		figma.ui.onmessage = originalHandler;

		const transport = new FigmaMainTransport();
		const handler = vi.fn();
		const unsub = transport.onMessage(handler);

		unsub();

		expect(figma.ui.onmessage).toBe(originalHandler);
	});

	it('unsubscribe sets a no-op when no original onmessage existed', () => {
		const transport = new FigmaMainTransport();
		const handler = vi.fn();
		const unsub = transport.onMessage(handler);

		unsub();

		expect(figma.ui.onmessage).toEqual(expect.any(Function));
		expect(() => (figma.ui.onmessage as (msg: unknown) => void)({})).not.toThrow();
	});

	it('does not clobber pre-existing onmessage when subscribing', () => {
		const originalHandler = vi.fn();
		figma.ui.onmessage = originalHandler;

		const transport = new FigmaMainTransport();
		transport.onMessage(vi.fn());

		expect(figma.ui.onmessage).not.toBe(originalHandler);
	});

	it('multiple subscribers share single figma.ui.onmessage', () => {
		const transport = new FigmaMainTransport();
		const handler1 = vi.fn();
		const handler2 = vi.fn();
		transport.onMessage(handler1);
		transport.onMessage(handler2);

		expect(mockOnMessageSetter).toHaveBeenCalledTimes(1);

		const onmessageFn = mockOnMessageSetter.mock.calls[0][0] as (msg: unknown) => void;
		onmessageFn({ test: true });

		expect(handler1).toHaveBeenCalled();
		expect(handler2).toHaveBeenCalled();
	});
});
