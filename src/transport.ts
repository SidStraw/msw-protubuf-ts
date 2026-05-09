import {
	Deferred,
	type MethodInfo,
	RpcError,
	type RpcMetadata,
	type RpcOptions,
	RpcOutputStreamController,
	type RpcStatus,
	type RpcTransport,
	ServerStreamingCall,
	UnaryCall,
	mergeRpcOptions,
} from "@protobuf-ts/runtime-rpc";

import { type InternalReply, isReply, markReply } from "./reply.js";
import type {
	GrpcMockContext,
	GrpcMockRegistry,
	MockHandler,
	UnaryResolver,
} from "./types.js";

const PASSTHROUGH_MARKER = Symbol("grpc-mock-passthrough");

type UnhandledMode = "error" | "warn";

export interface CreateGrpcMockTransportOptions {
	registry: GrpcMockRegistry;
	fallbackTransport?: RpcTransport;
	onUnhandledRequest?: UnhandledMode;
	defaultOptions?: RpcOptions;
}

function cloneMetadata(meta?: RpcMetadata): RpcMetadata {
	return meta ? { ...meta } : {};
}

function createOkStatus(): RpcStatus {
	return { code: "OK", detail: "OK" };
}

function isPassthrough(
	value: unknown,
): value is { [PASSTHROUGH_MARKER]: true } {
	return (
		typeof value === "object" &&
		value !== null &&
		PASSTHROUGH_MARKER in value &&
		(value as { [PASSTHROUGH_MARKER]: true })[PASSTHROUGH_MARKER] === true
	);
}

function passthrough(): never {
	throw { [PASSTHROUGH_MARKER]: true };
}

function decorateRpcError(
	error: unknown,
	method: MethodInfo<object, object>,
	fallbackMessage = "Mock RPC handler failed.",
): RpcError {
	const rpcError =
		error instanceof RpcError
			? error
			: new RpcError(
					error instanceof Error ? error.message : fallbackMessage,
					"INTERNAL",
				);

	rpcError.methodName ??= method.name;
	rpcError.serviceName ??= method.service.typeName;
	return rpcError;
}

function createCancelledError(method: MethodInfo<object, object>): RpcError {
	return decorateRpcError(
		new RpcError("Request cancelled.", "CANCELLED"),
		method,
		"Request cancelled.",
	);
}

