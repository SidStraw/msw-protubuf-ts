import { createGrpcMockRegistry, createGrpcMockTransport } from "grpc-web-mock";

import { ArticleServiceClient } from "./gen/article.client";
import { GreeterServiceClient } from "./gen/greeter.client";
import { articleHandlers, greeterHandlers } from "./mocks";

export function createPlaygroundClients() {
	const registry = createGrpcMockRegistry();
	registry.register(...greeterHandlers, ...articleHandlers);
	const transport = createGrpcMockTransport({ registry });

	return {
		article: new ArticleServiceClient(transport),
		greeter: new GreeterServiceClient(transport),
	};
}
