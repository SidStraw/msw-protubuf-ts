import {
	type MethodInfo,
	RpcError,
	type RpcMetadata,
	type ServiceInfo,
} from "@protobuf-ts/runtime-rpc";

import { markReply } from "./reply.js";
import type {
	GrpcMockRegistry,
	GrpcMockReply,
	MockHandler,
	ServerStreamResolver,
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

class Registry implements GrpcMockRegistry {
	readonly #registrations = new Map<string, MockHandler<object, object>>();

	get size(): number {
		return this.#registrations.size;
	}

	register(...handlers: readonly MockHandler<object, object>[]): this {
		for (const handler of handlers) {
			this.#registrations.set(handler.key, handler);
		}

		return this;
	}

	get<I extends object, O extends object>(
		methodOrKey: MethodInfo<I, O> | string,
	): MockHandler<I, O> | undefined {
		const key =
			typeof methodOrKey === "string"
				? methodOrKey
				: createKey(methodOrKey.service, methodOrKey);

		return this.#registrations.get(key) as MockHandler<I, O> | undefined;
	}

	clear(): void {
		this.#registrations.clear();
	}

	entries(): IterableIterator<[string, MockHandler<object, object>]> {
		return this.#registrations.entries();
	}

	unary<I extends object, O extends object>(
		service: ServiceInfo,
		methodLocalName: string,
		resolver: UnaryResolver<I, O>,
	): this {
		return this.register(grpc.unary(service, methodLocalName, resolver));
	}

	serverStreaming<I extends object, O extends object>(
		service: ServiceInfo,
		methodLocalName: string,
		resolver: ServerStreamResolver<I, O>,
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

function createUnaryHandler<I extends object, O extends object>(
	service: ServiceInfo,
	methodLocalName: string,
	resolver: UnaryResolver<I, O>,
): MockHandler<I, O> {
	const method = findMethod<I, O>(service, methodLocalName, "unary");

	return {
		key: createKey(service, method),
		kind: "unary",
		method,
		resolver,
	};
}

function createServerStreamingHandler<I extends object, O extends object>(
	service: ServiceInfo,
	methodLocalName: string,
	resolver: ServerStreamResolver<I, O>,
): MockHandler<I, O> {
	const method = findMethod<I, O>(service, methodLocalName, "serverStreaming");

	return {
		key: createKey(service, method),
		kind: "serverStreaming",
		method,
		resolver,
	};
}

export function createGrpcMockRegistry(): GrpcMockRegistry {
	return new Registry();
}

function unary<S extends ServiceInfo, N extends string>(
	service: S,
	methodLocalName: N,
	resolver: UnaryResolver<ServiceInput<S>, ServiceOutput<S>>,
): MockHandler<ServiceInput<S>, ServiceOutput<S>>;
function unary<I extends object, O extends object>(
	service: ServiceInfo,
	methodLocalName: string,
	resolver: UnaryResolver<I, O>,
): MockHandler<I, O>;
function unary<I extends object, O extends object>(
	service: ServiceInfo,
	methodLocalName: string,
	resolver: UnaryResolver<I, O>,
): MockHandler<I, O> {
	return createUnaryHandler(service, methodLocalName, resolver);
}

function serverStreaming<S extends ServiceInfo, N extends string>(
	service: S,
	methodLocalName: N,
	resolver: ServerStreamResolver<ServiceInput<S>, ServiceOutput<S>>,
): MockHandler<ServiceInput<S>, ServiceOutput<S>>;
function serverStreaming<I extends object, O extends object>(
	service: ServiceInfo,
	methodLocalName: string,
	resolver: ServerStreamResolver<I, O>,
): MockHandler<I, O>;
function serverStreaming<I extends object, O extends object>(
	service: ServiceInfo,
	methodLocalName: string,
	resolver: ServerStreamResolver<I, O>,
): MockHandler<I, O> {
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
