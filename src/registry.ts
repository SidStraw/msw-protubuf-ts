import {
	type MethodInfo,
	RpcError,
	type RpcMetadata,
	type ServiceInfo,
} from "@protobuf-ts/runtime-rpc";

import { markReply } from "./reply.js";
import { type GrpcMockSession, createGrpcMockSession } from "./session.js";
import type {
	GrpcMockRegistry,
	GrpcMockReply,
	MockHandler,
	ServerStreamResolver,
	UnaryMockValue,
	UnaryResolver,
} from "./types.js";

type ExtractInput<M> = M extends MethodInfo<infer I, object> ? I : never;
type ExtractOutput<M> = M extends MethodInfo<object, infer O> ? O : never;
type ServiceInput<S extends ServiceInfo> = ExtractInput<S["methods"][number]>;
type ServiceOutput<S extends ServiceInfo> = ExtractOutput<S["methods"][number]>;

function createKey(service: ServiceInfo, method: MethodInfo): string {
	return `${service.typeName}/${method.name}`;
}

function findMethod<I extends object, O extends object>(
	service: ServiceInfo,
	methodLocalName: string,
	expectedKind: "unary" | "serverStreaming",
): MethodInfo<I, O> {
	const method = service.methods.find(
		(entry) => entry.localName === methodLocalName,
	);

	if (!method) {
		throw new Error(
			`Unknown method for service "${service.typeName}": "${methodLocalName}".`,
		);
	}

	if (expectedKind === "unary" && method.serverStreaming) {
		throw new Error(
			`Method "${service.typeName}/${method.name}" is server streaming and cannot be registered with grpc.unary().`,
		);
	}

	if (expectedKind === "serverStreaming" && !method.serverStreaming) {
		throw new Error(
			`Method "${service.typeName}/${method.name}" is not server streaming and cannot be registered with grpc.serverStreaming().`,
		);
	}

	return method as MethodInfo<I, O>;
}

export type CreateGrpcMockRegistryOptions<
	TState extends object = Record<string, unknown>,
> =
	| {
			initialState?: TState;
			session?: never;
	  }
	| {
			initialState?: never;
			session?: GrpcMockSession<TState>;
	  };

class Registry<TState extends object> implements GrpcMockRegistry<TState> {
	readonly #registrations = new Map<
		string,
		MockHandler<object, object, TState>
	>();

	constructor(readonly session: GrpcMockSession<TState>) {}

	get size(): number {
		return this.#registrations.size;
	}

	register(...handlers: readonly MockHandler<object, object, TState>[]): this {
		for (const handler of handlers) {
			this.#registrations.set(handler.key, handler);
		}

		return this;
	}

	get<I extends object, O extends object>(
		methodOrKey: MethodInfo<I, O> | string,
	): MockHandler<I, O, TState> | undefined {
		const key =
			typeof methodOrKey === "string"
				? methodOrKey
				: createKey(methodOrKey.service, methodOrKey);

		return this.#registrations.get(key) as
			| MockHandler<I, O, TState>
			| undefined;
	}

	clear(): void {
		this.#registrations.clear();
	}

	entries(): IterableIterator<[string, MockHandler<object, object, TState>]> {
		return this.#registrations.entries();
	}

	unary<S extends ServiceInfo, N extends string>(
		service: S,
		methodLocalName: N,
		resolver: UnaryResolver<ServiceInput<S>, ServiceOutput<S>, TState>,
	): this;
	unary<S extends ServiceInfo, N extends string>(
		service: S,
		methodLocalName: N,
		response: UnaryMockValue<ServiceOutput<S>>,
	): this;
	unary<I extends object, O extends object>(
		service: ServiceInfo,
		methodLocalName: string,
		resolverOrResponse: UnaryResolver<I, O, TState> | UnaryMockValue<O>,
	): this {
		return this.register(
			grpc.unary(service, methodLocalName, resolverOrResponse),
		);
	}

	serverStreaming<S extends ServiceInfo, N extends string>(
		service: S,
		methodLocalName: N,
		resolver: ServerStreamResolver<ServiceInput<S>, ServiceOutput<S>, TState>,
	): this;
	serverStreaming<I extends object, O extends object>(
		service: ServiceInfo,
		methodLocalName: string,
		resolver: ServerStreamResolver<I, O, TState>,
	): this {
		return this.register(
			grpc.serverStreaming(service, methodLocalName, resolver),
		);
	}
}

function createReply<O extends object>(
	body: O,
	options: Omit<GrpcMockReply<O>, "body"> = {},
): GrpcMockReply<O> {
	return markReply({
		body,
		delay: options.delay,
		headers: options.headers ? { ...options.headers } : undefined,
		trailers: options.trailers ? { ...options.trailers } : undefined,
	});
}

