# add-grpc-web-mock-library

以 protobuf-ts 的 RpcTransport 為核心，打造型別安全的 gRPC-Web mock npm library。API 風格參考 msw，但不相依 msw；核心為 transport-first mock，相容既有 RpcInterceptor-based DevTools。
