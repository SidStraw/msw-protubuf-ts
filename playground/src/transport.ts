import { createGrpcMockTransport } from "grpc-web-mock";

import { GreeterServiceClient } from "./gen/greeter.client";
import { createGreeterMockRegistry } from "./mocks/greeter";

export function createPlaygroundGreeterClient() {
	const registry = createGreeterMockRegistry();
	const transport = createGrpcMockTransport({ registry });

	return new GreeterServiceClient(transport);
}
