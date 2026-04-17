## Context

使用者的現況：proto 專案以 `protobuf-ts` 打包出 request 型別與 generated client，前端直接引入打包後的檔案，再以 `GrpcWebFetchTransport` 與後端溝通。現階段缺少一個可重複使用的 mock 方案：

- `msw` 官方沒有 gRPC 一級支援；maintainer 在 issue #238 明確表示「可以用，但要自己處理 framing」。
- 社群文章（Lucas Levin）雖證明 `msw` 能 mock gRPC-Web，但必須自行拼 `/package.Service/Method` URL、處理 5-byte data frame、trailer frame、以及 `application/grpc-web(+proto|-text)` header，無型別安全。
- `protobuf-ts` 已提供 `TestTransport`，但偏向測試輔助、非 `msw` 風格宣告式 registry。
- 沒有社群 npm package 同時覆蓋「protobuf-ts 型別系統 + MSW 風格 API + gRPC-Web」。

本 library 的使用者是「現有使用 `protobuf-ts` + gRPC-Web 的前端專案」，MVP 成功條件是這些專案能以最小改動（只改 transport factory）立即啟用 mock，並保有型別安全。

關鍵技術事實（皆已在研究文件中驗證）：

- `protobuf-ts` generated client 僅依賴 `RpcTransport` interface；constructor 只接收 transport，其餘走 `stackIntercept()`。替換 transport 等於替換整個通訊層，不侵入呼叫端。
- `MethodInfo` 帶 `service`、`name`、`localName`、`I`、`O`、`serverStreaming`、`clientStreaming`，`I` 與 `O` 是 `IMessageType<T>`，有 `fromBinary` / `toBinary` / `create` / `is`。
- `@protobuf-ts/grpcweb-transport` 已 public export `createGrpcWebRequestBody`、`createGrpcWebRequestHeader`、`readGrpcWebResponseBody`、`readGrpcWebResponseHeader`、`readGrpcWebResponseTrailer`、`GrpcWebFrame`，MSW bridge 可直接重用。
- `GrpcWebFetchTransport` 本身不支援 `clientStreaming` / `duplex`；gRPC-Web 協定 `PROTOCOL-WEB.md` 也明確指出 bidi-streaming 待瀏覽器 fetch/streams 支援。
- `msw` 2.x 已修復 binary request body 汙染問題（issue #1442），是我們的依賴基線。

## Goals / Non-Goals

**Goals:**

- 提供一個 npm library，讓 `protobuf-ts` + gRPC-Web 的前端專案只改 transport factory 即可啟用型別安全的 mock。
- 核心 API 貼近 `msw` 的 DX：以 service + method 名稱為核心註冊、resolver 直接收到 decoded typed request、回傳純 TS 物件或錯誤。
- MVP 階段覆蓋 gRPC-Web 所能支援的全部 RPC 類型（`unary`、`serverStreaming`），並支援 `passthrough`、`delay`、`headers`、`trailers`、`RpcError`。
- 透過 `fallbackTransport` 支援漸進導入：未註冊 method 可導到真實後端。
- 提供可選 MSW bridge（subpath export），在需要 Network panel 可觀察性時啟用；不使用 MSW 的專案不應被迫安裝 `msw`。
- MSW bridge 重用 `@protobuf-ts/grpcweb-transport` 已公開的 frame helpers，避免自行維護 gRPC-Web framing。

**Non-Goals:**

- **不**支援 `clientStreaming` 與 `duplex`：超出 gRPC-Web 協定範圍，會造成「mock 比真實 transport 強」的認知落差。MVP 階段此二方法明確拋 `UNIMPLEMENTED`。
- **不**取代 `protobuf-ts` 官方的 `TestTransport`：`TestTransport` 適合單元測試場景；本 library 定位是 app-level mock（開發期、整合測試、E2E）。
- **不**支援 ConnectRPC / Twirp：MVP 僅聚焦 protobuf-ts 的 gRPC-Web 實作；未來可重用 core registry，但不在此次範圍。
- **不**提供自動從 `.proto` 產生 mock 資料（faker 整合）：列入 future phase。
- **不**自行實作新的 gRPC-Web framing：一律重用 `@protobuf-ts/grpcweb-transport` 公開 helpers。
- **不**相容 `msw` v1：只支援 v2+。

