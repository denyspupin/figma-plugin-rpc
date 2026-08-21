import {
	createRpcClient,
	createRpcServer,
	type RpcMiddleware,
	type RpcNotification,
	type RpcNotificationSchema,
	type ProcedureConstraint,
	type RpcProcedure,
	type RpcProcedureError,
	type RpcProcedureSchema,
	type RpcRequest,
	type RpcResponse,
	type RpcTransport,
} from '../src';

interface TestProcedures extends RpcProcedureSchema {
	add: { request: { a: number; b: number }; response: { result: number } };
	getData: { request: void; response: { data: string } };
}

interface TestNotifications extends RpcNotificationSchema {
	update: { value: string };
	progress: { percent: number };
}

const transport = null as unknown as RpcTransport;
const client = createRpcClient<TestProcedures, TestNotifications>(transport);
const server = createRpcServer<TestProcedures, TestNotifications>(transport);

// === Known procedure names compile ===
client.call('add', { a: 1, b: 2 });
client.call('getData');
server.registerHandler('add', ({ a, b }) => ({ result: a + b }));
server.registerHandler('getData', () => ({ data: 'hello' }));

// === Unknown call names fail ===
// @ts-expect-error - unknown procedure
client.call('unknown-procedure', {});

// === Unknown registerHandler names fail ===
// @ts-expect-error - unknown procedure
server.registerHandler('unknown-procedure', () => ({}));

// === Unknown on names fail ===
// @ts-expect-error - unknown notification
client.on('unknown-notification', () => {});

// === Unknown notify names fail ===
// @ts-expect-error - unknown notification
server.notify('unknown-notification', {});

// === Wrong request payloads fail ===
// @ts-expect-error - wrong payload type
client.call('add', { a: 'not a number', b: 2 });

// === Wrong handler response values fail ===
// @ts-expect-error - wrong response type
server.registerHandler('add', () => ({ result: 'not a number' }));

// === Void requests retain optional-payload ergonomics ===
client.call('getData');
client.call('getData', undefined);

// === Notification payload inference remains exact ===
client.on('update', (payload) => {
	const _value: string = payload.value;
	void _value;
});
client.on('progress', (payload) => {
	const _percent: number = payload.percent;
	void _percent;
});
server.notify('update', { value: 'test' });
server.notify('progress', { percent: 50 });

// === Wrong notification payloads fail ===
// @ts-expect-error - wrong notification payload
server.notify('update', { value: 123 });
// @ts-expect-error - wrong notification payload
client.on('progress', (payload: { percent: string }) => {
	void payload;
});

// === Bare RpcProcedure resolves to string ===
type AnyProcedure = RpcProcedure;
const _anyProc: AnyProcedure = 'anything';
void _anyProc;

type AnyNotification = RpcNotification;
const _anyNotif: AnyNotification = 'anything';
void _anyNotif;

// === string extends RpcProcedure<ConcreteProcedures> is false ===
type ConcreteProc = RpcProcedure<TestProcedures>;
type IsNarrow = string extends ConcreteProc ? false : true;
const _isNarrow: IsNarrow = true;
void _isNarrow;

// === Default request and response types do not collapse to never ===
type DefaultRequest = RpcRequest<TestProcedures, 'add'>;
const _defaultReq: DefaultRequest = { a: 1, b: 2 };
void _defaultReq;

type DefaultResponse = RpcResponse<TestProcedures, 'add'>;
const _defaultRes: DefaultResponse = { result: 3 };
void _defaultRes;

// === Marker interface preserves literal names ===
type ProcNames = RpcProcedure<TestProcedures>;
const _procName: ProcNames = 'add';
void _procName;
// @ts-expect-error - not a literal name
const _badName: ProcNames = 'unknown';
void _badName;

// === Schema with missing fields fails when passed to client/server ===
interface BadProcedure extends RpcProcedureSchema {
	bad: { request: string };
}

// @ts-expect-error - missing 'response' in procedure definition
createRpcClient<BadProcedure, TestNotifications>(transport);

// === Notification schemas must be objects ===
// @ts-expect-error - primitive notification schemas are invalid
createRpcClient<TestProcedures, string>(transport);
// @ts-expect-error - primitive notification schemas are invalid
createRpcServer<TestProcedures, number>(transport);

// === Optional declared error metadata remains extractable ===
interface ErrorProcedures extends RpcProcedureSchema {
	optionalError: {
		request: void;
		response: void;
		error?: { code: 'OPTIONAL'; detail: string };
	};
	requiredError: {
		request: void;
		response: void;
		error: { code: 'REQUIRED' };
	};
	noError: {
		request: void;
		response: void;
	};
}

type OptionalError = RpcProcedureError<ErrorProcedures, 'optionalError'>;
const _optionalError: OptionalError = { code: 'OPTIONAL', detail: 'details' };
void _optionalError;

type RequiredError = RpcProcedureError<ErrorProcedures, 'requiredError'>;
const _requiredError: RequiredError = { code: 'REQUIRED' };
void _requiredError;

type NoError = RpcProcedureError<ErrorProcedures, 'noError'>;
// @ts-expect-error - procedures without error metadata extract to never
const _noError: NoError = { code: 'NONE' };
void _noError;

// === Generic wrappers use the self-mapped procedure constraint ===
function createGenericClient<
	Procedures extends ProcedureConstraint<Procedures>,
	Notifications extends object,
>(genericTransport: RpcTransport) {
	return createRpcClient<Procedures, Notifications>(genericTransport);
}

void createGenericClient<TestProcedures, TestNotifications>;

// === Middleware usage compiles exactly as documented in README ===
const timingMiddleware: RpcMiddleware = async (ctx) => {
	const start = Date.now();
	try {
		return await ctx.next();
	} finally {
		void (Date.now() - start);
	}
};

createRpcServer<TestProcedures, TestNotifications>(transport, {
	middleware: [timingMiddleware],
});
