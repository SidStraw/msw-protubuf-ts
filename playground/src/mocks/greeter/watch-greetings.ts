import { grpc } from "@sidtw/protobuf-ts-grpc-mock";

import { GreeterService } from "../../gen/greeter";
import type { GreetingEvent, WatchGreetingsRequest } from "../../gen/greeter";

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export default grpc.serverStreaming<WatchGreetingsRequest, GreetingEvent>(
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
);
