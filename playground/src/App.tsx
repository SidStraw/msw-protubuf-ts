import { RpcError } from "@protobuf-ts/runtime-rpc";
import { useMemo, useState } from "react";

import type { ArticleTag } from "./gen/article";
import type { GreetingEvent, SayHelloResponse } from "./gen/greeter";
import { resetArticleMockSession } from "./mocks";
import { createPlaygroundClients } from "./transport";

type UnaryState =
	| { kind: "idle" }
	| { kind: "loading"; startedAt: number }
	| {
			kind: "success";
			response: SayHelloResponse;
			headers: Record<string, string | string[]>;
			trailers: Record<string, string | string[]>;
			elapsedMs: number;
	  }
	| { kind: "error"; code: string; message: string };

type StreamState =
	| { kind: "idle"; events: GreetingEvent[] }
	| { kind: "streaming"; events: GreetingEvent[] }
	| { kind: "complete"; events: GreetingEvent[] }
	| { kind: "error"; events: GreetingEvent[]; message: string };

type TagsState =
	| { kind: "idle"; tags: ArticleTag[] }
	| { kind: "loading"; tags: ArticleTag[] }
	| { kind: "success"; articleId: string; tags: ArticleTag[]; note: string }
	| { kind: "error"; tags: ArticleTag[]; code: string; message: string };

function describeError(error: unknown): { code: string; message: string } {
	if (error instanceof RpcError) {
		return { code: error.code, message: error.message };
	}

	if (error instanceof Error) {
		return { code: "UNKNOWN", message: error.message };
	}

	return { code: "UNKNOWN", message: String(error) };
}

export function App() {
	const clients = useMemo(() => createPlaygroundClients(), []);
	const [name, setName] = useState("Ada");
	const [delayMs, setDelayMs] = useState(400);
	const [tagLabel, setTagLabel] = useState("frontend");
	const [unaryState, setUnaryState] = useState<UnaryState>({ kind: "idle" });
	const [streamState, setStreamState] = useState<StreamState>({
		kind: "idle",
		events: [],
	});
	const [tagsState, setTagsState] = useState<TagsState>({
		kind: "idle",
		tags: [],
	});

	async function runUnary(fail = false) {
		const startedAt = performance.now();
		setUnaryState({ kind: "loading", startedAt });

		try {
			const call = clients.greeter.sayHello(
				{ name, fail, delayMs },
				{ meta: { "x-request-id": `demo-${Date.now()}` } },
			);
			const finished = await call;

			setUnaryState({
				kind: "success",
				response: finished.response,
				headers: finished.headers,
				trailers: finished.trailers,
				elapsedMs: Math.round(performance.now() - startedAt),
			});
		} catch (error) {
			setUnaryState({ kind: "error", ...describeError(error) });
		}
	}

	async function runStream() {
		const events: GreetingEvent[] = [];
		setStreamState({ kind: "streaming", events });

		try {
			const call = clients.greeter.watchGreetings({ name, count: 3 });

			for await (const event of call.responses) {
				events.push(event);
				setStreamState({ kind: "streaming", events: [...events] });
			}

			await call;
			setStreamState({ kind: "complete", events });
		} catch (error) {
			setStreamState({
				kind: "error",
				events,
				message: describeError(error).message,
			});
		}
	}

	async function queryTags(note = "Query result") {
		setTagsState((state) => ({ kind: "loading", tags: state.tags }));

		try {
			const finished = await clients.article.listTags({
				articleId: "article-1",
			});
			setTagsState({
				kind: "success",
				articleId: finished.response.articleId,
				tags: finished.response.tags,
				note,
			});
		} catch (error) {
			setTagsState((state) => ({
				kind: "error",
				tags: state.tags,
				...describeError(error),
			}));
		}
	}

	async function addTag() {
		setTagsState((state) => ({ kind: "loading", tags: state.tags }));

		try {
			const finished = await clients.article.addTagToArticle({
				articleId: "article-1",
				tagId: `tag-${Date.now()}`,
				label: tagLabel,
			});
			setTagsState({
				kind: "success",
				articleId: finished.response.articleId,
				tags: finished.response.tags,
				note: "Mutation result; click Query tags again to read the same session state.",
			});
		} catch (error) {
			setTagsState((state) => ({
				kind: "error",
				tags: state.tags,
				...describeError(error),
			}));
		}
	}

	async function resetTags() {
		resetArticleMockSession();
		await queryTags("Reset to initial session state");
	}

	return (
		<main className="app-shell">
			<section className="hero">
				<p className="eyebrow">protobuf-ts + Vite + React</p>
				<h1>protobuf-ts-grpc-mock playground</h1>
				<p>
					這個範例從 <code>greeter.proto</code> 產生 client，並用 workspace 中的{" "}
					<code>protobuf-ts-grpc-mock</code> package 注入 mock transport。
				</p>
			</section>

			<section className="panel controls">
				<label>
					Name
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<label>
					Unary delay
					<input
						type="number"
						min="0"
						max="2000"
						step="100"
						value={delayMs}
						onChange={(event) => setDelayMs(Number(event.target.value))}
					/>
				</label>
				<label>
					New tag label
					<input
						value={tagLabel}
						onChange={(event) => setTagLabel(event.target.value)}
					/>
				</label>
			</section>

			<div className="grid">
				<section className="panel">
					<h2>Unary RPC</h2>
					<p>
						呼叫 generated <code>GreeterServiceClient.sayHello()</code>，
						handler 會讀取 metadata、套用 delay，並回傳 headers/trailers。
					</p>
					<div className="actions">
						<button type="button" onClick={() => void runUnary(false)}>
							Run unary
						</button>
						<button
							type="button"
							className="secondary"
							onClick={() => void runUnary(true)}
						>
							Trigger RpcError
						</button>
					</div>
					<pre>{JSON.stringify(unaryState, null, 2)}</pre>
				</section>

				<section className="panel">
					<h2>Server streaming RPC</h2>
					<p>
						呼叫 generated <code>watchGreetings()</code>，mock resolver 以 async
						iterable 逐筆送出事件。
					</p>
					<div className="actions">
						<button type="button" onClick={() => void runStream()}>
							Start stream
						</button>
					</div>
					<ul className="stream-list">
						{streamState.events.map((event) => (
							<li key={event.sequence}>
								<span>#{event.sequence}</span>
								{event.message}
							</li>
						))}
					</ul>
					<pre>{JSON.stringify(streamState, null, 2)}</pre>
				</section>

				<section className="panel">
					<h2>Session stateful unary mocks</h2>
					<p>
						這段示範類似 MSW GraphQL 的體驗：
						<code>addTagToArticle()</code> 更新目前 session，下一次{" "}
						<code>listTags()</code> 會讀到更新後的 tags。
					</p>
					<div className="actions">
						<button type="button" onClick={() => void queryTags()}>
							Query tags
						</button>
						<button type="button" onClick={() => void addTag()}>
							Add tag mutation
						</button>
						<button
							type="button"
							className="secondary"
							onClick={() => void resetTags()}
						>
							Reset session
						</button>
					</div>
					<ul className="stream-list">
						{tagsState.tags.map((tag) => (
							<li key={tag.id}>
								<span>{tag.id}</span>
								{tag.label}
							</li>
						))}
					</ul>
					<pre>{JSON.stringify(tagsState, null, 2)}</pre>
				</section>
			</div>
		</main>
	);
}
