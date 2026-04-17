## ADDED Requirements

### Requirement: `MockRpcTransport` 必須實作 protobuf-ts 的 `RpcTransport` 介面

函式庫 SHALL 提供 `MockRpcTransport` 類別，完整實作 `@protobuf-ts/runtime-rpc` 的 `RpcTransport` 介面，讓它可以直接取代 `GrpcWebFetchTransport`，傳入任何 `protobuf-ts` 產生的 client constructor。

#### Scenario: Generated client 接受 mock transport
- **WHEN** 應用程式碼呼叫 `new GeneratedServiceClient(mockTransport)`，且 `mockTransport` 來自 `createGrpcMockTransport(...)`
- **THEN** client MUST 能在沒有型別錯誤的情況下建立完成，且所有 generated method MUST 透過 mock transport 分派，而不是走網路請求

#### Scenario: Transport 暴露完整的 `RpcTransport` 方法
- **WHEN** 檢查 mock transport 實例
- **THEN** 它 MUST 暴露 `mergeOptions`、`unary`、`serverStreaming`、`clientStreaming` 與 `duplex` 方法，且簽名必須符合 `RpcTransport` 介面

### Requirement: Handler registry 必須採宣告式、以 service 與 method 為基礎

函式庫 SHALL 提供以 `ServiceInfo` 與 method `localName` 註冊 handler 的 registry API，而不是用 URL 註冊。registry MUST 使用 reflection（`ServiceInfo.typeName`、`MethodInfo.name`、`MethodInfo.localName`）在內部推導 routing key。

#### Scenario: 以 service 與 method `localName` 註冊 unary handler
- **WHEN** 開發者呼叫 `grpc.unary(MyService, 'getUser', resolver)`
- **THEN** registry MUST 透過 `MyService.methods.find(m => m.localName === 'getUser')` 解析目標 method
- **AND** 後續 `client.getUser(...)` 的呼叫 MUST 路由到該 resolver

#### Scenario: 以 service 與 method `localName` 註冊 server-streaming handler
- **WHEN** 開發者呼叫 `grpc.serverStreaming(MyService, 'watchUsers', resolver)`
- **THEN** registry MUST 只接受 `MethodInfo.serverStreaming` 為 `true` 的 method
- **AND** 若把 unary method 註冊到 `grpc.serverStreaming`，MUST 丟出說明型別不符的錯誤

#### Scenario: 註冊時拒絕未知的 method 名稱
- **WHEN** 開發者呼叫 `grpc.unary(MyService, 'nonexistent', resolver)`，且該名稱不符合 service 中任何 `localName`
- **THEN** registry MUST 丟出錯誤，並在訊息中包含 service 的 `typeName` 與嘗試註冊的 method 名稱

### Requirement: Unary resolver 必須收到型別安全的 request，並回傳型別安全的 response

對 unary method 而言，resolver 函式 SHALL 收到包含 `request: I`、`method: MethodInfo<I, O>`、`meta: RpcMetadata`、`signal?: AbortSignal` 與 `passthrough()` 控制函式的 context，並且 SHALL 回傳 `O | Promise<O>`，或丟出 `RpcError`。

#### Scenario: Resolver 回傳一般物件
- **WHEN** resolver 回傳 `{ id: '1', name: 'A' }`
- **THEN** generated client call MUST 以型別 `O`（該 method 的 output message type）resolve 這個物件

#### Scenario: Resolver 回傳 promise
- **WHEN** resolver 回傳 `Promise<O>`
- **THEN** client call MUST 先等待該 promise 完成，再 resolve `UnaryCall` 的 response

#### Scenario: Resolver 丟出 `RpcError`
- **WHEN** resolver 丟出 `new RpcError('not found', 'NOT_FOUND')`
- **THEN** client call MUST 以相同的 `RpcError` 拒絕，狀態碼為 `NOT_FOUND`，且 MUST NOT 讓 `response`、`headers`、`status` 或 `trailers` promise 以成功值 resolve

#### Scenario: Resolver 收到已解碼的 request 與 method 資訊
- **WHEN** 應用程式呼叫 `client.getUser({ id: '42' })`
- **THEN** resolver context MUST 包含 `request.id === '42'` 與 `method.name === 'GetUser'`（proto method 名稱），且 resolver 不需要自行解碼任何位元組

### Requirement: Server-streaming resolver 必須支援 iterable、async iterable 與 imperative emission

對 server-streaming method 而言，resolver SHALL 可以透過下列任一方式送出訊息：（a）回傳 `Iterable<O>` 或陣列、（b）回傳 `AsyncIterable<O>`、或（c）在提供的 context 上呼叫 `stream.send(msg)` / `stream.complete()` / `stream.error(err)`。

#### Scenario: 回傳陣列後依序送出並完成
- **WHEN** resolver 回傳 `[{id: '1'}, {id: '2'}]`
- **THEN** `ServerStreamingCall` 的 output stream MUST 依序送出兩筆訊息，之後再以狀態 `OK` 通知完成

#### Scenario: 回傳 `AsyncIterable` 後送出並完成
- **WHEN** resolver 回傳一個會 yield 兩筆訊息的 `AsyncIterable<O>`
- **THEN** output stream MUST 送出這兩筆訊息，並在 iterable 結束後通知完成

