import { RpcError, TestTransport } from "@protobuf-ts/runtime-rpc";
import { describe, expect, test, vi } from "vitest";

import {
	createGrpcMockRegistry,
	createGrpcMockTransport,
	grpc,
} from "../src/index.js";
import { TypedGreeterService, sayHelloMethod } from "./fixtures/service.js";

describe("createGrpcMockTransport fallback and unhandled behavior", () => {
	test("delegates unregistered unary methods to fallback transport", async () => {
		const fallback = new TestTransport({
			response: { message: "from fallback" },
		});

		const transport = createGrpcMockTransport({
			registry: createGrpcMockRegistry(),
			fallbackTransport: fallback,
		});

		const call = transport.unary(sayHelloMethod, { name: "Ada" }, {});

		await expect(call.response).resolves.toEqual({ message: "from fallback" });
		expect(fallback.sentMessages).toEqual([{ name: "Ada" }]);
	});

	test("surfaces fallback transport failures unchanged", async () => {
		const failure = new RpcError("boom", "INTERNAL");
		const fallback = new TestTransport({
			response: failure,
		});

		const transport = createGrpcMockTransport({
			registry: createGrpcMockRegistry(),
			fallbackTransport: fallback,
		});

		const call = transport.unary(sayHelloMethod, { name: "Ada" }, {});

		await expect(call.response).rejects.toBe(failure);
		await expect(call).rejects.toBe(failure);
	});

	test("throws UNIMPLEMENTED by default for unhandled methods without fallback", async () => {
		const transport = createGrpcMockTransport({
			registry: createGrpcMockRegistry(),
		});

		const call = transport.unary(sayHelloMethod, { name: "Ada" }, {});

		await expect(call.response).rejects.toMatchObject({
			code: "UNIMPLEMENTED",
			methodName: "SayHello",
			serviceName: "example.Greeter",
		});
	});

	test("warns before throwing when onUnhandledRequest is set to warn", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const transport = createGrpcMockTransport({
			registry: createGrpcMockRegistry(),
			onUnhandledRequest: "warn",
		});

		const call = transport.unary(sayHelloMethod, { name: "Ada" }, {});

		await expect(call.response).rejects.toMatchObject({
			code: "UNIMPLEMENTED",
		});
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("example.Greeter/SayHello"),
		);

		warn.mockRestore();
	});

	test("delegates to fallback when a resolver calls passthrough", async () => {
		const fallback = new TestTransport({
			response: { message: "delegated" },
		});
		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.unary(TypedGreeterService, "sayHello", ({ passthrough }) => {
				return passthrough();
			}),
		);

		const transport = createGrpcMockTransport({
			registry,
			fallbackTransport: fallback,
		});

		const call = transport.unary(sayHelloMethod, { name: "Ada" }, {});

		await expect(call.response).resolves.toEqual({ message: "delegated" });
		expect(fallback.sentMessages).toEqual([{ name: "Ada" }]);
	});
});
