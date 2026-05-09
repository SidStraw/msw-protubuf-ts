import type { ServiceInfo } from "@protobuf-ts/runtime-rpc";
import { grpc } from "grpc-web-mock";
import type {
	GrpcMockContext,
	MockHandler,
	UnaryResolver,
} from "grpc-web-mock";

export interface GrpcMockSession<S extends object> {
	getState(): S;
	update(mutator: (state: S) => void): S;
	reset(): S;
}

type SessionUnaryResolver<
	I extends object,
	O extends object,
	S extends object,
> = (
	context: GrpcMockContext<I, O> & { session: GrpcMockSession<S> },
) => ReturnType<UnaryResolver<I, O>>;

export function createGrpcMockSession<S extends object>(
	initialState: S,
): GrpcMockSession<S> {
	const initialSnapshot = structuredClone(initialState);
	let state = structuredClone(initialSnapshot);

	return {
		getState() {
			return structuredClone(state);
		},
		update(mutator) {
			mutator(state);
			return structuredClone(state);
		},
		reset() {
			state = structuredClone(initialSnapshot);
			return structuredClone(state);
		},
	};
}

export function defineUnaryMock<I extends object, O extends object>(
	service: ServiceInfo,
	methodLocalName: string,
	response: O,
): MockHandler<I, O>;
export function defineUnaryMock<I extends object, O extends object>(
	service: ServiceInfo,
	methodLocalName: string,
	resolver: UnaryResolver<I, O>,
): MockHandler<I, O>;
export function defineUnaryMock<I extends object, O extends object>(
	service: ServiceInfo,
	methodLocalName: string,
	responseOrResolver: O | UnaryResolver<I, O>,
): MockHandler<I, O> {
	const resolver: UnaryResolver<I, O> =
		typeof responseOrResolver === "function"
			? (responseOrResolver as UnaryResolver<I, O>)
			: () => responseOrResolver;

	return grpc.unary<I, O>(service, methodLocalName, resolver);
}

export function defineSessionUnaryMock<
	I extends object,
	O extends object,
	S extends object,
>(
	session: GrpcMockSession<S>,
	service: ServiceInfo,
	methodLocalName: string,
	resolver: SessionUnaryResolver<I, O, S>,
): MockHandler<I, O> {
	return defineUnaryMock<I, O>(service, methodLocalName, (context) =>
		resolver({ ...context, session }),
	);
}