function delay(
	ms: number | undefined,
	abort: AbortSignal | undefined,
	method: MethodInfo<object, object>,
): Promise<void> {
	if (!ms || ms <= 0) {
		if (abort?.aborted) {
			return Promise.reject(createCancelledError(method));
		}

		return Promise.resolve();
	}

	return new Promise<void>((resolve, reject) => {
		if (abort?.aborted) {
			reject(createCancelledError(method));
			return;
		}

		const timer = setTimeout(() => {
			abort?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		const onAbort = () => {
			clearTimeout(timer);
			abort?.removeEventListener("abort", onAbort);
			reject(createCancelledError(method));
		};

		abort?.addEventListener("abort", onAbort, { once: true });
	});
}

function suppressUnhandled(...promises: readonly Promise<unknown>[]): void {
	for (const promise of promises) {
		promise.catch(() => {});
	}
}

function createContext<I extends object, O extends object>(
	method: MethodInfo<I, O>,
	request: I,
	options: RpcOptions,
): GrpcMockContext<I, O> {
	return {
		request,
		method,
		meta: cloneMetadata(options.meta),
		signal: options.abort ?? new AbortController().signal,
		passthrough,
	};
}

function createUnhandledError<I extends object, O extends object>(
	method: MethodInfo<I, O>,
	mode: UnhandledMode,
): RpcError {
	const message = `Unhandled mock RPC method: ${method.service.typeName}/${method.name}.`;

	if (mode === "warn") {
		console.warn(message);
	}

	return decorateRpcError(
		new RpcError(message, "UNIMPLEMENTED"),
		method,
		message,
	);
}

function normalizeReply<O extends object>(
	value:
		| O
		| InternalReply<O>
		| {
				body: O;
				delay?: number | undefined;
				headers?: RpcMetadata | undefined;
				trailers?: RpcMetadata | undefined;
		  },
): InternalReply<O> {
	if (isReply<O>(value)) {
		return value;
	}

	if (
		typeof value === "object" &&
		value !== null &&
		"body" in value &&
		("delay" in value || "headers" in value || "trailers" in value)
	) {
		return markReply(
			value as {
				body: O;
				delay?: number | undefined;
				headers?: RpcMetadata | undefined;
				trailers?: RpcMetadata | undefined;
			},
		);
	}

	return markReply({ body: value as O });
}

function pipeUnaryCall<I extends object, O extends object>(
	delegatedCall: UnaryCall<I, O>,
	headers: Deferred<RpcMetadata>,
	response: Deferred<O>,
	status: Deferred<RpcStatus>,
	trailers: Deferred<RpcMetadata>,
): void {
	void delegatedCall.headers.then(
		(value) => headers.resolvePending(value),
		(error) => headers.rejectPending(error),
	);
	void delegatedCall.response.then(
		(value) => response.resolvePending(value),
		(error) => response.rejectPending(error),
	);
	void delegatedCall.status.then(
		(value) => status.resolvePending(value),
		(error) => status.rejectPending(error),
	);
	void delegatedCall.trailers.then(
		(value) => trailers.resolvePending(value),
		(error) => trailers.rejectPending(error),
	);
}

function pipeServerStreamingCall<I extends object, O extends object>(
	delegatedCall: ServerStreamingCall<I, O>,
	headers: Deferred<RpcMetadata>,
	responses: RpcOutputStreamController<O>,
	status: Deferred<RpcStatus>,
	trailers: Deferred<RpcMetadata>,
): void {
	void delegatedCall.headers.then(
		(value) => headers.resolvePending(value),
		(error) => headers.rejectPending(error),
	);
	delegatedCall.responses.onMessage((message) => {
		if (!responses.closed) {
			responses.notifyMessage(message);
		}
	});
	delegatedCall.responses.onComplete(() => {
		if (!responses.closed) {
			responses.notifyComplete();
		}
	});
	delegatedCall.responses.onError((error) => {
		if (!responses.closed) {
			responses.notifyError(error);
		}
	});
	void delegatedCall.status.then(
		(value) => status.resolvePending(value),
		(error) => status.rejectPending(error),
	);
	void delegatedCall.trailers.then(
		(value) => trailers.resolvePending(value),
		(error) => trailers.rejectPending(error),
	);
}

function asUnaryResolver<I extends object, O extends object>(
	handler: MockHandler<I, O>,
): UnaryResolver<I, O> {
	return handler.resolver as UnaryResolver<I, O>;
}

function isIterable<T extends object>(
	value: unknown,
): value is Iterable<T> | AsyncIterable<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		(Symbol.iterator in value || Symbol.asyncIterator in value)
	);
}

export class MockRpcTransport implements RpcTransport {
	readonly #registry: GrpcMockRegistry;
	readonly #fallbackTransport: RpcTransport | undefined;
	readonly #onUnhandledRequest: UnhandledMode;
	readonly #defaultOptions: RpcOptions;

	constructor(options: CreateGrpcMockTransportOptions) {
		this.#registry = options.registry;
		this.#fallbackTransport = options.fallbackTransport;
		this.#onUnhandledRequest = options.onUnhandledRequest ?? "error";
		this.#defaultOptions = options.defaultOptions ?? {};
	}

