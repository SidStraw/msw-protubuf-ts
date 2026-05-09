import { createGrpcMockRegistry, grpc } from "grpc-web-mock";

import { GreeterService } from "../gen/greeter";
import type {
	GreetingEvent,
	SayHelloRequest,
	SayHelloResponse,
	WatchGreetingsRequest,
} from "../gen/greeter";

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export function createGreeterMockRegistry() {
	const registry = createGrpcMockRegistry();

	registry.register(
		grpc.unary<SayHelloRequest, SayHelloResponse>(
			GreeterService,
			"sayHello",
			({ meta, request }) => {
				if (request.fail) {
					throw grpc.error("NOT_FOUND", `No greeting for ${request.name}.`, {
						"x-demo-error": "true",
					});
				}

				const requestId = String(meta["x-request-id"] ?? "missing");

				return grpc.reply(
					{
						message: `Hello, ${request.name}!`,
						requestId,
					},
					{
						delay: request.delayMs,
						headers: { "x-playground": "grpc-web-mock" },
						trailers: { "x-request-id": requestId },
					},
				);
			},
		),
		grpc.serverStreaming<WatchGreetingsRequest, GreetingEvent>(
			GreeterService,
			"watchGreetings",
			async function* ({ request }) {
				const count = Math.max(1, Math.min(request.count || 3, 5));

				for (let index = 1; index <= count; index += 1) {
					await wait(250);
					yield {
						message: `Streaming hello ${index} for ${request.name}`,
						sequence: index,
					};
				}
			},
		),
	);

	return registry;
}
