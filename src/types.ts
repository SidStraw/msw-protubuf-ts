import type {
	MethodInfo,
	RpcError,
	RpcMetadata,
	ServiceInfo,
} from "@protobuf-ts/runtime-rpc";

import type { GrpcMockSession } from "./session.js";

export interface StreamController<O extends object> {
	send(message: O): void;
	complete(): void;
	error(error: RpcError): void;
}

export interface GrpcMockContext<
	I extends object,
	O extends object,
	TState extends object = Record<string, unknown>,
> {
	request: I;
	method: MethodInfo<I, O>;
	meta: RpcMetadata;
	signal: AbortSignal;
	session: GrpcMockSession<TState>;
	passthrough(): never;
}

export interface GrpcMockReply<O extends object> {
	body: O;
	delay?: number | undefined;
	headers?: RpcMetadata | undefined;
	trailers?: RpcMetadata | undefined;
}

export type UnaryMockValue<O extends object> = O | GrpcMockReply<O>;

type ExtractInput<M> = M extends MethodInfo<infer I, object> ? I : never;
type ExtractOutput<M> = M extends MethodInfo<object, infer O> ? O : never;
type ServiceInput<S extends ServiceInfo> = ExtractInput<S["methods"][number]>;
type ServiceOutput<S extends ServiceInfo> = ExtractOutput<S["methods"][number]>;

type BivariantCallback<Args, Result> = {
	bivarianceHack(args: Args): Result;
}["bivarianceHack"];

export type UnaryResolver<
	I extends object,
	O extends object,
	TState extends object = Record<string, unknown>,
> = BivariantCallback<
	GrpcMockContext<I, O, TState>,
	UnaryMockValue<O> | Promise<UnaryMockValue<O>>
>;

export type ServerStreamResolver<
	I extends object,
	O extends object,
	TState extends object = Record<string, unknown>,
> = BivariantCallback<
	GrpcMockContext<I, O, TState> & { stream: StreamController<O> },
	// biome-ignore lint/suspicious/noConfusingVoidType: imperative stream resolvers intentionally return nothing.
	| void
	| Iterable<O>
	| AsyncIterable<O>
	| Promise<undefined | Iterable<O> | AsyncIterable<O>>
>;

export interface MockHandler<
	I extends object = object,
	O extends object = object,
	TState extends object = Record<string, unknown>,
> {
	key: string;
	kind: "unary" | "serverStreaming";
	method: MethodInfo<I, O>;
	resolver: UnaryResolver<I, O, TState> | ServerStreamResolver<I, O, TState>;
}

export interface GrpcMockRegistry<
	TState extends object = Record<string, unknown>,
> {
	readonly session: GrpcMockSession<TState>;
	readonly size: number;
	register(...handlers: readonly MockHandler<object, object, TState>[]): this;
	get<I extends object, O extends object>(
		method: MethodInfo<I, O>,
	): MockHandler<I, O, TState> | undefined;
	get(key: string): MockHandler<object, object, TState> | undefined;
	clear(): void;
	entries(): IterableIterator<[string, MockHandler<object, object, TState>]>;
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
		resolver: UnaryResolver<I, O, TState>,
	): this;
	unary<I extends object, O extends object>(
		service: ServiceInfo,
		methodLocalName: string,
		response: UnaryMockValue<O>,
	): this;
	serverStreaming<S extends ServiceInfo, N extends string>(
		service: S,
		methodLocalName: N,
		resolver: ServerStreamResolver<ServiceInput<S>, ServiceOutput<S>, TState>,
	): this;
	serverStreaming<I extends object, O extends object>(
		service: ServiceInfo,
		methodLocalName: string,
		resolver: ServerStreamResolver<I, O, TState>,
	): this;
}
