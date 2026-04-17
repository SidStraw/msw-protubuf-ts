## ADDED Requirements

### Requirement: Mock RpcTransport implements the protobuf-ts RpcTransport interface

The library SHALL provide a `MockRpcTransport` class that fully implements the `@protobuf-ts/runtime-rpc` `RpcTransport` interface, so it can be passed directly to any `protobuf-ts` generated client constructor in place of `GrpcWebFetchTransport`.

#### Scenario: Generated client accepts the mock transport
- **WHEN** application code calls `new GeneratedServiceClient(mockTransport)` where `mockTransport` is produced by `createGrpcMockTransport(...)`
- **THEN** the client MUST be constructed without type errors and every generated method MUST dispatch through the mock transport instead of the network

#### Scenario: Transport exposes all four RpcTransport methods
- **WHEN** the mock transport instance is inspected
- **THEN** it MUST expose `mergeOptions`, `unary`, `serverStreaming`, `clientStreaming`, and `duplex` methods with signatures matching the `RpcTransport` interface

### Requirement: Handler registry is declarative and service/method based

The library SHALL provide a registry API that registers handlers by `ServiceInfo` and method `localName`, not by URL. The registry MUST use reflection (`ServiceInfo.typeName`, `MethodInfo.name`, `MethodInfo.localName`) to derive routing keys internally.

#### Scenario: Register a unary handler by service and method localName
- **WHEN** the developer calls `grpc.unary(MyService, 'getUser', resolver)`
- **THEN** the registry MUST resolve the method using `MyService.methods.find(m => m.localName === 'getUser')`
- **AND** subsequent invocations of `client.getUser(...)` MUST route to the given resolver

#### Scenario: Register a server-streaming handler by service and method localName
- **WHEN** the developer calls `grpc.serverStreaming(MyService, 'watchUsers', resolver)`
- **THEN** the registry MUST only accept methods whose `MethodInfo.serverStreaming` is `true`
- **AND** registering a unary method with `grpc.serverStreaming` MUST throw an error describing the mismatch

#### Scenario: Unknown method name is rejected at registration time
- **WHEN** the developer calls `grpc.unary(MyService, 'nonexistent', resolver)` with a name that does not match any `localName` in the service
- **THEN** the registry MUST throw an error naming both the service `typeName` and the method name attempted

### Requirement: Unary resolver receives a typed request and returns a typed response

For unary methods the resolver function SHALL receive a context containing `request: I`, `method: MethodInfo<I, O>`, `meta: RpcMetadata`, `signal?: AbortSignal`, and a `passthrough()` control function, and it SHALL return `O | Promise<O>` or throw an `RpcError`.

