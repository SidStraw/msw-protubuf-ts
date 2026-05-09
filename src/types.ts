import type {
	MethodInfo,
	RpcError,
	RpcMetadata,
	ServiceInfo,
} from "@protobuf-ts/runtime-rpc";

export interface StreamController<O extends object> {
	send(message: O): void;
	complete(): void;
	error(error: RpcError): void;
}

export interface GrpcMockContext<I extends object, O extends object> {
	request: I;
	method: MethodInfo<I, O>;
	meta: RpcMetadata;
	signal: AbortSignal;
	passthrough(): never;
}

export interface GrpcMockReply<O extends object> {
	body: O;
	delay?: number | undefined;
	headers?: RpcMetadata | undefined;
	trailers?: RpcMetadata | undefined;
}

type BivariantCallback<Args, Result> = {
	bivarianceHack(args: Args): Result;
}["bivarianceHack"];

export type UnaryResolver<
	I extends object,
	O extends object,
> = BivariantCallback<
	GrpcMockContext<I, O>,
	O | GrpcMockReply<O> | Promise<O | GrpcMockReply<O>>
>;

export type ServerStreamResolver<
	I extends object,
	O extends object,
> = BivariantCallback<
	GrpcMockContext<I, O> & { stream: StreamController<O> },
	// biome-ignore lint/suspicious/noConfusingVoidType: imperative stream resolvers intentionally return nothing.
	| void
	| Iterable<O>
	| AsyncIterable<O>
	| Promise<undefined | Iterable<O> | AsyncIterable<O>>
>;

export interface MockHandler<
	I extends object = object,
	O extends object = object,
> {
	key: string;
	kind: "unary" | "serverStreaming";
	method: MethodInfo<I, O>;
	resolver: UnaryResolver<I, O> | ServerStreamResolver<I, O>;
}

export interface GrpcMockRegistry {
	readonly size: number;
	register(...handlers: readonly MockHandler<object, object>[]): this;
	get<I extends object, O extends object>(
		method: MethodInfo<I, O>,
	): MockHandler<I, O> | undefined;
	get(key: string): MockHandler | undefined;
	clear(): void;
	entries(): IterableIterator<[string, MockHandler<object, object>]>;
	unary<I extends object, O extends object>(
		service: ServiceInfo,
		methodLocalName: string,
		resolver: UnaryResolver<I, O>,
	): this;
	serverStreaming<I extends object, O extends object>(
		service: ServiceInfo,
		methodLocalName: string,
		resolver: ServerStreamResolver<I, O>,
	): this;
}