## Decisions

### 1. 以「Mock RpcTransport」為核心，MSW bridge 為可選第二層

**決策**：library 主路徑是 `MockRpcTransport implements RpcTransport`（transport-first），MSW bridge 作為可選 subpath export。

**理由**：

- 使用者現況是「前端直接引入打包 client」，整合點天然就在 `new XxxClient(transport)` 的 transport；替換 transport 是對應用程式碼最小侵入的方式。
- Transport 層 mock 跳過所有 gRPC-Web framing、base64、protobuf 編解碼，直接在 TS 物件層運作，效能與型別安全都最佳。
- Server streaming 在 transport 層有 `RpcOutputStreamController` 原生支援；在 MSW 層模擬 chunked streaming 則相對複雜。
- 仍保留 MSW bridge 的原因：部分團隊希望在 DevTools Network panel 看到「像真實 gRPC-Web request 一樣」的流量；這是 transport mode 無法提供的。

**替代方案**：

- *只做 MSW handler*：DX 需要自行 decode / encode frame、trailer，維護成本偏高，且 server-streaming 體驗差。
- *只做 transport mock*：無 network-level 可視化、不能與既有 MSW handlers 共存。

**本次取捨優先權**：以主提案（`msw-mock-protobuf-ts-grpc-web-mock-lib-npm-lib-moc.md`）為準，採用「transport-first + optional MSW bridge」的雙層架構；這也與第二份研究（`...-moc-1.md`）推薦的「方案三（混合架構）」一致。

### 2. Handler 以 `(Service, methodLocalName, resolver)` 註冊，不以 URL 註冊

**決策**：對外 API 是 `grpc.unary(Service, 'methodLocalName', resolver)`，不是 `grpc.unary('/pkg.Service/Method', resolver)`。

**理由**：

- `ServiceInfo.typeName` 與 `MethodInfo.name` / `localName` 已經在 reflection 裡，使用者不必手記 wire-level URL。
- `localName`（camelCase）讓使用者寫法與 generated client 呼叫一致（`client.sayHello(...)` ↔ `grpc.unary(Service, 'sayHello', ...)`）。
- 內部一律以 `typeName + method.name` 作為 registry key（`"my.pkg.Service/Method"`），避免大小寫歧義。

### 3. Resolver 收到已 decode 的 typed request，不是 `Request`

**決策**：resolver 簽名為 `(ctx: { request: I; method: MethodInfo; meta: RpcMetadata; signal?: AbortSignal; passthrough(): Promise<never> }) => O | Promise<O> | AsyncIterable<O> | Iterable<O>`。

**理由**：

- 使用者真正想操作的是 protobuf message 物件，不是 `ArrayBuffer` 或 `Request`。
- 同時暴露 `method` 讓進階用法（共用 resolver、動態分派）成為可能。
- `passthrough()` 明確做為 resolver 內的控制流，呼應 `msw` 的 `ctx.passthrough()` 心智模型。

### 4. 預設 wire format 為 `binary`，`text` 只在 MSW bridge 作為相容選項

**決策**：MSW bridge `options.format` 預設為 `'binary'`，可選 `'text'`（base64）。Transport mode 完全不涉及 wire format。

**理由**：

- `GrpcWebFetchTransport` 官方 browser example 用 `binary`；`binary` 不需要 base64 chunking 處理。
- `text` 模式的 chunk 邊界與 frame 邊界不一定對齊（spec 明言），實作負擔較高，但仍有專案後端要求它作為相容層。

### 5. 未註冊 method 的行為：`fallbackTransport` 優先，其次 `onUnhandledRequest`

**決策**：`createMockTransport({ registry, fallbackTransport?, onUnhandledRequest?: 'error' | 'warn' | 'bypass' })`。

