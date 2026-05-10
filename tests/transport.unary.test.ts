import { RpcError } from "@protobuf-ts/runtime-rpc";
import { describe, expect, test, vi } from "vitest";

import {
	MockRpcTransport,
	createGrpcMockRegistry,
	createGrpcMockTransport,
	grpc,
} from "../src/index.js";
import {
	type SayHelloRequest,
	type SayHelloResponse,
	TypedGreeterService,
	chatGreetingsMethod,
	sayHelloMethod,
	uploadGreetingMethod,
} from "./fixtures/service.js";

describe("MockRpcTransport unary calls", () => {
	test("resolves static unary response handlers", async () => {
		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.unary<SayHelloRequest, SayHelloResponse>(
				TypedGreeterService,
				"sayHello",
				{ message: "static hello" },
			),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = transport.unary(sayHelloMethod, { name: "Ada" }, {});

		await expect(call.response).resolves.toEqual({ message: "static hello" });
		await expect(call.status).resolves.toMatchObject({ code: "OK" });
	});

	test("resolves unary calls with headers, trailers, status, and forwarded metadata", async () => {
		const seenMeta: Array<Record<string, string | string[]>> = [];
		const originalMeta = { authorization: "Bearer test-token" };
		const registry = createGrpcMockRegistry();

		registry.register(
			grpc.unary(TypedGreeterService, "sayHello", ({ meta, request }) => {
				seenMeta.push({ ...meta });

				return grpc.reply(
					{ message: `Hello, ${request.name}` },
					{
						headers: { "x-header": "present" },
						trailers: { "x-trailer": "present" },
					},
				);
			}),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = transport.unary(
			sayHelloMethod,
			{ name: "Ada" },
			{ meta: originalMeta },
		);

		await expect(call.headers).resolves.toEqual({ "x-header": "present" });
		await expect(call.response).resolves.toEqual({ message: "Hello, Ada" });
		await expect(call.status).resolves.toMatchObject({ code: "OK" });
		await expect(call.trailers).resolves.toEqual({ "x-trailer": "present" });
		await expect(call).resolves.toMatchObject({
			response: { message: "Hello, Ada" },
			headers: { "x-header": "present" },
			trailers: { "x-trailer": "present" },
		});

		expect(call.requestHeaders).toEqual(originalMeta);
		expect(seenMeta).toEqual([originalMeta]);
		expect(originalMeta).toEqual({ authorization: "Bearer test-token" });
	});

	test("rejects unary call promises with the same RpcError instance", async () => {
		const failure = grpc.error("NOT_FOUND", "missing", { "x-error": "1" });
		const registry = createGrpcMockRegistry();

		registry.register(
			grpc.unary(TypedGreeterService, "sayHello", () => {
				throw failure;
			}),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = transport.unary(sayHelloMethod, { name: "Ada" }, {});

		await expect(call.headers).rejects.toBe(failure);
		await expect(call.response).rejects.toBe(failure);
		await expect(call.status).rejects.toBe(failure);
		await expect(call.trailers).rejects.toBe(failure);
		await expect(call).rejects.toBe(failure);
	});

	test("applies reply delay before resolving the unary response", async () => {
		vi.useFakeTimers();

		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.unary(TypedGreeterService, "sayHello", () =>
				grpc.reply({ message: "delayed" }, { delay: 50 }),
			),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = transport.unary(sayHelloMethod, { name: "Ada" }, {});

		let settled = false;
		void call.response.then(() => {
			settled = true;
		});

		await vi.advanceTimersByTimeAsync(49);
		expect(settled).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		await expect(call.response).resolves.toEqual({ message: "delayed" });

		vi.useRealTimers();
	});

	test("wires abort into resolver context and rejects delayed unary calls as CANCELLED", async () => {
		vi.useFakeTimers();

		const abortController = new AbortController();
		let seenSignal: AbortSignal | undefined;
		const registry = createGrpcMockRegistry();

		registry.register(
			grpc.unary(TypedGreeterService, "sayHello", ({ signal }) => {
				seenSignal = signal;
				return grpc.reply({ message: "later" }, { delay: 100 });
			}),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = transport.unary(
			sayHelloMethod,
			{ name: "Ada" },
			{ abort: abortController.signal },
		);

		abortController.abort();
		await vi.runAllTimersAsync();

		expect(seenSignal?.aborted).toBe(true);
		await expect(call.response).rejects.toMatchObject({ code: "CANCELLED" });
		await expect(call.status).rejects.toMatchObject({ code: "CANCELLED" });

		vi.useRealTimers();
	});

	test("throws UNIMPLEMENTED for client streaming and duplex methods", () => {
		const transport = new MockRpcTransport({
			registry: createGrpcMockRegistry(),
		});

		expect(() =>
			transport.clientStreaming(uploadGreetingMethod, {}),
		).toThrowError(RpcError);
		expect(() => transport.duplex(chatGreetingsMethod, {})).toThrowError(
			RpcError,
		);
		expect(() => transport.clientStreaming(uploadGreetingMethod, {})).toThrow(
			/gRPC-Web/i,
		);
		expect(() => transport.duplex(chatGreetingsMethod, {})).toThrow(
			/gRPC-Web/i,
		);
	});
});
