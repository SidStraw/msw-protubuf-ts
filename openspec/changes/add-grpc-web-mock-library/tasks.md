## 1. Package Skeleton & Tooling

- [ ] 1.1 初始化 npm package：建立 `package.json`，設定 `"type": "module"`、`name`（以 placeholder 名稱確認後定案）、`version: 0.1.0`、`license`、`description`、`repository`
- [ ] 1.2 設定 `exports` 對應 `"."` 與 `"./msw"` 兩個入口（含 `import` 與 `types` 子條件）
- [ ] 1.3 宣告 `peerDependencies`：`@protobuf-ts/runtime ^2`、`@protobuf-ts/runtime-rpc ^2`、`@protobuf-ts/grpcweb-transport ^2`、`msw ^2`
- [ ] 1.4 以 `peerDependenciesMeta` 將 `msw` 與 `@protobuf-ts/grpcweb-transport` 標記為 optional
- [ ] 1.5 建立 `tsconfig.json`（strict、`ESNext` target、`NodeNext` resolution）與 `tsconfig.build.json`
- [ ] 1.6 選定建置工具（建議 `tsup` 或 `tsc`）並產出 `dist/index.js` + `dist/msw.js` + `.d.ts`
- [ ] 1.7 加入 `vitest` 設定（或既有測試框架）、`.editorconfig`、`.gitignore`、`README.md` 佔位
- [ ] 1.8 設定 lint（ESLint 或 Biome）與 `npm scripts`（`build`、`test`、`lint`、`typecheck`）

## 2. Core Types & Registry

- [ ] 2.1 定義公開型別：`GrpcMockContext<I>`、`UnaryResolver<I,O>`、`ServerStreamResolver<I,O>`、`MockHandler`、`GrpcMockRegistry`
- [ ] 2.2 實作 `createGrpcMockRegistry()`：以 `${ServiceInfo.typeName}/${MethodInfo.name}` 為 key 的 `Map<string, MockMethodRegistration>`
- [ ] 2.3 實作 `grpc.unary(Service, methodLocalName, resolver)` 註冊：以 `methods.find(m => m.localName === name)` 解析 method，unknown 名稱與型別不符一律丟錯
- [ ] 2.4 實作 `grpc.serverStreaming(Service, methodLocalName, resolver)` 註冊：拒絕 `serverStreaming !== true` 的 method
- [ ] 2.5 實作 `grpc.error(code, message, meta?)` helper，回傳 `RpcError` 實例
- [ ] 2.6 實作 `grpc.reply(body, options?)` helper，用來同時攜帶 `headers` / `trailers` / `delay`
- [ ] 2.7 撰寫 registry 單元測試：正向註冊、重複註冊覆寫、unknown method 錯誤、streaming/unary 型別不符錯誤

## 3. MockRpcTransport (Core)

- [ ] 3.1 實作 `MockRpcTransport implements RpcTransport`，`mergeOptions` 委派至 `mergeRpcOptions`
- [ ] 3.2 實作 `unary()`：以 `Deferred` 組出 `UnaryCall`，按 handler resolver 結果解析 / reject
- [ ] 3.3 在 unary path 中套用 `delay`、`headers`、`trailers`、`RpcError` 傳遞
- [ ] 3.4 實作 `serverStreaming()`：以 `RpcOutputStreamController` 管理輸出流
- [ ] 3.5 讓 server-streaming resolver 支援三種回傳：陣列 / `Iterable` / `AsyncIterable`，以及 `ctx.stream.send/complete/error` 三個 imperative API
- [ ] 3.6 在兩個 call 類型中都檢查並轉發 `RpcOptions.meta` 進入 resolver `ctx.meta`
- [ ] 3.7 在兩個 call 類型中都接線 `options.abort` → `ctx.signal`；abort 時以 `RpcError('CANCELLED', ...)` 終止
- [ ] 3.8 實作 `clientStreaming()` / `duplex()` 直接丟 `RpcError('UNIMPLEMENTED', ...)`，錯誤訊息明示 gRPC-Web 限制
- [ ] 3.9 單元測試：unary 成功 / 錯誤 / delay / headers & trailers / meta 轉發 / abort
- [ ] 3.10 單元測試：server streaming 三種 resolver 形式 / 錯誤中斷 / abort

## 4. Dispatcher: createGrpcMockTransport + Fallback

- [ ] 4.1 實作 `createGrpcMockTransport({registry, fallbackTransport?, onUnhandledRequest?})` 回傳 `RpcTransport`
- [ ] 4.2 未註冊 method：若有 `fallbackTransport`，以相同 `(method, input, options)` 委派
- [ ] 4.3 未註冊且無 fallback：按 `onUnhandledRequest`（預設 `'error'`）拋 `RpcError('UNIMPLEMENTED', ...)`；`'warn'` 先 log 再拋
- [ ] 4.4 實作 `ctx.passthrough()`：在 resolver 中明確請求 delegate 至 fallback（無 fallback 時與 default 一致）
- [ ] 4.5 單元測試：fallback 成功路徑、fallback 失敗路徑、`onUnhandledRequest` 各模式、resolver 內 `passthrough()` 行為

