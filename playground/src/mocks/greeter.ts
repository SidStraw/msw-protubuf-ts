import { createGrpcMockRegistry, grpc } from "grpc-web-mock";

import { GreeterService } from "../gen/greeter";
import type {
	AddTagToArticleRequest,
	AddTagToArticleResponse,
	ArticleTag,
	GreetingEvent,
	ListTagsRequest,
	ListTagsResponse,
	SayHelloRequest,
	SayHelloResponse,
	WatchGreetingsRequest,
} from "../gen/greeter";
import {
	createGrpcMockSession,
	defineSessionUnaryMock,
	defineUnaryMock,
} from "./define-grpc-mock";

interface GreeterMockState {
	articles: Record<string, ArticleTag[]>;
}

const initialGreeterMockState: GreeterMockState = {
	articles: {
		"article-1": [
			{ id: "tag-1", label: "protobuf-ts" },
			{ id: "tag-2", label: "grpc-web-mock" },
		],
	},
};

const greeterMockSession = createGrpcMockSession(initialGreeterMockState);

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function getArticleTags(
	state: GreeterMockState,
	articleId: string,
): ArticleTag[] {
	return [...(state.articles[articleId] ?? [])];
}

export function resetGreeterMockSession(): GreeterMockState {
	return greeterMockSession.reset();
}

export function createGreeterMockRegistry() {
	const registry = createGrpcMockRegistry();

	registry.register(
		defineUnaryMock<SayHelloRequest, SayHelloResponse>(
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
		defineSessionUnaryMock<ListTagsRequest, ListTagsResponse, GreeterMockState>(
			greeterMockSession,
			GreeterService,
			"listTags",
			({ request, session }) => {
				const articleId = request.articleId || "article-1";

				return {
					articleId,
					tags: getArticleTags(session.getState(), articleId),
				};
			},
		),
		defineSessionUnaryMock<
			AddTagToArticleRequest,
			AddTagToArticleResponse,
			GreeterMockState
		>(
			greeterMockSession,
			GreeterService,
			"addTagToArticle",
			({ request, session }) => {
				const articleId = request.articleId || "article-1";
				const label = request.label.trim();

				if (!label) {
					throw grpc.error("INVALID_ARGUMENT", "Tag label is required.");
				}

				const nextState = session.update((state) => {
					const tags = state.articles[articleId] ?? [];
					const id = request.tagId || `tag-${tags.length + 1}`;

					if (!tags.some((tag) => tag.id === id)) {
						tags.push({ id, label });
					}

					state.articles[articleId] = tags;
				});

				return {
					articleId,
					tags: getArticleTags(nextState, articleId),
				};
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
