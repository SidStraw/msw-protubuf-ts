import { RpcError } from "@protobuf-ts/runtime-rpc";
import { describe, expect, expectTypeOf, test } from "vitest";

import { createGrpcMockRegistry, grpc } from "../src/index.js";
import {
	LooseGreeterService,
	type SayHelloRequest,
	type SayHelloResponse,
	TypedGreeterService,
} from "./fixtures/service.js";

describe("createGrpcMockRegistry", () => {
	test("registers and resolves unary handlers by method key", () => {
		const registry = createGrpcMockRegistry();
		const handler = grpc.unary(
			TypedGreeterService,
			"sayHello",
			({ request }) => {
				expectTypeOf(request).toEqualTypeOf<SayHelloRequest>();
				return { message: `Hello, ${request.name}` };
			},
		);

		registry.register(handler);

		expect(registry.size).toBe(1);
		expect(registry.get(TypedGreeterService.methods[0])).toBe(handler);
	});

	test("overwrites duplicate registrations for the same method", () => {
		const registry = createGrpcMockRegistry();
		const first = grpc.unary(TypedGreeterService, "sayHello", () => ({
			message: "first",
		}));
		const second = grpc.unary(TypedGreeterService, "sayHello", () => ({
			message: "second",
		}));

		registry.register(first, second);

		expect(registry.size).toBe(1);
		expect(registry.get(TypedGreeterService.methods[0])).toBe(second);
	});

	test("throws for unknown method names", () => {
		expect(() =>
			grpc.unary(TypedGreeterService, "missingMethod", () => ({
				message: "nope",
			})),
		).toThrow(/example\.Greeter.*missingMethod/);
	});

	test("throws when method cardinality does not match the helper", () => {
		expect(() =>
			grpc.serverStreaming(TypedGreeterService, "sayHello", () => []),
		).toThrow(/server streaming/i);

		expect(() =>
			grpc.unary(TypedGreeterService, "watchGreetings", () => ({
				message: "nope",
			})),
		).toThrow(/unary/i);
	});

	test("supports explicit generic fallback when service typing is loose", () => {
		const handler = grpc.unary<SayHelloRequest, SayHelloResponse>(
			LooseGreeterService,
			"sayHello",
			({ request }) => {
				expectTypeOf(request).toEqualTypeOf<SayHelloRequest>();
				return { message: request.name };
			},
		);

		expect(handler.method.localName).toBe("sayHello");
	});

	test("creates RpcError and reply helpers", () => {
		const error = grpc.error("NOT_FOUND", "missing", { "x-test": "1" });
		const reply = grpc.reply(
			{ message: "hi" },
			{
				delay: 25,
				headers: { "x-header": "value" },
				trailers: { "x-trailer": "value" },
			},
		);

		expect(error).toBeInstanceOf(RpcError);
		expect(error.code).toBe("NOT_FOUND");
		expect(error.message).toBe("missing");
		expect(error.meta).toEqual({ "x-test": "1" });

		expect(reply.body).toEqual({ message: "hi" });
		expect(reply.delay).toBe(25);
		expect(reply.headers).toEqual({ "x-header": "value" });
		expect(reply.trailers).toEqual({ "x-trailer": "value" });
	});
});
