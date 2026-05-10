import { grpc } from "grpc-web-mock";

import { GreeterService } from "../../gen/greeter";
import type { SayHelloRequest, SayHelloResponse } from "../../gen/greeter";

export default grpc.unary<SayHelloRequest, SayHelloResponse>(
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
);
