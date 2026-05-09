import {
	type RpcInterceptor,
	type RpcOptions,
	type ServerStreamingCall,
	type UnaryCall,
	stackIntercept,
} from "@protobuf-ts/runtime-rpc";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
	createGrpcMockRegistry,
	createGrpcMockTransport,
	grpc,
} from "../src/index.js";
import {
	type SayHelloResponse,
	TypedGreeterService,
	sayHelloMethod,
	watchGreetingsMethod,
} from "./fixtures/service.js";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function createSpyInterceptor() {
	const unaryCalls: Array<{
		methodName: string;
		serviceName: string;
		input: unknown;
		options: RpcOptions;
		call: UnaryCall;
	}> = [];
	const streamCalls: Array<{
		methodName: string;
		serviceName: string;
		input: unknown;
		options: RpcOptions;
		call: ServerStreamingCall;
	}> = [];
	const streamEvents: string[] = [];

	const interceptor: RpcInterceptor = {
		interceptUnary(next, method, input, options) {
			const call = next(method, input, options);
			unaryCalls.push({
				methodName: method.name,
				serviceName: method.service.typeName,
				input,
				options,
				call,
			});
			return call;
		},
		interceptServerStreaming(next, method, input, options) {
			const call = next(method, input, options);
			streamCalls.push({
				methodName: method.name,
				serviceName: method.service.typeName,
				input,
				options,
				call,
			});
			call.responses.onMessage((message) => {
				streamEvents.push(`message:${(message as SayHelloResponse).message}`);
			});
			call.responses.onComplete(() => {
				streamEvents.push("complete");
			});
			call.responses.onError((error) => {
				streamEvents.push(
					`error:${(error as Error & { code?: string }).code ?? "unknown"}`,
				);
			});
			return call;
		},
	};

	return {
		interceptor,
		unaryCalls,
		streamCalls,
		streamEvents,
	};
}

function createDevtoolsLikeInterceptor(
	posts: Array<Record<string, unknown>>,
): RpcInterceptor {
	return {
		interceptUnary(next, method, input, options) {
			const call = next(method, input, options);

			posts.push({
				methodName: call.method.name,
				serviceName: call.method.service.typeName,
				requestMessage: call.request,
				requestMetadata: Object.fromEntries(
					Object.entries(call.requestHeaders),
				),
			});

			void call.then(
				(finished) => {
					posts.push({
						responseMetadata: Object.fromEntries(
							Object.entries(finished.headers),
						),
						responseMessage: finished.response,
					});
					posts.push({
						responseMessage: "EOF",
					});

					return finished;
				},
				(error) => {
					posts.push({
						responseMessage: {
							name: error.name,
							code: error.code,
							message: error.message,
						},
						errorMetadata: Object.fromEntries(Object.entries(error.meta)),
					});
				},
			);

			return call;
		},
	};
}

async function loadDocsDevtoolsInterceptor() {
	vi.resetModules();
	const messages: Array<Record<string, unknown>> = [];
	const windowMock = {
		addEventListener: vi.fn(),
		postMessage: vi.fn((message: Record<string, unknown>) => {
			messages.push(message);
		}),
	};

	vi.stubGlobal("window", windowMock);

	const module = await import("../docs/devtool.js");
	return {
		interceptor: module.devtoolsInterceptor,
		messages,
		windowMock,
	};
}

