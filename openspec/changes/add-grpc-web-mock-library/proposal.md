## Why

目前使用 `protobuf-ts` 產生 gRPC-Web client 的前端專案，在開發與測試階段缺少官方或社群成熟的 mock 方案：`msw` 沒有一級的 gRPC 支援，直接以 HTTP handler 做 gRPC-Web mock 需要自行處理 wire-level framing、trailers 與 content-type，DX 很差；`protobuf-ts` 雖然內建 `TestTransport`，但偏向單元測試輔助、沒有 `msw` 風格的宣告式 registry API。這讓前端團隊很難在「現有專案馬上可用」與「未來擴展到瀏覽器 network-level mock」之間同時取得好的開發者體驗。本 change 要填補這個空缺，提供一個型別安全、DX 接近 `msw`、以 `RpcTransport` 為核心抽象的 gRPC-Web mock npm library。

## What Changes

- 新增 npm library：以 `MockRpcTransport implements RpcTransport`（transport-first）作為主要核心，直接在 `protobuf-ts` generated client 注入處接管呼叫、完全繞過 wire-level framing，提供零序列化開銷與完整型別安全。
- 提供 `msw` 風格的宣告式 handler registry API：`grpc.unary(Service, 'methodName', resolver)` 與 `grpc.serverStreaming(Service, 'methodName', resolver)`，resolver 直接收到已 decode 的 typed request，回傳純 TypeScript 物件或 `AsyncIterable` 即可。
- 提供可選的 MSW bridge（subpath export `/msw`）：把同一套 registry 轉成 `msw` 的 `http.post()` handlers，重用 `@protobuf-ts/grpcweb-transport` 已公開匯出的 frame helpers，不自行重造 gRPC-Web framing。
- MVP 範圍限定在 gRPC-Web 支援的 RPC 類型：`unary` 與 `serverStreaming`；`clientStreaming` 與 `duplex` 明確拋出 `UNIMPLEMENTED`。
- 預設 wire format 為 `binary`，`text`（base64）作為 MSW bridge 的可選相容模式；MSW 依賴以 v2+ 為基線，以避免 binary body 汙染問題。
- 提供 `passthrough()` 與 `fallbackTransport` 機制，讓未註冊 method 可以 fall through 到真實 `GrpcWebFetchTransport`，支援現有專案漸進導入。
- 提供 `delay`、`headers`、`trailers`、`RpcError` 等 resolver 控制能力，覆蓋 `TestTransport` 現有能力。
- 提供單一 npm package + subpath exports（`.` 只依賴 `@protobuf-ts/runtime-rpc`；`./msw` 才額外依賴 `msw` 與 `@protobuf-ts/grpcweb-transport`），`msw` 以 optional peer dependency 列出，避免 tree-shaking 劣化。
- 提供環境變數驅動的 transport factory 範例與文件，讓現有專案能以最小侵入方式在「mock transport / real transport / MSW bridge」間切換。

## Capabilities

### New Capabilities

- `grpc-mock-transport`: 以 `MockRpcTransport` 為核心的 transport-first mock 能力，包含 handler registry、typed resolver、`unary` / `serverStreaming` 分派、`RpcError` / delay / metadata 傳遞，以及未註冊 method 的 `passthrough` / `fallbackTransport` 行為。這是 library 的主路徑，現有 `protobuf-ts` 專案只需在 client 建構點切換 transport 即可啟用。
- `grpc-msw-bridge`: 將同一套 handler registry 轉成 `msw` HTTP handlers 的可選 bridge 能力，包含 gRPC-Web URL 路由推導、request body decode（binary / text）、response 與 trailer frame encode、以及 server-streaming 的一次性完整 body 與 `ReadableStream` 兩種實作策略。作為 subpath export 發佈，不強制主 entry 使用者安裝 `msw`。
- `grpc-mock-package`: npm package 結構、exports 對應、peer dependency 策略、型別匯出與 SemVer 契約等發佈面能力，確保 library 能被任何 `protobuf-ts` + gRPC-Web 專案直接引入並在現有專案 MVP 階段馬上使用。

### Modified Capabilities

<!-- 本 repo 目前 openspec/specs/ 尚無既有 capability，所有能力皆為新建，無需 delta spec。 -->

## Impact

- **新增 source**：本 repo（目前僅含研究文件與 openspec config）將新增 library 的 `src/`、`package.json`、`tsconfig.json` 與相關建置／測試設定，發佈為單一 npm package 配合 subpath exports。
- **新增相依**：`@protobuf-ts/runtime-rpc`（peer）、`@protobuf-ts/runtime`（peer）；`/msw` 子路徑新增 `msw`（optional peer，v2+）與 `@protobuf-ts/grpcweb-transport`（peer，用於重用 frame helper 與 URL 規則）。主 entry 不帶入 `msw`，確保非 MSW 使用者不會被迫安裝瀏覽器攔截相依。
- **對現有 protobuf-ts 專案的影響**：零程式碼侵入；整合點只在 `new XxxClient(transport)` 的 transport factory，透過環境變數切換 mock / real；未註冊 method 可透過 `fallbackTransport` 回到真實 backend，支援漸進導入。
- **協定相容性**：僅支援 gRPC-Web 能處理的 `unary` 與 `serverStreaming`；`clientStreaming` / `duplex` 回傳 `UNIMPLEMENTED`，與 `GrpcWebFetchTransport` 行為一致，避免 API 強度大於真實 transport 造成的認知落差。
- **文件**：新增 README 與整合範例（Vite 環境變數、transport factory 樣板、可選 MSW 啟動流程），現有 `docs/` 研究資料保留作為設計依據。
- **測試**：新增單元測試（unary / serverStreaming / passthrough / RpcError / delay）與 MSW bridge 的整合測試（binary / text、trailer frame 正確性）。
