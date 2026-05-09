# Changelog

## 0.1.0

### Added

- `MockRpcTransport` and `createGrpcMockTransport()` for unary and server-streaming mocks
- method-keyed registry creation with `createGrpcMockRegistry()`
- `grpc.unary()` and `grpc.serverStreaming()` handler registration helpers
- `grpc.reply()` for delayed responses with headers and trailers
- `grpc.error()` for consistent `RpcError` creation
- fallback delegation and resolver-level `passthrough()`
- interceptor parity coverage, including the existing DevTools-style workflow

### Known non-goals

- `clientStreaming()` throws `UNIMPLEMENTED`
- `duplex()` throws `UNIMPLEMENTED`
- no MSW bridge and no `./msw` export
