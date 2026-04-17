## ADDED Requirements

### Requirement: Bridge converts the same registry into MSW HTTP handlers

The library SHALL provide a `createGrpcMswHandlers(registry, options)` function (published under the `./msw` subpath export) that converts the exact same handler registry used by `MockRpcTransport` into an array of `msw` `http.post(...)` handlers. Users MUST NOT be required to duplicate handler definitions between transport mode and MSW mode.

#### Scenario: Shared registry produces MSW handlers
- **WHEN** a developer creates a registry with `grpc.unary(...)` and passes it to both `createGrpcMockTransport({registry})` and `createGrpcMswHandlers(registry, options)`
- **THEN** the same resolver MUST be invoked whether the request flows through the mock transport path or through the MSW-intercepted `fetch` path
- **AND** both paths MUST produce responses whose decoded message contents are equivalent

### Requirement: Bridge derives URL routes from protobuf-ts reflection

The bridge SHALL derive the gRPC-Web URL for each handler using the same rules as `GrpcWebFetchTransport.makeUrl()`, i.e. `${baseUrl}/${ServiceInfo.typeName}/${MethodInfo.name}`. The `baseUrl` MUST be configurable via `options.baseUrl`, with wildcard/base-less support (e.g. `*/service/method`) for environments where the absolute backend URL is not known in tests.

#### Scenario: Absolute baseUrl
- **WHEN** `options.baseUrl` is `'https://api.example.com'` and the registry contains `my.pkg.UserService/GetUser`
- **THEN** the generated handler MUST match `POST https://api.example.com/my.pkg.UserService/GetUser`

#### Scenario: Wildcard route when no baseUrl
- **WHEN** `options.baseUrl` is omitted
- **THEN** the generated handler MUST match any origin, e.g. `POST */my.pkg.UserService/GetUser`

### Requirement: Bridge decodes gRPC-Web request body into a typed message

The bridge SHALL decode the incoming request body according to the gRPC-Web wire format and invoke the resolver with the fully decoded typed request. The bridge MUST NOT require the resolver to handle `ArrayBuffer`, base64, or frame prefixes.

- Request body MUST be read via `req.arrayBuffer()`.
- For `binary` format, the bridge strips the 5-byte data frame header and calls `method.I.fromBinary(payload)`.
- For `text` format, the bridge MUST base64-decode the body before stripping the frame header.
- Content-Type SHOULD be validated to start with `application/grpc-web` (or `application/grpc-web-text` for text mode); a mismatch MUST result in HTTP 415 with a clear message.

#### Scenario: Binary request decoding
- **WHEN** an MSW-intercepted request arrives with `Content-Type: application/grpc-web+proto` and a protobuf-encoded `GetUserRequest`
- **THEN** the resolver MUST receive a fully decoded `GetUserRequest` object matching the original input

#### Scenario: Text request decoding
- **WHEN** an MSW-intercepted request arrives with `Content-Type: application/grpc-web-text` and a base64-encoded framed body
- **THEN** the bridge MUST base64-decode the body, strip the frame prefix, and pass a decoded typed request to the resolver

#### Scenario: Invalid content type
- **WHEN** a request arrives with a non-gRPC-Web content type such as `application/json`
- **THEN** the bridge MUST respond with HTTP 415 and MUST NOT invoke the resolver

### Requirement: Bridge encodes unary responses with a DATA frame and TRAILER frame

The bridge SHALL encode unary responses as a `Uint8Array` composed of a DATA frame (type `0x00`, 4-byte big-endian length, then `method.O.toBinary(response)`) followed by a TRAILER frame (type `0x80`, 4-byte big-endian length, then ASCII trailer text including `grpc-status: 0\r\n` for success). The bridge MUST reuse the public frame helpers from `@protobuf-ts/grpcweb-transport` rather than reimplementing framing logic.

#### Scenario: Successful unary response frame layout
- **WHEN** a resolver returns `{message: 'hi'}` for `SayHello`
- **THEN** the HTTP response body MUST contain a DATA frame whose payload decodes to `{message: 'hi'}` followed by a TRAILER frame whose text includes `grpc-status:0`
- **AND** the response `Content-Type` MUST be `application/grpc-web+proto` in binary mode

#### Scenario: Error response uses trailer-only format
- **WHEN** a resolver throws `RpcError('not found', 'NOT_FOUND')`
- **THEN** the response body MUST include a TRAILER frame whose text contains `grpc-status:5` and `grpc-message:not found`
- **AND** the response MUST NOT include a DATA frame for the missing body

### Requirement: Bridge supports server streaming via a single combined body in MVP

For server-streaming methods the bridge SHALL serialize all resolver-emitted messages followed by a trailer frame into a single `Uint8Array` body and return it with `HttpResponse` (or a native `Response`) in MVP. The bridge MAY upgrade to `ReadableStream<Uint8Array>` for progressive frame delivery in a later phase, but the wire format MUST remain valid in either case.

#### Scenario: Multi-message stream in one body
- **WHEN** a resolver emits three messages for a server-streaming RPC
- **THEN** the response body MUST contain three DATA frames in emission order followed by one TRAILER frame indicating `grpc-status:0`

#### Scenario: Streaming error mid-emission
- **WHEN** a resolver emits one message then throws `RpcError('x', 'INTERNAL')`
- **THEN** the response body MUST contain one DATA frame followed by a TRAILER frame carrying `grpc-status:13` and the error message

### Requirement: Bridge supports binary (default) and optional text wire formats

The bridge SHALL default to `options.format === 'binary'`. When `options.format === 'text'` is set, both request decoding and response encoding MUST follow the gRPC-Web-text base64 rules, including correct base64 padding at chunk boundaries on response.

#### Scenario: Binary default
- **WHEN** `options.format` is not provided
- **THEN** the bridge MUST handle requests and responses as if `format: 'binary'` was set

#### Scenario: Text mode response encoding
- **WHEN** `options.format === 'text'` and the resolver returns a message
- **THEN** the response body MUST be a base64 string of the same DATA + TRAILER frames that would have been produced in binary mode
- **AND** the response `Content-Type` MUST be `application/grpc-web-text`

### Requirement: Bridge routes unregistered methods via MSW's native fall-through

Unregistered gRPC-Web URLs MUST NOT match any handler produced by the bridge, so that MSW's `onUnhandledRequest` setting (at `setupWorker` / `setupServer` level) decides whether to warn, error, or bypass. The bridge itself SHALL NOT call `req.passthrough()` implicitly for unregistered routes.

#### Scenario: Unregistered method passes through MSW
- **WHEN** a request hits `POST .../UnknownService/UnknownMethod` and the registry has no matching handler
- **THEN** the bridge-produced handler array MUST NOT contain a handler that matches the request
- **AND** MSW's configured `onUnhandledRequest` behavior MUST apply

### Requirement: Bridge requires MSW v2 or later

The `./msw` subpath export SHALL declare `msw` as an optional peer dependency with version `>= 2.0.0` and SHALL NOT be expected to work with MSW v1. Documentation MUST state this constraint.

#### Scenario: MSW v2 binary body handling
- **WHEN** a handler created by the bridge is executed under MSW v2+
- **THEN** `req.arrayBuffer()` MUST return the unmodified protobuf bytes (i.e. not suffer from the MSW v1 binary-body corruption issue)
