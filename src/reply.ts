import type { GrpcMockReply } from "./types.js";

export const REPLY_MARKER = Symbol("grpc-mock-reply");

export type InternalReply<O extends object> = GrpcMockReply<O> & {
	[REPLY_MARKER]: true;
};

export function markReply<O extends object>(
	value: GrpcMockReply<O>,
): InternalReply<O> {
	return {
		...value,
		[REPLY_MARKER]: true,
	};
}

export function isReply<O extends object>(
	value: unknown,
): value is InternalReply<O> {
	return (
		typeof value === "object" &&
		value !== null &&
		REPLY_MARKER in value &&
		(value as InternalReply<O>)[REPLY_MARKER] === true
	);
}
