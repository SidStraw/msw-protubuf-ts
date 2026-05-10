import { grpc } from "@sidtw/protobuf-ts-grpc-mock";

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
				headers: { "x-playground": "protobuf-ts-grpc-mock" },
				trailers: { "x-request-id": requestId },
			},
		);
	},
);