- 若提供 `fallbackTransport`，未註冊 method 導到 fallback（支援漸進導入）。
- 否則依 `onUnhandledRequest`：`'error'`（預設）丟 `RpcError('UNIMPLEMENTED', ...)`、`'warn'` 記 log 後丟 error、`'bypass'` 不支援（因為沒有 fallback）。

**理由**：呼應 `msw` 對 unhandled request 的處理哲學，同時讓大型專案能一方法一方法地逐步切 mock。

### 6. Package 形態：單一 npm package + subpath exports

**決策**：發佈一個 package（暫名 `grpc-web-mock` / `@your-scope/protobuf-ts-grpc-mock`），包含兩個入口：

- `.`：核心，僅依賴 `@protobuf-ts/runtime-rpc` + `@protobuf-ts/runtime`。
- `./msw`：MSW bridge，額外依賴 `msw`（optional peer）與 `@protobuf-ts/grpcweb-transport`。

`package.json`：

- `"type": "module"`；ESM 為主，必要時提供 CJS fallback（build 時決定）。
- `peerDependencies` 宣告 `@protobuf-ts/runtime-rpc ^2`、`@protobuf-ts/runtime ^2`；`msw ^2` 與 `@protobuf-ts/grpcweb-transport ^2` 只在 `/msw` 入口使用，以 `peerDependenciesMeta.optional` 標記。

**理由**：讓純 transport-mode 使用者不會被 `msw` 拖進 browser Service Worker 相依；同時仍維持「一個 library」心理模型，避免多 package 維護負擔。

### 7. 型別推導策略：MVP 以 `MethodInfo` 反射 + 泛型推導為主

**決策**：API 型別上以 `S extends ServiceInfo` + `N extends string` 作為入口，使用 `Extract<S['methods'][number], { localName: N }>` 抽出 `MethodInfo<I, O>`，再推導 resolver 的 input/output。若 `protobuf-ts` generated `ServiceType` 的 `methods` 失去細粒度型別（僅 `PartialMethodInfo[]`），提供第二條手動泛型路徑 `grpc.unary<Req, Res>(Service, 'methodName', resolver)` 作為 fallback，不阻塞 MVP。

**理由**：

- 首選路徑貼近 ConnectRPC `createRouterTransport` 的 DX。
- 次要路徑確保即使 generated code 型別不夠強，使用者仍可手動標注而不會卡住 MVP。
- 未來 Phase 3 可評估是否提供 `protobuf-ts` plugin 或 codemod，產生更強型別 map。

### 8. MSW bridge 的 server-streaming 先做「一次性完整 body」

**決策**：bridge v1 把所有 stream messages 組成一個完整 `Uint8Array`（data frames + trailer frame）後以 `HttpResponse.arrayBuffer()` 一次回；bridge v2 再升級成 `ReadableStream<Uint8Array>` 以支援漸進式送 frame（支援 delay）。

**理由**：一次性 body 已能涵蓋絕大部分 UI 測試需求且 wire format 仍正確；`ReadableStream` 升級留到 Phase 3 以免 MVP 時程被拖。

### 9. 以現有研究文件的 API 草圖為 MVP API 形狀，命名後續可調整

**決策**：對外命名暫定 `createGrpcMockRegistry()`、`createGrpcMockTransport()`、`createGrpcMswHandlers()`、`grpc.unary()`、`grpc.serverStreaming()`、`grpc.error(code, message)`。實際 package 名稱、scope、env var 名稱（例 `VITE_ENABLE_API_MOCK`）在 Phase 1 末尾與使用者確認後定案。

**理由**：這屬於「低信心」產品命名，兩份研究都標注為需實際專案驗證；先以文件草圖推進、不阻塞實作。

## Risks / Trade-offs

