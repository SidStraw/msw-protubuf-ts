import { grpc } from "@sidtw/protobuf-ts-grpc-mock";

import { ArticleService } from "../../gen/article";
import type { ListTagsRequest, ListTagsResponse } from "../../gen/article";
import { getArticleTags } from "./session";

export default grpc.unary<ListTagsRequest, ListTagsResponse>(
	ArticleService,
	"listTags",
	({ request }) => {
		const articleId = request.articleId || "article-1";

		return {
			articleId,
			tags: getArticleTags(articleId),
		};
	},
);