	mergeOptions(options?: Partial<RpcOptions>): RpcOptions {
		return mergeRpcOptions(this.#defaultOptions, options);
	}

	unary<I extends object, O extends object>(
		method: MethodInfo<I, O>,
		input: I,
		options: RpcOptions,
	): UnaryCall<I, O> {
		const handler = this.#registry.get(method);

		if (!handler) {
			if (this.#fallbackTransport) {
				return this.#fallbackTransport.unary(method, input, options);
			}

			const error = createUnhandledError(method, this.#onUnhandledRequest);
			return this.#createErroredUnaryCall(method, input, options, error);
		}

		const requestHeaders = cloneMetadata(options.meta);
		const headers = new Deferred<RpcMetadata>(true);
		const response = new Deferred<O>(true);
		const status = new Deferred<RpcStatus>(true);
		const trailers = new Deferred<RpcMetadata>(true);
		const call = new UnaryCall(
			method,
			requestHeaders,
			input,
			headers.promise,
			response.promise,
			status.promise,
			trailers.promise,
		);

		suppressUnhandled(
			headers.promise,
			response.promise,
			status.promise,
			trailers.promise,
		);

		void this.#runUnaryHandler(
			method,
			input,
			options,
			asUnaryResolver(handler),
			headers,
			response,
			status,
			trailers,
		);

		return call;
	}

	serverStreaming<I extends object, O extends object>(
		method: MethodInfo<I, O>,
		input: I,
		options: RpcOptions,
	): ServerStreamingCall<I, O> {
		const handler = this.#registry.get(method);

		if (!handler) {
			if (this.#fallbackTransport) {
				return this.#fallbackTransport.serverStreaming(method, input, options);
			}

			const error = createUnhandledError(method, this.#onUnhandledRequest);
			return this.#createErroredServerStreamingCall(
				method,
				input,
				options,
				error,
			);
		}

		const requestHeaders = cloneMetadata(options.meta);
		const headers = new Deferred<RpcMetadata>(true);
		const responses = new RpcOutputStreamController<O>();
		const status = new Deferred<RpcStatus>(true);
		const trailers = new Deferred<RpcMetadata>(true);
		const call = new ServerStreamingCall(
			method,
			requestHeaders,
			input,
			headers.promise,
			responses,
			status.promise,
			trailers.promise,
		);

		suppressUnhandled(headers.promise, status.promise, trailers.promise);

		void this.#runServerStreamingHandler(
			method,
			input,
			options,
			handler,
			headers,
			responses,
			status,
			trailers,
		);

		return call;
	}

	clientStreaming<I extends object, O extends object>(
		method: MethodInfo<I, O>,
		_options: RpcOptions,
	): never {
		throw decorateRpcError(
			new RpcError(
				`gRPC-Web does not support client streaming for ${method.service.typeName}/${method.name}.`,
				"UNIMPLEMENTED",
			),
			method,
		);
	}

	duplex<I extends object, O extends object>(
		method: MethodInfo<I, O>,
		_options: RpcOptions,
	): never {
		throw decorateRpcError(
			new RpcError(
				`gRPC-Web does not support duplex streaming for ${method.service.typeName}/${method.name}.`,
				"UNIMPLEMENTED",
			),
			method,
		);
	}