- **[Risk] protobuf-ts generated `ServiceType.methods` 的 TS 型別不夠強，無法從 method name 自動推導 I/O** → Mitigation：保留顯式泛型 `grpc.unary<Req, Res>(...)` 作為第二路徑；在 README 文件清楚標示；Phase 3 再評估 codegen plugin。
- **[Risk] 使用者專案仍停留在 `msw` v1 或沒有 Service Worker 設定** → Mitigation：主路徑（transport mode）完全不依賴 `msw`；文件明確要求 `msw` v2+ 才能使用 `/msw` 入口。
- **[Risk] MSW bridge 的 `grpc-web-text`（base64）實作與 stream chunk 邊界問題** → Mitigation：MVP 預設只支援 `binary`；`text` 做為可選旗標，文件註明限制，實際採 spec（`PROTOCOL-WEB.md`）指明的 chunk 行為。
- **[Risk] Server streaming resolver 回傳 `AsyncIterable` 可能與 `AbortSignal` 組合不正確（記憶體洩漏、未 notifyComplete）** → Mitigation：library 內統一以 `RpcOutputStreamController` 收斂；在 resolver 迴圈中定期檢查 `signal.aborted`，unit test 覆蓋 abort 路徑。
- **[Risk] 未註冊 method 的預設行為會影響既有專案行為** → Mitigation：預設 `onUnhandledRequest: 'error'`，迫使開發者顯式決定；同時提供 `fallbackTransport` 的漸進導入路徑。
- **[Trade-off] Transport mode 不經過真實 fetch → DevTools Network panel 看不到流量** → 這是 transport-first 必然取捨；要可觀察性就切到 MSW bridge。
- **[Trade-off] MVP 先做一次性 streaming body、不支援 true chunked streaming** → 對 UI 測試已足夠；true streaming 放 Phase 3。

## Migration Plan

本 change 是新 library 的建立，repo 目前尚無執行中的 library 版本，因此「migration」主要指「使用者專案如何導入」：

1. **Phase 0（本 repo 內）**：建立 package skeleton（`package.json`、`tsconfig`、build、test），先讓 `openspec validate` 與 CI 通過。
2. **Phase 1：核心 transport + registry**：實作 `MockRpcTransport`、`createGrpcMockRegistry`、`grpc.unary`、`grpc.serverStreaming`、`grpc.error`、`passthrough` / `fallbackTransport`、`delay`、`headers` / `trailers` 支援。單元測試覆蓋 unary / server streaming / error / unhandled。
3. **Phase 2：MSW bridge**：實作 `createGrpcMswHandlers`，binary 模式先上；整合測試驗證 `GrpcWebFetchTransport` → MSW → bridge → registry → resolver 完整迴圈。
4. **Phase 3：DX / streaming 升級**：`ReadableStream` 版本 streaming、`text` 模式、型別推導強化、可選 codegen plugin、Vitest / Jest helper。
5. **發佈與專案整合文件**：提供 Vite 環境變數樣板（`VITE_ENABLE_API_MOCK`）、transport factory 樣板；先在使用者現有專案做 pilot 驗證一個 service，確認 DX 可接受後再全面導入。
6. **Rollback 策略**：因為 library 接入點僅在 transport factory，rollback 只需把 factory 切回 `GrpcWebFetchTransport` 即可；不影響呼叫端程式碼。

## Open Questions

- 最終 npm package 名稱與 scope？（例：`@{your-scope}/protobuf-ts-grpc-mock` vs `grpc-web-mock`）
- 預設環境變數命名是否採 `VITE_ENABLE_API_MOCK`？是否需要支援 `process.env.*` 與 `import.meta.env.*` 兩種讀取方式的工具函式？
- 是否需要同時提供 CJS 建置，還是純 ESM？取決於使用者既有專案 bundler 是否全面支援 ESM-only 套件。
- Phase 3 是否值得維護一個 `protobuf-ts` codegen plugin 來產出更強的 method-name → I/O 型別 map，還是以手動泛型 + 文件就足夠？
- `grpc.serverStreaming` 的 resolver 對外形狀：要支援 `Iterable<O>` / `AsyncIterable<O>` / context.send / resolver return array 哪幾種？（傾向三種都支援，文件標示推薦用法）