#### Scenario: 使用 imperative stream context
- **WHEN** resolver 呼叫 `ctx.stream.send(a)`、`ctx.stream.send(b)`、`ctx.stream.complete()`
- **THEN** output stream MUST 送出 `a`、`b`，接著以狀態 `OK` 完成

#### Scenario: Abort signal 中止訊息送出
- **WHEN** 呼叫端在 resolver 送出過程中透過 `options.abort` 中止請求
- **THEN** resolver context 的 `signal.aborted` MUST 變成 `true`，且 stream MUST 以 `RpcError`（code 為 `CANCELLED`）終止

### Requirement: 未註冊 method 的分派行為必須明確定義

函式庫 SHALL 允許使用者透過 `createGrpcMockTransport({ registry, fallbackTransport?, onUnhandledRequest? })` 設定沒有註冊 handler 的 method 行為。其行為 MUST 為：

- 若提供 `fallbackTransport`，未註冊呼叫 MUST 原封不動委派給該 transport（相同的 `method`、`input`、`options`）。
- 否則 dispatcher MUST 遵守 `onUnhandledRequest`：`'error'`（預設）丟出 `RpcError('UNIMPLEMENTED', …)`；`'warn'` 先記錄 warning，再丟出相同錯誤。
- 在 resolver 內呼叫的 `passthrough()` MUST 與未註冊呼叫的行為一致（也就是：若有 `fallbackTransport` 就委派過去，否則依 `onUnhandledRequest` 處理）。

#### Scenario: 委派給 fallback transport
- **WHEN** 設定了 `fallbackTransport`，且呼叫命中未註冊 method
- **THEN** 該呼叫 MUST 以相同參數轉送到 `fallbackTransport.unary` 或 `fallbackTransport.serverStreaming`，並採用回傳的 call object 作為結果

#### Scenario: 預設對未處理呼叫拋錯
- **WHEN** 未設定 `fallbackTransport`，且 `onUnhandledRequest` 也未設定
- **THEN** 呼叫 MUST 以 `RpcError` 拒絕，狀態碼為 `UNIMPLEMENTED`，且訊息中必須包含 service type name 與 method name

#### Scenario: Resolver 內的 `passthrough()` 委派到 fallback
- **WHEN** resolver 呼叫 `ctx.passthrough()`，且已設定 `fallbackTransport`
- **THEN** 原始呼叫 MUST 被轉送到 `fallbackTransport`，且 resolver 後續的回傳值 MUST 被忽略

### Requirement: Resolver 必須能控制 delay、headers、trailers 與 `RpcError`

函式庫 SHALL 提供 API，讓 resolver 可以控制回應時機與 metadata，而不需要手動組出 `UnaryCall` 或 `ServerStreamingCall`。

- Resolver MAY 回傳包裝後的 reply（例如透過 `grpc.reply(...)` helper），其中攜帶 `{ body, headers?, trailers?, delay? }` 與 response body。
- Resolver MAY 丟出或回傳 `RpcError`（包含狀態碼與可選 metadata）。
- 函式庫 SHALL 提供 `grpc.error(code, message, meta?)` helper，以一致方式建立 `RpcError`。

#### Scenario: Unary response 延遲回傳
- **WHEN** resolver 回傳帶有 `delay: 100` ms 的 reply
- **THEN** client 的 `response` promise MUST 在呼叫後約 100 ms 之前不得 resolve

#### Scenario: 自訂 headers 與 trailers
- **WHEN** resolver 回傳帶有 `headers: {'x-test': 'a'}` 與 `trailers: {'x-trailer': 'b'}` 的 reply
- **THEN** `UnaryCall.headers` promise MUST 以提供的 headers resolve，且 `trailers` promise MUST 以提供的 trailers resolve

#### Scenario: `RpcError` 簡寫 helper
- **WHEN** resolver 丟出 `grpc.error('NOT_FOUND', 'missing')`
- **THEN** 該值 MUST 是 `RpcError` 的實例，且 `code === 'NOT_FOUND'`、`message === 'missing'`

### Requirement: MVP 必須明確不支援 client streaming 與 duplex

`MockRpcTransport` 上的 `clientStreaming` 與 `duplex` 方法 SHALL 比照 gRPC-Web transport 的行為，以 `RpcError` 狀態 `UNIMPLEMENTED` 拒絕呼叫。

#### Scenario: 呼叫 client-streaming method
- **WHEN** 應用程式碼透過 mock transport 呼叫 client-streaming RPC
- **THEN** 該呼叫 MUST 以 `RpcError` 拒絕，code 為 `UNIMPLEMENTED`，且訊息必須指出 gRPC-Web 不支援 client streaming

#### Scenario: 呼叫 duplex method
- **WHEN** 應用程式碼透過 mock transport 呼叫 duplex RPC
- **THEN** 該呼叫 MUST 以 `RpcError` 拒絕，code 為 `UNIMPLEMENTED`，且訊息必須指出 gRPC-Web 不支援 duplex streaming

### Requirement: `RpcOptions.meta` 必須傳遞到 resolver context

Mock transport SHALL 將呼叫端提供的 `RpcOptions.meta`（若有）原樣傳入 resolver context 的 `meta` 欄位，不得修改。

#### Scenario: Metadata 轉傳
- **WHEN** 呼叫端執行 `client.getUser({id: '1'}, {meta: {'x-auth': 'token'}})`
- **THEN** resolver context MUST 觀察到 `meta['x-auth'] === 'token'`