describe("RpcInterceptor parity", () => {
	test("spy interceptor sees unary call creation arguments and call object", async () => {
		const spy = createSpyInterceptor();
		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.unary(TypedGreeterService, "sayHello", ({ request }) => ({
				message: `Hello, ${request.name}`,
			})),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = stackIntercept(
			"unary",
			transport,
			sayHelloMethod,
			{
				interceptors: [spy.interceptor],
				meta: { authorization: "Bearer token" },
			},
			{ name: "Ada" },
		);

		await expect(call).resolves.toMatchObject({
			response: { message: "Hello, Ada" },
		});

		expect(spy.unaryCalls).toHaveLength(1);
		expect(spy.unaryCalls[0]).toMatchObject({
			methodName: "SayHello",
			serviceName: "example.Greeter",
			input: { name: "Ada" },
			options: { meta: { authorization: "Bearer token" } },
		});
		expect(spy.unaryCalls[0]?.call.method).toBe(sayHelloMethod);
		expect(spy.unaryCalls[0]?.call.request).toEqual({ name: "Ada" });
	});

	test("docs devtools interceptor posts unary request, response, and EOF in order", async () => {
		const { interceptor, messages } = await loadDocsDevtoolsInterceptor();
		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.unary(TypedGreeterService, "sayHello", ({ request }) =>
				grpc.reply(
					{ message: `Hello, ${request.name}` },
					{ headers: { "x-response": "ok" } },
				),
			),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = stackIntercept(
			"unary",
			transport,
			sayHelloMethod,
			{ interceptors: [interceptor], meta: { authorization: "Bearer token" } },
			{ name: "Ada" },
		);

		await call;
		await Promise.resolve();

		expect(messages).toHaveLength(3);
		expect(messages[0]?.payload).toMatchObject({
			methodName: "SayHello",
			serviceName: "example.Greeter",
			requestMessage: { name: "Ada" },
			requestMetadata: { authorization: "Bearer token" },
		});
		expect(messages[1]?.payload).toMatchObject({
			responseMessage: { message: "Hello, Ada" },
			responseMetadata: { "x-response": "ok" },
		});
		expect(messages[2]?.payload).toMatchObject({
			responseMessage: { EOF: expect.any(Number) },
		});
	});

	test("devtools-style interceptor receives unary error payloads with code and metadata", async () => {
		const posts: Array<Record<string, unknown>> = [];
		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.unary(TypedGreeterService, "sayHello", () => {
				throw grpc.error("NOT_FOUND", "missing", { "x-error": "1" });
			}),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = stackIntercept(
			"unary",
			transport,
			sayHelloMethod,
			{ interceptors: [createDevtoolsLikeInterceptor(posts)] },
			{ name: "Ada" },
		);

		await expect(call).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "missing",
		});
		await Promise.resolve();

		expect(posts[1]).toMatchObject({
			responseMessage: {
				name: "RpcError",
				code: "NOT_FOUND",
				message: "missing",
			},
			errorMetadata: { "x-error": "1" },
		});
	});

	test("spy interceptor observes server streaming messages followed by completion", async () => {
		const spy = createSpyInterceptor();
		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.serverStreaming(TypedGreeterService, "watchGreetings", () => [
				{ message: "Ada-1" },
				{ message: "Ada-2" },
			]),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = stackIntercept(
			"serverStreaming",
			transport,
			watchGreetingsMethod,
			{ interceptors: [spy.interceptor] },
			{ name: "Ada" },
		);

		await expect(call).resolves.toMatchObject({ status: { code: "OK" } });

		expect(spy.streamCalls).toHaveLength(1);
		expect(spy.streamEvents).toEqual([
			"message:Ada-1",
			"message:Ada-2",
			"complete",
		]);
	});

	test("spy interceptor observes streaming abort as CANCELLED without completion", async () => {
		vi.useFakeTimers();

		const abortController = new AbortController();
		const spy = createSpyInterceptor();
		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.serverStreaming(
				TypedGreeterService,
				"watchGreetings",
				async function* ({ request }) {
					yield { message: `${request.name}-1` };
					await new Promise((resolve) => setTimeout(resolve, 100));
					yield { message: `${request.name}-2` };
				},
			),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = stackIntercept(
			"serverStreaming",
			transport,
			watchGreetingsMethod,
			{ interceptors: [spy.interceptor], abort: abortController.signal },
			{ name: "Ada" },
		);

		await vi.advanceTimersByTimeAsync(0);
		abortController.abort();
		await vi.runAllTimersAsync();

		await expect(call).rejects.toMatchObject({ code: "CANCELLED" });
		expect(spy.streamEvents).toEqual(["message:Ada-1", "error:CANCELLED"]);

		vi.useRealTimers();
	});
});