## 5. MSW Bridge (Subpath `/msw`)

- [ ] 5.1 在 `src/msw/index.ts` 建立 `createGrpcMswHandlers(registry, options)` 的入口
- [ ] 5.2 依 `ServiceInfo.typeName` + `MethodInfo.name` 產生路徑；支援 `options.baseUrl` 與無 baseUrl 的 `*/path` 萬用匹配
- [ ] 5.3 驗證 request `Content-Type` 需以 `application/grpc-web` 開頭；`text` 模式接受 `application/grpc-web-text`；不符回 HTTP 415
- [ ] 5.4 Request 解碼：讀取 `arrayBuffer()`，`text` 模式先 base64 解碼，再去掉 5-byte frame header，呼叫 `method.I.fromBinary()`
- [ ] 5.5 Response 編碼（unary）：使用 `@protobuf-ts/grpcweb-transport` 公開 helpers 組 DATA frame + TRAILER frame（`grpc-status:0`）
- [ ] 5.6 Response 編碼（server streaming v1）：將所有 resolver 輸出 messages 組成多個 DATA frame + 一個 TRAILER frame，一次回傳
- [ ] 5.7 Error 路徑：resolver 丟 `RpcError` 時只回 TRAILER frame（含 `grpc-status` 數字碼與 `grpc-message`）
- [ ] 5.8 Text 模式：對最終 body 做 base64 編碼並設 `Content-Type: application/grpc-web-text`
- [ ] 5.9 確認未註冊 URL **不**產生 MSW handler，交給 MSW 的 `onUnhandledRequest` 處理
- [ ] 5.10 MSW bridge 單元測試：binary unary 成功 / 錯誤 / text 模式 / server streaming 多 frame
- [ ] 5.11 Bridge 與真實 `GrpcWebFetchTransport` 整合測試：以 MSW `setupServer` 啟動，建立 generated client 走 MSW bridge，assert 與 transport-mode 結果等價

## 6. Shared Integration Tests (Registry parity)

- [ ] 6.1 建立「同一 registry 雙路徑」整合測試：同時透過 `createGrpcMockTransport` 與 `createGrpcMswHandlers` 執行相同呼叫，assert 解碼後物件等價
- [ ] 6.2 測試 `fallbackTransport` 在 transport-mode 下的 pass-through 路徑
- [ ] 6.3 測試 server-streaming 在兩個路徑下都能正確結束並送出 trailers

## 7. Documentation & Examples

- [ ] 7.1 撰寫 README：功能摘要、MVP 範圍（支援 / 不支援）、與 `TestTransport` 的差異
- [ ] 7.2 README 加入快速上手：`createGrpcMockRegistry` + `grpc.unary` + `createGrpcMockTransport` 範例
- [ ] 7.3 README 加入環境變數 transport factory 範例（Vite `VITE_ENABLE_API_MOCK`）與動態 import 的 tree-shaking 注意事項
- [ ] 7.4 README 加入 `/msw` 入口範例：`setupWorker(...createGrpcMswHandlers(registry, {baseUrl, format: 'binary'}))`
- [ ] 7.5 於 README 註明 `msw >= 2` 要求、`binary` 為預設、`text` 為實驗性
- [ ] 7.6 API reference（可由 tsdoc + 產生）：列出所有公開匯出與型別

## 8. Release Readiness

- [ ] 8.1 CHANGELOG 初版：標示 MVP 內容與已知 non-goals（`clientStreaming` / `duplex` UNIMPLEMENTED）
- [ ] 8.2 驗證 `npm pack` 輸出內容：僅含 `dist/`、`README.md`、`CHANGELOG.md`、`package.json`；無 `src/` 原始碼與測試檔
- [ ] 8.3 本地模擬安裝：在暫時專案以 `npm install ./<tarball>` 驗證 `.` 與 `./msw` 兩個入口都能 import 且型別正確
- [ ] 8.4 以使用者現有 `protobuf-ts` 專案做一個 service 的 pilot 導入，確認 transport factory + env 切換可行後再規劃正式發佈版本號
- [ ] 8.5 最終決策：package 名稱與 scope、env var 命名、是否同時提供 CJS build，於發佈前與專案擁有者確認

## 9. Validation

- [ ] 9.1 `openspec validate add-grpc-web-mock-library` 通過
- [ ] 9.2 所有公開 API 有對應單元測試並覆蓋 spec 中每個 scenario
- [ ] 9.3 `npm run build` / `npm test` / `npm run lint` / `npm run typecheck` 全綠
