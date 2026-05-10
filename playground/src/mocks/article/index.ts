import addTagToArticle from "./add-tag-to-article";
import listTags from "./list-tags";

export { resetArticleMockSession } from "./session";

export const articleHandlers = [listTags, addTagToArticle] as const;
