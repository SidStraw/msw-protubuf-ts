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

let state = structuredClone(initialState);

export function getArticleTags(articleId: string): ArticleTag[] {
	return [...(state.articles[articleId] ?? [])];
}

export function addArticleTag(
	articleId: string,
	tag: ArticleTag,
): ArticleTag[] {
	const tags = state.articles[articleId] ?? [];

	if (!tags.some((existingTag) => existingTag.id === tag.id)) {
		tags.push(tag);
	}

	state.articles[articleId] = tags;
	return getArticleTags(articleId);
}

export function resetArticleMockSession(): ArticleMockState {
	state = structuredClone(initialState);
	return structuredClone(state);
}
