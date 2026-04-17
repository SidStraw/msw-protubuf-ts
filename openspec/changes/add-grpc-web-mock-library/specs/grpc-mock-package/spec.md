## ADDED Requirements

### Requirement: Library is published as a single npm package with subpath exports

The library SHALL be published as a single npm package that exposes two entry points via the `exports` field in `package.json`:

- `"."`: the core (registry + `MockRpcTransport`), which MUST NOT import anything from `msw` or `@protobuf-ts/grpcweb-transport`.
- `"./msw"`: the MSW bridge, which MAY import from `msw` and `@protobuf-ts/grpcweb-transport`.

Both entry points MUST export TypeScript declaration files alongside runtime code.

#### Scenario: Main entry has no MSW dependency at runtime
- **WHEN** a consumer imports `createGrpcMockTransport` / `createGrpcMockRegistry` / `grpc` from the main entry point
- **THEN** module resolution and bundling MUST succeed even when `msw` is not installed in the consumer's project

#### Scenario: MSW entry imports from the correct subpath
- **WHEN** a consumer imports `createGrpcMswHandlers` from the `./msw` subpath
- **THEN** the module MUST resolve from the `"./msw"` exports entry and MUST pull in `msw` and `@protobuf-ts/grpcweb-transport` at that point

### Requirement: Dependencies are declared as peers with correct optionality

The package `package.json` SHALL declare dependencies as follows:

- `peerDependencies` MUST include `@protobuf-ts/runtime` and `@protobuf-ts/runtime-rpc` with version ranges matching published `protobuf-ts` majors used by the project (`^2.x` at MVP time).
- `peerDependencies` MUST include `msw` (`^2`) and `@protobuf-ts/grpcweb-transport` (`^2`).
- `peerDependenciesMeta` MUST mark `msw` and `@protobuf-ts/grpcweb-transport` as `{"optional": true}` so consumers who only use the core entry are not forced to install them.
- `dependencies` MUST NOT duplicate any of the above peer packages.

#### Scenario: Install without MSW succeeds
- **WHEN** a consumer runs `npm install <package>` in a project that does not list `msw` or `@protobuf-ts/grpcweb-transport`
- **THEN** `npm` MUST NOT produce a missing-peer error for those two packages (they are optional)
- **AND** MUST produce an unresolved-peer error if `@protobuf-ts/runtime` or `@protobuf-ts/runtime-rpc` are missing

### Requirement: TypeScript types are first-class and match runtime shape

The package SHALL ship TypeScript type definitions for both entry points, ensuring:

- Generated `protobuf-ts` client types infer correctly when `MockRpcTransport` is used in place of `GrpcWebFetchTransport`.
- `grpc.unary(Service, 'methodLocalName', resolver)` MUST infer the resolver's `request: I` and return type `O` from `MethodInfo<I, O>` when the generated service carries sufficient type information; otherwise an explicit generic form `grpc.unary<Req, Res>(...)` MUST be available as a fallback.
- Public types MUST be exported by name (e.g. `MockHandler`, `GrpcMockRegistry`, `GrpcMockContext`, `UnaryResolver`, `ServerStreamResolver`).

#### Scenario: Type inference with generated service
- **WHEN** a developer uses `grpc.unary(GreeterService, 'sayHello', ({request}) => ({message: request.name}))` and `GreeterService` carries `MethodInfo<SayHelloRequest, SayHelloResponse>`
- **THEN** TypeScript MUST infer `request` as `SayHelloRequest` and flag returning a non-`SayHelloResponse` shape as a type error

#### Scenario: Explicit generic fallback
- **WHEN** generated service typing is too weak for inference
- **THEN** `grpc.unary<SayHelloRequest, SayHelloResponse>(Service, 'sayHello', resolver)` MUST compile and enforce the given `I` and `O` types on the resolver

### Requirement: Package supports an environment-variable-driven transport factory pattern

The package SHALL document and export helpers or clear integration examples that allow consumers to select between `MockRpcTransport` and a real transport based on environment variables, without modifying call sites that use generated clients.

- The README MUST include a Vite-style example using an environment variable (e.g. `VITE_ENABLE_API_MOCK`) in a `createApiTransport()` factory.
- The factory pattern MUST support optional `fallbackTransport` usage so unregistered methods hit the real backend during incremental rollout.

#### Scenario: Factory-based transport switching
- **WHEN** a consumer configures `createApiTransport` to return `createGrpcMockTransport({registry, fallbackTransport: realTransport})` only when `VITE_ENABLE_API_MOCK === 'true'`
- **THEN** existing `new XxxServiceClient(transport)` call sites MUST work unchanged in both mock and real modes

#### Scenario: Tree-shakable mock code in production
- **WHEN** the env variable is statically `false` at build time and the consumer uses dynamic `import()` guarded by that flag
- **THEN** the mock library's runtime code MUST NOT be included in the production bundle

### Requirement: Package follows SemVer and explicit MVP scope

The package SHALL follow Semantic Versioning, with MVP released as `0.x`. Documentation SHALL clearly state the MVP scope:

- Supported: `unary`, `serverStreaming`, `passthrough`, `delay`, headers/trailers, `RpcError`.
- Unsupported: `clientStreaming`, `duplex` (these throw `UNIMPLEMENTED`).
- Default wire format for the MSW bridge: `binary`; `text` is experimental.

#### Scenario: Documented unsupported methods behave consistently
- **WHEN** a developer reads the README or TypeScript docstrings for `clientStreaming` / `duplex`
- **THEN** the docs MUST explicitly state that these are unsupported at MVP and match the runtime behavior of throwing `RpcError('UNIMPLEMENTED', ...)`

#### Scenario: Breaking changes before 1.0
- **WHEN** the package releases a new minor version while below `1.0.0`
- **THEN** breaking API changes MUST be called out in the CHANGELOG, following standard `0.x` conventions
