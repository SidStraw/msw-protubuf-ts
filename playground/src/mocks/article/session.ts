import { createGrpcMockSession } from "@sidtw/protobuf-ts-grpc-mock";

import type { ArticleTag } from "../../gen/article";

interface ArticleMockState {
	articles: Record<string, ArticleTag[]>;
}

const initialState: ArticleMockState = {
	articles: {
		"article-1": [
			{ id: "tag-1", label: "protobuf-ts" },
			{ id: "tag-2", label: "protobuf-ts-grpc-mock" },
		],
	},
};

const session = createGrpcMockSession(initialState);

export function getArticleTags(articleId: string): ArticleTag[] {
	return [...(session.getState().articles[articleId] ?? [])];
}

export function addArticleTag(
	articleId: string,
	tag: ArticleTag,
): ArticleTag[] {
	const state = session.update((current) => {
		const articles: Record<string, ArticleTag[]> = {};

		for (const [id, tags] of Object.entries(current.articles)) {
			articles[id] = [...tags];
		}

		const tags = articles[articleId] ?? [];

		if (!tags.some((existingTag) => existingTag.id === tag.id)) {
			tags.push(tag);
		}

		return {
			articles: {
				...articles,
				[articleId]: tags,
			},
		};
	});

	return [...(state.articles[articleId] ?? [])];
}

export function resetArticleMockSession(): void {
	session.reset();
}
