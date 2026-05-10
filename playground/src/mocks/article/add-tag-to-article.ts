import { grpc } from "@sidtw/protobuf-ts-grpc-mock";

import { ArticleService } from "../../gen/article";
import type {
	AddTagToArticleRequest,
	AddTagToArticleResponse,
} from "../../gen/article";
import { addArticleTag } from "./session";

export default grpc.unary<AddTagToArticleRequest, AddTagToArticleResponse>(
	ArticleService,
	"addTagToArticle",
	({ request }) => {
		const articleId = request.articleId || "article-1";
		const label = request.label.trim();

		if (!label) {
			throw grpc.error("INVALID_ARGUMENT", "Tag label is required.");
		}

		return {
			articleId,
			tags: addArticleTag(articleId, {
				id: request.tagId || `tag-${Date.now()}`,
				label,
			}),
		};
	},
);
