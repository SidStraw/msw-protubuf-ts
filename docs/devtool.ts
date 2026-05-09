import type { RpcInterceptor } from "@protobuf-ts/runtime-rpc";
import type { ServerStreamingCall, UnaryCall } from "@protobuf-ts/runtime-rpc";

let isUnloading = false;
window.addEventListener("beforeunload", () => {
	isUnloading = true;
	const message = {
		source: "__gRPC_devtools_content_scripts_main__",
		payload: {
			action: "unload",
		},
	};
	window.postMessage(message, "*");
});

function decodeMessage(message: string): string {
	try {
		return decodeURIComponent(message);
	} catch {
		return message;
	}
}

function normalizeBigInt(input: unknown): unknown {
	if (typeof input === "bigint") {
		return input.toString();
	}

	if (typeof input === "string") {
		return decodeMessage(input);
	}

	if (Array.isArray(input)) {
		return input.map(normalizeBigInt);
	}

	if (input && typeof input === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(input)) {
			result[key] = normalizeBigInt(value);
		}
		return result;
	}

	return input;
}

const postMessageToContentScript = ({
	id,
	methodName,
	serviceName,
	requestMessage,
	requestMetadata,
	responseMetadata,
	responseMessage,
	errorMetadata,
}: {
	id: string;
	methodName?: undefined | string;
	serviceName?: undefined | string;
	requestMessage?: undefined | unknown;
	requestMetadata?: undefined | Record<string, string>;
	responseMetadata?: undefined | Record<string, string>;
	responseMessage?: undefined | unknown;
	errorMetadata?: undefined | Record<string, string>;
}) => {
	if (isUnloading) {
		return;
	}

	const timestamp = Date.now();
	const rawPayload = {
		id,
		timestamp,
		methodName,
		serviceName,
		requestMetadata,
		requestMessage,
		responseMetadata,
		responseMessage:
			responseMessage === "EOF" ? { EOF: timestamp } : responseMessage,
		errorMetadata,
	};

	const message = {
		source: "__gRPC_devtools_content_scripts_main__",
		payload: normalizeBigInt(rawPayload),
	};
	window.postMessage(message, "*");
};

export const devtoolsInterceptor: RpcInterceptor = {
	interceptUnary(next, method, input, options): UnaryCall {
		const id = Math.random().toString(36).slice(2, 6);
		const call = next(method, input, options);

		postMessageToContentScript({
			id: id,
			methodName: call.method.name,
			serviceName: call.method.service.typeName,
			requestMessage: call.request,
			requestMetadata: Array.from(Object.entries(call.requestHeaders)).reduce(
				(acc, [key, value]) => ({ ...acc, [key]: value }),
				{},
			),
		});

		call.then(
			(finishedUnaryCall) => {
				postMessageToContentScript({
					id: id,
					responseMetadata: Array.from(
						Object.entries(finishedUnaryCall.headers),
					).reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {}),
					responseMessage: finishedUnaryCall.response,
				});

				postMessageToContentScript({
					id: id,
					responseMessage: "EOF",
				});

				return finishedUnaryCall;
			},
			(error) => {
				postMessageToContentScript({
					id,
					responseMessage: {
						name: error.name,
						code: error.code,
						message: error.message,
						stack: error.stack,
					},
					errorMetadata: Array.from(Object.entries(error.meta)).reduce(
						(acc, [key, value]) => ({ ...acc, [key]: value }),
						{},
					),
				});

				throw error;
			},
		);

		return call;
	},

	interceptServerStreaming(next, method, input, options): ServerStreamingCall {
		const id = Math.random().toString(36).slice(2, 6);
		const call = next(method, input, options);

		postMessageToContentScript({
			id,
			methodName: call.method.name,
			serviceName: call.method.service.typeName,
			requestMetadata: Array.from(Object.entries(call.requestHeaders)).reduce(
				(acc, [key, value]) => ({ ...acc, [key]: value }),
				{},
			),
			requestMessage: call.request,
		});

		call.responses.onMessage((message) => {
			postMessageToContentScript({
				id,
				responseMessage: message,
			});
		});

		call.responses.onComplete(() => {
			postMessageToContentScript({
				id,
				responseMessage: "EOF",
			});
		});

		call.responses.onError((error) => {
			postMessageToContentScript({
				id,
				responseMessage: {
					name: error.name,
					message: error.message,
					stack: error.stack,
				},
				errorMetadata: {
					name: error.name,
					message: error.message,
				},
			});

			throw error;
		});

		return call;
	},
};

export const DevToolInterceptor = devtoolsInterceptor;
