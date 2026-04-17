## ADDED Requirements

### Requirement: Bridge 必須把同一份 registry 轉成 MSW HTTP handlers

函式庫 SHALL 提供 `createGrpcMswHandlers(registry, options)` 函式（發佈於 `./msw` subpath export），將 `MockRpcTransport` 使用的同一份 handler registry 轉成 `msw` 的 `http.post(...)` handler 陣列。使用者 MUST NOT 被要求在 transport mode 與 MSW mode 之間重複定義 handler。

#### Scenario: 共用 registry 產生 MSW handlers
- **WHEN** 開發者以 `grpc.unary(...)` 建立 registry，並同時傳入 `createGrpcMockTransport({registry})` 與 `createGrpcMswHandlers(registry, options)`
- **THEN** 不論請求是走 mock transport 路徑，或走被 MSW 攔截的 `fetch` 路徑，都 MUST 呼叫相同的 resolver
- **AND** 兩條路徑產生的回應在解碼後 MUST 具有等價的 message 內容

### Requirement: Bridge 必須透過 protobuf-ts reflection 推導 URL 路由

Bridge SHALL 依照 `GrpcWebFetchTransport.makeUrl()` 相同的規則，為每個 handler 推導 gRPC-Web URL，也就是 `${baseUrl}/${ServiceInfo.typeName}/${MethodInfo.name}`。`baseUrl` MUST 可透過 `options.baseUrl` 設定；若測試環境無法預先得知完整後端 URL，也 MUST 支援萬用或無 base 的比對方式（例如 `*/service/method`）。

#### Scenario: 使用絕對 `baseUrl`
- **WHEN** `options.baseUrl` 為 `'https://api.example.com'`，且 registry 包含 `my.pkg.UserService/GetUser`
- **THEN** 產生的 handler MUST 比對 `POST https://api.example.com/my.pkg.UserService/GetUser`

#### Scenario: 未提供 `baseUrl` 時使用萬用路由
- **WHEN** 省略 `options.baseUrl`
- **THEN** 產生的 handler MUST 能比對任意 origin，例如 `POST */my.pkg.UserService/GetUser`

### Requirement: Bridge 必須把 gRPC-Web request body 解碼成型別安全的 message

Bridge SHALL 依照 gRPC-Web wire format 解碼收到的 request body，並以完整解碼後的 typed request 呼叫 resolver。Bridge MUST NOT 要求 resolver 自行處理 `ArrayBuffer`、base64 或 frame prefix。

- Request body MUST 透過 `req.arrayBuffer()` 讀取。
- 在 `binary` 格式下，bridge MUST 去除 5-byte data frame header，再呼叫 `method.I.fromBinary(payload)`。
- 在 `text` 格式下，bridge MUST 先對 body 進行 base64 解碼，再去除 frame header。
- `Content-Type` SHOULD 驗證為以 `application/grpc-web` 開頭（`text` 模式則為 `application/grpc-web-text`）；若不符，MUST 以清楚訊息回應 HTTP 415。

#### Scenario: 解碼 binary request
- **WHEN** 一個被 MSW 攔截的請求帶著 `Content-Type: application/grpc-web+proto`，且 body 為 protobuf 編碼的 `GetUserRequest`
- **THEN** resolver MUST 收到與原始輸入一致、且已完整解碼的 `GetUserRequest` 物件

#### Scenario: 解碼 text request
- **WHEN** 一個被 MSW 攔截的請求帶著 `Content-Type: application/grpc-web-text`，且 body 為 base64 編碼後的 framed body
- **THEN** bridge MUST 先對 body 做 base64 解碼，再去掉 frame prefix，並把解碼後的 typed request 傳給 resolver

#### Scenario: 無效的 content type
- **WHEN** 收到 `application/json` 之類的非 gRPC-Web content type
- **THEN** bridge MUST 回應 HTTP 415，且 MUST NOT 呼叫 resolver

### Requirement: Bridge 必須用 DATA frame 與 TRAILER frame 編碼 unary response

Bridge SHALL 將 unary response 編碼為一個 `Uint8Array`，內容由 DATA frame（type `0x00`、4-byte big-endian length、接著 `method.O.toBinary(response)`）與 TRAILER frame（type `0x80`、4-byte big-endian length、接著 ASCII trailer text；成功時包含 `grpc-status: 0\r\n`）組成。Bridge MUST 重用 `@protobuf-ts/grpcweb-transport` 公開的 frame helpers，而不是自行重寫 framing 邏輯。

