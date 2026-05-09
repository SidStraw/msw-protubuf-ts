import { RpcError } from "@protobuf-ts/runtime-rpc";
import { useMemo, useState } from "react";

import type { GreetingEvent, SayHelloResponse } from "./gen/greeter";
import { createPlaygroundGreeterClient } from "./transport";

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
	const client = useMemo(() => createPlaygroundGreeterClient(), []);
	const [name, setName] = useState("Ada");
	const [delayMs, setDelayMs] = useState(400);
	const [unaryState, setUnaryState] = useState<UnaryState>({ kind: "idle" });
	const [streamState, setStreamState] = useState<StreamState>({
		kind: "idle",
		events: [],
	});

	async function runUnary(fail = false) {
		const startedAt = performance.now();
		setUnaryState({ kind: "loading", startedAt });

		try {
			const call = client.sayHello(
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
			const call = client.watchGreetings({ name, count: 3 });

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

	return (
		<main className="app-shell">
			<section className="hero">
				<p className="eyebrow">protobuf-ts + Vite + React</p>
				<h1>grpc-web-mock playground</h1>
				<p>
					這個範例從 <code>greeter.proto</code> 產生 client，並用 workspace 中的{" "}
					<code>grpc-web-mock</code> package 注入 mock transport。
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
			</div>
		</main>
	);
}