function createUnaryHandler<
	I extends object,
	O extends object,
	TState extends object = Record<string, unknown>,
>(
	service: ServiceInfo,
	methodLocalName: string,
	resolverOrResponse: UnaryResolver<I, O, TState> | UnaryMockValue<O>,
): MockHandler<I, O, TState> {
	const method = findMethod<I, O>(service, methodLocalName, "unary");
	const resolver =
		typeof resolverOrResponse === "function"
			? resolverOrResponse
			: () => resolverOrResponse;

	return {
		key: createKey(service, method),
		kind: "unary",
		method,
		resolver: resolver as UnaryResolver<I, O, TState>,
	};
}

function createServerStreamingHandler<
	I extends object,
	O extends object,
	TState extends object = Record<string, unknown>,
>(
	service: ServiceInfo,
	methodLocalName: string,
	resolver: ServerStreamResolver<I, O, TState>,
): MockHandler<I, O, TState> {
	const method = findMethod<I, O>(service, methodLocalName, "serverStreaming");

	return {
		key: createKey(service, method),
		kind: "serverStreaming",
		method,
		resolver,
	};
}

export function createGrpcMockRegistry(): GrpcMockRegistry<
	Record<string, unknown>
>;
export function createGrpcMockRegistry<TState extends object>(
	options: CreateGrpcMockRegistryOptions<TState>,
): GrpcMockRegistry<TState>;
export function createGrpcMockRegistry<TState extends object>(
	options?: CreateGrpcMockRegistryOptions<TState>,
): GrpcMockRegistry<TState | Record<string, unknown>> {
	if (options?.session) {
		return new Registry(options.session);
	}

	if (options?.initialState) {
		return new Registry(createGrpcMockSession(options.initialState));
	}

	return new Registry(createGrpcMockSession());
}

function unary<
	S extends ServiceInfo,
	N extends string,
	TState extends object = Record<string, unknown>,
>(
	service: S,
	methodLocalName: N,
	resolver: UnaryResolver<ServiceInput<S>, ServiceOutput<S>, TState>,
): MockHandler<ServiceInput<S>, ServiceOutput<S>, TState>;
function unary<
	S extends ServiceInfo,
	N extends string,
	TState extends object = Record<string, unknown>,
>(
	service: S,
	methodLocalName: N,
	response: UnaryMockValue<ServiceOutput<S>>,
): MockHandler<ServiceInput<S>, ServiceOutput<S>, TState>;
function unary<
	I extends object,
	O extends object,
	TState extends object = Record<string, unknown>,
>(
	service: ServiceInfo,
	methodLocalName: string,
	resolver: UnaryResolver<I, O, TState>,
): MockHandler<I, O, TState>;
function unary<
	I extends object,
	O extends object,
	TState extends object = Record<string, unknown>,
>(
	service: ServiceInfo,
	methodLocalName: string,
	response: UnaryMockValue<O>,
): MockHandler<I, O, TState>;
function unary<
	I extends object,
	O extends object,
	TState extends object = Record<string, unknown>,
>(
	service: ServiceInfo,
	methodLocalName: string,
	resolverOrResponse: UnaryResolver<I, O, TState> | UnaryMockValue<O>,
): MockHandler<I, O, TState> {
	return createUnaryHandler(service, methodLocalName, resolverOrResponse);
}

function serverStreaming<
	S extends ServiceInfo,
	N extends string,
	TState extends object = Record<string, unknown>,
>(
	service: S,
	methodLocalName: N,
	resolver: ServerStreamResolver<ServiceInput<S>, ServiceOutput<S>, TState>,
): MockHandler<ServiceInput<S>, ServiceOutput<S>, TState>;
function serverStreaming<
	I extends object,
	O extends object,
	TState extends object = Record<string, unknown>,
>(
	service: ServiceInfo,
	methodLocalName: string,
	resolver: ServerStreamResolver<I, O, TState>,
): MockHandler<I, O, TState>;
function serverStreaming<
	I extends object,
	O extends object,
	TState extends object = Record<string, unknown>,
>(
	service: ServiceInfo,
	methodLocalName: string,
	resolver: ServerStreamResolver<I, O, TState>,
): MockHandler<I, O, TState> {
	return createServerStreamingHandler(service, methodLocalName, resolver);
}

function error(code: string, message: string, meta?: RpcMetadata): RpcError {
	return new RpcError(message, code, meta);
}

export const grpc = {
	unary,
	serverStreaming,
	error,
	reply: createReply,
} as const;