	#createErroredUnaryCall<I extends object, O extends object>(
		method: MethodInfo<I, O>,
		input: I,
		options: RpcOptions,
		error: RpcError,
	): UnaryCall<I, O> {
		const requestHeaders = cloneMetadata(options.meta);
		const headers = Promise.reject(error);
		const response = Promise.reject(error);
		const status = Promise.reject(error);
		const trailers = Promise.reject(error);

		suppressUnhandled(headers, response, status, trailers);

		return new UnaryCall(
			method,
			requestHeaders,
			input,
			headers,
			response,
			status,
			trailers,
		);
	}

	#createErroredServerStreamingCall<I extends object, O extends object>(
		method: MethodInfo<I, O>,
		input: I,
		options: RpcOptions,
		error: RpcError,
	): ServerStreamingCall<I, O> {
		const requestHeaders = cloneMetadata(options.meta);
		const headers = Promise.reject(error);
		const responses = new RpcOutputStreamController<O>();
		const status = Promise.reject(error);
		const trailers = Promise.reject(error);

		suppressUnhandled(headers, status, trailers);
		queueMicrotask(() => {
			if (!responses.closed) {
				responses.notifyError(error);
			}
		});

		return new ServerStreamingCall(
			method,
			requestHeaders,
			input,
			headers,
			responses,
			status,
			trailers,
		);
	}

	async #runUnaryHandler<I extends object, O extends object>(
		method: MethodInfo<I, O>,
		input: I,
		options: RpcOptions,
		resolver: UnaryResolver<I, O>,
		headers: Deferred<RpcMetadata>,
		response: Deferred<O>,
		status: Deferred<RpcStatus>,
		trailers: Deferred<RpcMetadata>,
	): Promise<void> {
		try {
			const result = await resolver(createContext(method, input, options));
			const reply = normalizeReply(result);

			headers.resolvePending(cloneMetadata(reply.headers));
			await delay(reply.delay, options.abort, method);

			response.resolvePending(reply.body);
			status.resolvePending(createOkStatus());
			trailers.resolvePending(cloneMetadata(reply.trailers));
		} catch (error) {
			if (isPassthrough(error)) {
				if (!this.#fallbackTransport) {
					const passthroughError = createUnhandledError(
						method,
						this.#onUnhandledRequest,
					);
					headers.rejectPending(passthroughError);
					response.rejectPending(passthroughError);
					status.rejectPending(passthroughError);
					trailers.rejectPending(passthroughError);
					return;
				}

				pipeUnaryCall(
					this.#fallbackTransport.unary(method, input, options),
					headers,
					response,
					status,
					trailers,
				);
				return;
			}

			const rpcError = decorateRpcError(error, method);
			headers.rejectPending(rpcError);
			response.rejectPending(rpcError);
			status.rejectPending(rpcError);
			trailers.rejectPending(rpcError);
		}
	}

	async #runServerStreamingHandler<I extends object, O extends object>(
		method: MethodInfo<I, O>,
		input: I,
		options: RpcOptions,
		handler: MockHandler<I, O>,
		headers: Deferred<RpcMetadata>,
		responses: RpcOutputStreamController<O>,
		status: Deferred<RpcStatus>,
		trailers: Deferred<RpcMetadata>,
	): Promise<void> {
		const resolveSuccess = () => {
			if (!responses.closed) {
				responses.notifyComplete();
			}
			status.resolvePending(createOkStatus());
			trailers.resolvePending({});
		};

		const rejectWith = (error: unknown) => {
			const rpcError = decorateRpcError(error, method);
			if (!responses.closed) {
				responses.notifyError(rpcError);
			}
			status.rejectPending(rpcError);
			trailers.rejectPending(rpcError);
		};

		const send = (message: O) => {
			if (options.abort?.aborted) {
				throw createCancelledError(method);
			}

			responses.notifyMessage(message);
		};

		try {
			await Promise.resolve();
			headers.resolvePending({});
			const result = await (
				handler.resolver as (
					context: GrpcMockContext<I, O> & {
						stream: {
							send(message: O): void;
							complete(): void;
							error(error: Error): void;
						};
					},
				) => Promise<unknown> | unknown
			)({
				...createContext(method, input, options),
				stream: {
					send,
					complete: resolveSuccess,
					error: rejectWith,
				},
			});

			if (isPassthrough(result)) {
				throw result;
			}

			if (isIterable<O>(result)) {
				for await (const message of result) {
					if (options.abort?.aborted) {
						throw createCancelledError(method);
					}

					send(message);
				}
			}

			if (!responses.closed) {
				if (options.abort?.aborted) {
					throw createCancelledError(method);
				}

				resolveSuccess();
			}
		} catch (error) {
			if (isPassthrough(error)) {
				if (!this.#fallbackTransport) {
					rejectWith(createUnhandledError(method, this.#onUnhandledRequest));
					return;
				}

				pipeServerStreamingCall(
					this.#fallbackTransport.serverStreaming(method, input, options),
					headers,
					responses,
					status,
					trailers,
				);
				return;
			}

			rejectWith(error);
		}
	}
}

export function createGrpcMockTransport(
	options: CreateGrpcMockTransportOptions,
): RpcTransport {
	return new MockRpcTransport(options);
}
