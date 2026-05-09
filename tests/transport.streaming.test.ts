import { describe, expect, test, vi } from "vitest";

import {
	createGrpcMockRegistry,
	createGrpcMockTransport,
	grpc,
} from "../src/index.js";
import {
	type SayHelloResponse,
	TypedGreeterService,
	watchGreetingsMethod,
} from "./fixtures/service.js";

async function collectResponses(
	onCollect: (
		messages: SayHelloResponse[],
		onComplete: () => void,
		onError: (error: unknown) => void,
	) => Promise<void> | void,
) {
	const messages: SayHelloResponse[] = [];
	let completeCount = 0;
	let lastError: unknown;

	await onCollect(
		messages,
		() => {
			completeCount += 1;
		},
		(error) => {
			lastError = error;
		},
	);

	return {
		messages,
		completeCount,
		lastError,
	};
}

describe("MockRpcTransport server streaming calls", () => {
	test("streams array responses in order and completes once", async () => {
		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.serverStreaming(
				TypedGreeterService,
				"watchGreetings",
				({ request }) => [
					{ message: `${request.name}-1` },
					{ message: `${request.name}-2` },
				],
			),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = transport.serverStreaming(
			watchGreetingsMethod,
			{ name: "Ada" },
			{},
		);

		const result = await collectResponses(
			async (messages, onComplete, onError) => {
				call.responses.onMessage((message) => {
					messages.push(message);
				});
				call.responses.onComplete(onComplete);
				call.responses.onError(onError);

				await expect(call).resolves.toMatchObject({ status: { code: "OK" } });
			},
		);

		expect(result.messages).toEqual([
			{ message: "Ada-1" },
			{ message: "Ada-2" },
		]);
		expect(result.completeCount).toBe(1);
		expect(result.lastError).toBeUndefined();
	});

	test("supports async iterable resolvers", async () => {
		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.serverStreaming(
				TypedGreeterService,
				"watchGreetings",
				async function* ({ request }) {
					yield { message: `${request.name}-1` };
					yield { message: `${request.name}-2` };
				},
			),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = transport.serverStreaming(
			watchGreetingsMethod,
			{ name: "Ada" },
			{},
		);

		const messages: SayHelloResponse[] = [];
		for await (const message of call.responses) {
			messages.push(message);
		}

		await expect(call).resolves.toMatchObject({ status: { code: "OK" } });
		expect(messages).toEqual([{ message: "Ada-1" }, { message: "Ada-2" }]);
	});

	test("supports imperative stream emission", async () => {
		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.serverStreaming(
				TypedGreeterService,
				"watchGreetings",
				({ request, stream }) => {
					stream.send({ message: `${request.name}-1` });
					stream.send({ message: `${request.name}-2` });
					stream.complete();
				},
			),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = transport.serverStreaming(
			watchGreetingsMethod,
			{ name: "Ada" },
			{},
		);

		const messages: SayHelloResponse[] = [];
		call.responses.onMessage((message) => {
			messages.push(message);
		});

		await expect(call).resolves.toMatchObject({ status: { code: "OK" } });
		expect(messages).toEqual([{ message: "Ada-1" }, { message: "Ada-2" }]);
	});

	test("propagates mid-stream errors without completing", async () => {
		const registry = createGrpcMockRegistry();
		registry.register(
			grpc.serverStreaming(
				TypedGreeterService,
				"watchGreetings",
				({ request, stream }) => {
					stream.send({ message: `${request.name}-1` });
					stream.error(grpc.error("INTERNAL", "boom"));
				},
			),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = transport.serverStreaming(
			watchGreetingsMethod,
			{ name: "Ada" },
			{},
		);

		const messages: SayHelloResponse[] = [];
		let completeCount = 0;
		let streamError: unknown;

		call.responses.onMessage((message) => {
			messages.push(message);
		});
		call.responses.onComplete(() => {
			completeCount += 1;
		});
		call.responses.onError((error) => {
			streamError = error;
		});

		await expect(call).rejects.toMatchObject({
			code: "INTERNAL",
			message: "boom",
		});
		expect(messages).toEqual([{ message: "Ada-1" }]);
		expect(completeCount).toBe(0);
		expect(streamError).toMatchObject({ code: "INTERNAL", message: "boom" });
	});

	test("aborts an active stream with CANCELLED and stops further messages", async () => {
		vi.useFakeTimers();

		const abortController = new AbortController();
		let seenSignal: AbortSignal | undefined;
		const registry = createGrpcMockRegistry();

		registry.register(
			grpc.serverStreaming(
				TypedGreeterService,
				"watchGreetings",
				async function* ({ request, signal }) {
					seenSignal = signal;
					yield { message: `${request.name}-1` };
					await new Promise((resolve) => setTimeout(resolve, 100));
					yield { message: `${request.name}-2` };
				},
			),
		);

		const transport = createGrpcMockTransport({ registry });
		const call = transport.serverStreaming(
			watchGreetingsMethod,
			{ name: "Ada" },
			{ abort: abortController.signal },
		);

		const messages: SayHelloResponse[] = [];
		let completeCount = 0;
		let streamError: unknown;

		call.responses.onMessage((message) => {
			messages.push(message);
		});
		call.responses.onComplete(() => {
			completeCount += 1;
		});
		call.responses.onError((error) => {
			streamError = error;
		});

		await vi.advanceTimersByTimeAsync(0);
		abortController.abort();
		await vi.runAllTimersAsync();

		await expect(call).rejects.toMatchObject({ code: "CANCELLED" });
		expect(messages).toEqual([{ message: "Ada-1" }]);
		expect(completeCount).toBe(0);
		expect(streamError).toMatchObject({ code: "CANCELLED" });
		expect(seenSignal?.aborted).toBe(true);

		vi.useRealTimers();
	});
});
