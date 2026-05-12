import { describe, expect, expectTypeOf, test } from "vitest";

import {
	type DeepReadonly,
	createGrpcMockRegistry,
	createGrpcMockSession,
	createGrpcMockTransport,
	grpc,
} from "../src/index.js";
import { TypedGreeterService, sayHelloMethod } from "./fixtures/service.js";

interface CounterState {
	count: number;
	names: string[];
}

describe("gRPC mock session state", () => {
	test("shares typed session state across unary calls in the same registry", async () => {
		const registry = createGrpcMockRegistry<CounterState>({
			initialState: { count: 0, names: [] },
		});

		registry.unary(TypedGreeterService, "sayHello", ({ request, session }) => {
			expectTypeOf(session.getState()).toEqualTypeOf<
				DeepReadonly<CounterState>
			>();

			const state = session.update((current) => ({
				count: current.count + 1,
				names: [...current.names, request.name],
			}));

			return { message: `${state.count}:${state.names.join(",")}` };
		});

		const transport = createGrpcMockTransport({ registry });

		await expect(
			transport.unary(sayHelloMethod, { name: "Ada" }, {}).response,
		).resolves.toEqual({ message: "1:Ada" });
		await expect(
			transport.unary(sayHelloMethod, { name: "Grace" }, {}).response,
		).resolves.toEqual({ message: "2:Ada,Grace" });
		expect(registry.session.getState()).toEqual({
			count: 2,
			names: ["Ada", "Grace"],
		});
	});

	test("allows typed registries to register handlers that do not use session", () => {
		const registry = createGrpcMockRegistry({ initialState: { count: 0 } });

		registry.register(
			grpc.unary(TypedGreeterService, "sayHello", ({ request }) => ({
				message: request.name,
			})),
		);

		expect(registry.size).toBe(1);
	});

	test("resets state back to the original initial snapshot", () => {
		const initialState = { nested: { tags: ["protobuf-ts"] } };
		const session = createGrpcMockSession(initialState);

		initialState.nested.tags.push("external-mutation");
		expect(session.getState().nested.tags).toEqual(["protobuf-ts"]);

		session.update((state) => ({
			nested: { tags: [...state.nested.tags, "mock-session"] },
		}));
		expect(session.getState().nested.tags).toEqual([
			"protobuf-ts",
			"mock-session",
		]);

		session.reset();
		expect(session.getState().nested.tags).toEqual(["protobuf-ts"]);
	});

	test("throws a helpful error when state cannot be cloned", () => {
		expect(() =>
			createGrpcMockSession({
				callback: () => "not cloneable",
			}),
		).toThrow(/structuredClone\(\)-compatible data/);
	});

	test("shares the registry session across multiple transports by default", async () => {
		const registry = createGrpcMockRegistry({ initialState: { count: 0 } });
		registry.unary(TypedGreeterService, "sayHello", ({ session }) => {
			const state = session.update((current) => ({ count: current.count + 1 }));
			return { message: String(state.count) };
		});

		const firstTransport = createGrpcMockTransport({ registry });
		const secondTransport = createGrpcMockTransport({ registry });

		await expect(
			firstTransport.unary(sayHelloMethod, { name: "Ada" }, {}).response,
		).resolves.toEqual({ message: "1" });
		await expect(
			secondTransport.unary(sayHelloMethod, { name: "Grace" }, {}).response,
		).resolves.toEqual({ message: "2" });
	});

	test("allows each transport to override the registry session", async () => {
		const registry = createGrpcMockRegistry({ initialState: { count: 0 } });
		registry.unary(TypedGreeterService, "sayHello", ({ session }) => {
			const state = session.update((current) => ({ count: current.count + 1 }));
			return { message: String(state.count) };
		});

		const firstTransport = createGrpcMockTransport({
			registry,
			session: createGrpcMockSession({ count: 10 }),
		});
		const secondTransport = createGrpcMockTransport({
			registry,
			session: createGrpcMockSession({ count: 100 }),
		});

		await expect(
			firstTransport.unary(sayHelloMethod, { name: "Ada" }, {}).response,
		).resolves.toEqual({ message: "11" });
		await expect(
			secondTransport.unary(sayHelloMethod, { name: "Grace" }, {}).response,
		).resolves.toEqual({ message: "101" });
		expect(registry.session.getState()).toEqual({ count: 0 });
	});

	test("keeps update operations consistent across concurrent unary calls", async () => {
		const registry = createGrpcMockRegistry({ initialState: { count: 0 } });
		registry.unary(TypedGreeterService, "sayHello", async ({ session }) => {
			await Promise.resolve();
			const state = session.update((current) => ({ count: current.count + 1 }));

			return { message: String(state.count) };
		});

		const transport = createGrpcMockTransport({ registry });

		await Promise.all(
			Array.from(
				{ length: 5 },
				(_, index) =>
					transport.unary(sayHelloMethod, { name: `user-${index}` }, {})
						.response,
			),
		);

		expect(registry.session.getState().count).toBe(5);
	});
});