#### Scenario: Resolver returns a plain object
- **WHEN** the resolver returns `{ id: '1', name: 'A' }`
- **THEN** the generated client call MUST resolve with the object typed as `O` (the method's output message type)

#### Scenario: Resolver returns a promise
- **WHEN** the resolver returns a `Promise<O>`
- **THEN** the client call MUST await the promise before resolving the `UnaryCall` response

#### Scenario: Resolver throws RpcError
- **WHEN** the resolver throws `new RpcError('not found', 'NOT_FOUND')`
- **THEN** the client call MUST reject with the same `RpcError`, status code `NOT_FOUND`, and MUST NOT resolve `response`, `headers`, `status`, or `trailers` promises with success values

#### Scenario: Resolver receives decoded request and method info
- **WHEN** an app calls `client.getUser({ id: '42' })`
- **THEN** the resolver context MUST include `request.id === '42'` and `method.name === 'GetUser'` (the proto method name) without requiring the resolver to decode any bytes

### Requirement: Server-streaming resolver supports iterable, async iterable, and imperative emission

For server-streaming methods the resolver SHALL be allowed to emit messages in any of the following ways: (a) return an `Iterable<O>` or array, (b) return an `AsyncIterable<O>`, or (c) call `stream.send(msg)` / `stream.complete()` / `stream.error(err)` on the provided context.

#### Scenario: Array return emits then completes
- **WHEN** the resolver returns `[{id: '1'}, {id: '2'}]`
- **THEN** the `ServerStreamingCall` output stream MUST emit both messages in order and then notify completion with status `OK`

#### Scenario: Async iterable emits then completes
- **WHEN** the resolver returns an `AsyncIterable<O>` yielding two messages
- **THEN** the output stream MUST emit both messages and then notify completion once the iterable finishes

#### Scenario: Imperative stream context
- **WHEN** the resolver calls `ctx.stream.send(a)`, `ctx.stream.send(b)`, `ctx.stream.complete()`
- **THEN** the output stream MUST emit `a`, `b`, then complete with status `OK`

#### Scenario: Abort signal stops emission
- **WHEN** the caller aborts via `options.abort` while the resolver is mid-emit
- **THEN** the resolver context `signal.aborted` MUST become `true` and the stream MUST terminate with an `RpcError` of code `CANCELLED`

### Requirement: Unregistered methods have well-defined dispatch behavior

The library SHALL allow the user to configure behavior for methods with no registered handler via `createGrpcMockTransport({ registry, fallbackTransport?, onUnhandledRequest? })`. Behavior MUST be:

- If `fallbackTransport` is provided, unregistered calls MUST be delegated to that transport unchanged (same `method`, `input`, `options`).
- Otherwise the dispatcher MUST honor `onUnhandledRequest`: `'error'` (default) throws `RpcError('UNIMPLEMENTED', …)`; `'warn'` logs a warning and then throws the same error.
- `passthrough()` invoked inside a resolver MUST behave identically to an unregistered call (i.e. delegate to `fallbackTransport` if configured, otherwise follow `onUnhandledRequest`).

#### Scenario: Fallback transport delegation
- **WHEN** `fallbackTransport` is set and a call hits an unregistered method
- **THEN** the call MUST be forwarded to `fallbackTransport.unary`/`serverStreaming` with the same arguments and the returned call object MUST be used as the response

#### Scenario: Default error on unhandled
- **WHEN** no `fallbackTransport` is configured and `onUnhandledRequest` is unset
- **THEN** the call MUST reject with `RpcError` whose status code is `UNIMPLEMENTED` and whose message includes the service type name and method name

#### Scenario: Resolver passthrough delegates to fallback
- **WHEN** a resolver calls `ctx.passthrough()` and a `fallbackTransport` is configured
- **THEN** the original call MUST be forwarded to `fallbackTransport` and the resolver's subsequent return value MUST be ignored

### Requirement: Resolver controls delay, headers, trailers, and RpcError

The library SHALL expose APIs for resolvers to control response timing and metadata without manually constructing a `UnaryCall` or `ServerStreamingCall`.

- Resolvers MAY return a wrapped reply (e.g. via `grpc.reply(...)` helper) that carries `{ body, headers?, trailers?, delay? }` alongside the response body.
- Resolvers MAY throw or return an `RpcError` (including status code and optional metadata).
- A helper `grpc.error(code, message, meta?)` SHALL exist to construct an `RpcError` consistently.

#### Scenario: Delay before unary response
- **WHEN** the resolver returns a reply with `delay: 100` ms
- **THEN** the client's `response` promise MUST resolve no earlier than approximately 100 ms after invocation

#### Scenario: Custom headers and trailers
- **WHEN** the resolver returns a reply with `headers: {'x-test': 'a'}` and `trailers: {'x-trailer': 'b'}`
- **THEN** the `UnaryCall.headers` promise MUST resolve with the provided headers and the `trailers` promise MUST resolve with the provided trailers

#### Scenario: RpcError shorthand
- **WHEN** the resolver throws `grpc.error('NOT_FOUND', 'missing')`
- **THEN** the thrown value MUST be an instance of `RpcError` with `code === 'NOT_FOUND'` and `message === 'missing'`

### Requirement: Client streaming and duplex are explicitly unsupported in MVP

The `clientStreaming` and `duplex` methods on `MockRpcTransport` SHALL match the gRPC-Web transport's behavior by rejecting with `RpcError` status `UNIMPLEMENTED`.

#### Scenario: Calling a client-streaming method
- **WHEN** application code invokes a client-streaming RPC through the mock transport
- **THEN** the call MUST reject with `RpcError` of code `UNIMPLEMENTED` and a message indicating that gRPC-Web does not support client streaming

#### Scenario: Calling a duplex method
- **WHEN** application code invokes a duplex RPC through the mock transport
- **THEN** the call MUST reject with `RpcError` of code `UNIMPLEMENTED` and a message indicating that gRPC-Web does not support duplex streaming

### Requirement: RpcOptions meta is propagated to resolver context

The mock transport SHALL forward the caller's `RpcOptions.meta` (if present) into the resolver's context `meta` field without mutation.

#### Scenario: Metadata forwarding
- **WHEN** the caller invokes `client.getUser({id: '1'}, {meta: {'x-auth': 'token'}})`
- **THEN** the resolver context MUST observe `meta['x-auth'] === 'token'`