#### Scenario: 成功的 unary response frame 佈局
- **WHEN** resolver 對 `SayHello` 回傳 `{message: 'hi'}`
- **THEN** HTTP response body MUST 包含一個 DATA frame，其 payload 解碼後為 `{message: 'hi'}`，並在後面接上一個文字包含 `grpc-status:0` 的 TRAILER frame
- **AND** 在 binary mode 下，response 的 `Content-Type` MUST 為 `application/grpc-web+proto`

#### Scenario: 錯誤回應只使用 trailer frame
- **WHEN** resolver 丟出 `RpcError('not found', 'NOT_FOUND')`
- **THEN** response body MUST 包含一個 TRAILER frame，其文字包含 `grpc-status:5` 與 `grpc-message:not found`
- **AND** response MUST NOT 為缺少 body 的情況再附帶 DATA frame

### Requirement: MVP 的 Bridge 必須以單一完整 body 支援 server streaming

對 server-streaming method 而言，Bridge 在 MVP SHALL 把 resolver 送出的所有 message 與最後的 trailer frame 序列化成單一 `Uint8Array` body，並透過 `HttpResponse`（或原生 `Response`）回傳。未來階段 MAY 升級為 `ReadableStream<Uint8Array>` 以支援漸進式 frame 傳送，但無論採哪種形式，wire format MUST 保持合法。

#### Scenario: 單一 body 內包含多筆 stream message
- **WHEN** resolver 為 server-streaming RPC 送出三筆訊息
- **THEN** response body MUST 依送出順序包含三個 DATA frame，最後再接上一個表示 `grpc-status:0` 的 TRAILER frame

#### Scenario: 串流中途發生錯誤
- **WHEN** resolver 先送出一筆訊息，接著丟出 `RpcError('x', 'INTERNAL')`
- **THEN** response body MUST 包含一個 DATA frame，後面再接上一個帶有 `grpc-status:13` 與錯誤訊息的 TRAILER frame

### Requirement: Bridge 必須支援 binary（預設）與可選的 text wire format

Bridge SHALL 以 `options.format === 'binary'` 為預設。當設定 `options.format === 'text'` 時，request 解碼與 response 編碼 MUST 遵守 gRPC-Web-text 的 base64 規則，包含 response 在 chunk 邊界上的正確 base64 padding。

#### Scenario: 預設使用 binary
- **WHEN** 未提供 `options.format`
- **THEN** bridge MUST 以 `format: 'binary'` 的方式處理 request 與 response

#### Scenario: Text mode 的 response 編碼
- **WHEN** `options.format === 'text'`，且 resolver 回傳一筆訊息
- **THEN** response body MUST 是與 binary mode 相同 DATA + TRAILER frames 的 base64 字串表示
- **AND** response 的 `Content-Type` MUST 為 `application/grpc-web-text`

### Requirement: Bridge 必須把未註冊 method 交給 MSW 原生的 fall-through 行為

未註冊的 gRPC-Web URL MUST NOT 比對到 bridge 產生的任何 handler，讓 MSW 在 `setupWorker` 或 `setupServer` 層級設定的 `onUnhandledRequest` 決定要 warning、error 或 bypass。Bridge 本身 SHALL NOT 對未註冊路由隱式呼叫 `req.passthrough()`。

#### Scenario: 未註冊 method 交由 MSW 處理
- **WHEN** 某個請求打到 `POST .../UnknownService/UnknownMethod`，且 registry 中沒有對應 handler
- **THEN** bridge 產生的 handler 陣列 MUST NOT 包含可以比對該請求的 handler
- **AND** MUST 套用 MSW 已設定的 `onUnhandledRequest` 行為

### Requirement: Bridge 必須要求 MSW v2 以上版本

`./msw` subpath export SHALL 把 `msw` 宣告為 optional peer dependency，且版本為 `>= 2.0.0`；它 SHALL NOT 被視為支援 MSW v1。文件 MUST 明確說明這個限制。

#### Scenario: MSW v2 的 binary body 處理
- **WHEN** 一個由 bridge 建立的 handler 在 MSW v2+ 環境中執行
- **THEN** `req.arrayBuffer()` MUST 回傳未被修改的 protobuf 位元組（也就是不受 MSW v1 binary body 汙染問題影響）
