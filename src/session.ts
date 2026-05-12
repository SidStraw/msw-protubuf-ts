export type DeepReadonly<T> = T extends (...args: never[]) => unknown
	? T
	: T extends readonly (infer Item)[]
		? ReadonlyArray<DeepReadonly<Item>>
		: T extends object
			? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
			: T;

export interface GrpcMockSession<
	TState extends object = Record<string, unknown>,
> {
	getState(): DeepReadonly<TState>;
	update(
		updater: (state: DeepReadonly<TState>) => TState,
	): DeepReadonly<TState>;
	reset(): DeepReadonly<TState>;
}

function cloneState<TState extends object>(state: TState): TState {
	try {
		return structuredClone(state);
	} catch (error) {
		throw new TypeError(
			"Failed to clone gRPC mock session state. Session state must contain structuredClone()-compatible data.",
			{ cause: error },
		);
	}
}

export function createGrpcMockSession(): GrpcMockSession<
	Record<string, unknown>
>;
export function createGrpcMockSession<TState extends object>(
	initialState: TState,
): GrpcMockSession<TState>;
export function createGrpcMockSession<TState extends object>(
	initialState?: TState,
): GrpcMockSession<TState | Record<string, unknown>> {
	const initialSnapshot = cloneState(initialState ?? {});
	let state = cloneState(initialSnapshot);

	return {
		getState() {
			return cloneState(state);
		},
		update(updater) {
			state = cloneState(updater(cloneState(state)));
			return cloneState(state);
		},
		reset() {
			state = cloneState(initialSnapshot);
			return cloneState(state);
		},
	};
}
