## 1. Package Skeleton & Tooling

- [x] 1.1 初始化 npm package：建立 `package.json`，設定 `"type": "module"`、`name`（以 placeholder 名稱確認後定案）、`version: 0.1.0`、`license`、`description`、`repository`
- [x] 1.2 設定 `exports` 只對應單一入口 `"."`（含 `import` 與 `types` 子條件）；**不**建立 `"./msw"` 入口
- [x] 1.3 宣告 `peerDependencies`：僅 `@protobuf-ts/runtime ^2`、`@protobuf-ts/runtime-rpc ^2`。**不**宣告 `msw`、**不**宣告 `@protobuf-ts/grpcweb-transport`
- [x] 1.4 確認 `dependencies` 與 `devDependencies` 皆不含 `msw`；在 CI / lint 階段加入一個檢查，若 `src/` 任一檔出現 `from 'msw'` 就報錯
- [x] 1.5 建立 `tsconfig.json`（strict、`ESNext` target、`NodeNext` resolution）與 `tsconfig.build.json`
- [x] 1.6 選定建置工具（建議 `tsdown` 或 `tsc`）並產出 `dist/index.js` + `.d.ts`
- [x] 1.7 加入 `vitest` 設定、`.editorconfig`、`.gitignore`、`README.md` 佔位
- [x] 1.8 設定 lint（ESLint 或 Biome）與 `npm scripts`（`build`、`test`、`lint`、`typecheck`）

## 2. Core Types & Registry

- [x] 2.1 定義公開型別：`GrpcMockContext<I, O>`、`UnaryResolver<I,O>`、`ServerStreamResolver<I,O>`、`MockHandler`、`GrpcMockRegistry`、`StreamController<O>`
- [x] 2.2 實作 `createGrpcMockRegistry()`：以 `${ServiceInfo.typeName}/${MethodInfo.name}` 為 key 的 `Map<string, MockMethodRegistration>`
- [x] 2.3 實作 `grpc.unary(Service, methodLocalName, resolver)` 註冊：以 `methods.find(m => m.localName === name)` 解析 method，unknown 名稱與型別不符一律丟錯
- [x] 2.4 實作 `grpc.serverStreaming(Service, methodLocalName, resolver)` 註冊：拒絕 `serverStreaming !== true` 的 method
- [x] 2.5 實作 `grpc.error(code, message, meta?)` helper，回傳 `RpcError` 實例
- [x] 2.6 實作 `grpc.reply(body, options?)` helper，用來同時攜帶 `headers` / `trailers` / `delay`
- [x] 2.7 撰寫 registry 單元測試：正向註冊、重複註冊覆寫、unknown method 錯誤、streaming/unary 型別不符錯誤

## 3. MockRpcTransport (Core)

- [x] 3.1 實作 `MockRpcTransport implements RpcTransport`，`mergeOptions` 委派至 `mergeRpcOptions`
- [x] 3.2 實作 `unary()`：以 `protobuf-ts` 公開的 `UnaryCall` + `Deferred` 組出 call object（包含 `method`、`requestHeaders`、`request`、`headers`、`response`、`status`、`trailers`），按 handler resolver 結果解析 / reject
- [x] 3.3 在 unary path 中套用 `delay`、`headers`、`trailers`、`RpcError` 傳遞，確保 `headers` / `trailers` / `status` promise 在正確時序解析
- [x] 3.4 實作 `serverStreaming()`：以 `RpcOutputStreamController` 管理輸出流，組出合法的 `ServerStreamingCall`
- [x] 3.5 讓 server-streaming resolver 支援三種回傳：陣列 / `Iterable` / `AsyncIterable`，以及 `ctx.stream.send/complete/error` 三個 imperative API
- [x] 3.6 在兩個 call 類型中都檢查並轉發 `RpcOptions.meta` 進入 resolver `ctx.meta`，且不 mutate 原始 meta
- [x] 3.7 在兩個 call 類型中都接線 `options.abort` → `ctx.signal`；abort 時以 `RpcError('CANCELLED', ...)` 終止對應 promise / stream
- [x] 3.8 實作 `clientStreaming()` / `duplex()` 直接丟 `RpcError('UNIMPLEMENTED', ...)`，錯誤訊息明示 gRPC-Web 限制
- [x] 3.9 單元測試：unary 成功 / 錯誤 / delay / headers & trailers / meta 轉發 / abort
- [x] 3.10 單元測試：server streaming 三種 resolver 形式 / 錯誤中斷 / abort

## 4. Dispatcher: createGrpcMockTransport + Fallback

- [x] 4.1 實作 `createGrpcMockTransport({registry, fallbackTransport?, onUnhandledRequest?})` 回傳 `RpcTransport`
- [x] 4.2 未註冊 method：若有 `fallbackTransport`，以相同 `(method, input, options)` 委派
- [x] 4.3 未註冊且無 fallback：按 `onUnhandledRequest`（預設 `'error'`）拋 `RpcError('UNIMPLEMENTED', ...)`；`'warn'` 先 log 再拋
- [x] 4.4 實作 `ctx.passthrough()`：在 resolver 中明確請求 delegate 至 fallback（無 fallback 時與 default 一致）
- [x] 4.5 單元測試：fallback 成功路徑、fallback 失敗路徑、`onUnhandledRequest` 各模式、resolver 內 `passthrough()` 行為

## 5. RpcInterceptor Parity（與既有 DevTools 管線相容）

- [x] 5.1 為測試建立一個 spy interceptor，記錄 `interceptUnary` / `interceptServerStreaming` 被呼叫的次數、時序與拿到的 `method` / `input` / `options` / `call`
- [x] 5.2 以 `docs/devtool.ts` 的 `devtoolsInterceptor`（或等價 mock of `window.postMessage`）驗證 unary 路徑：建立 call → `then` resolve 後 → 送出兩則訊息（response、EOF），事件順序與真實 transport 一致
- [x] 5.3 驗證 unary error 路徑：`then` 的 reject handler 被呼叫、`responseMessage` 帶有 `name` / `code` / `message`、`errorMetadata` 對應 `RpcError.meta`
- [x] 5.4 驗證 server streaming 路徑：`responses.onMessage` 依序收到 resolver emit 的訊息、最後觸發 `onComplete`；mid-stream error 時觸發 `onError`
- [x] 5.5 驗證 abort 路徑：interceptor 看到的 call 在 abort 後以 `CANCELLED` error 結束，且不會多送出 `EOF` 或 complete 事件
- [x] 5.6 在 README 附上「mock transport + 既有 devtoolsInterceptor」的整合範例，明確說明 library 不 import `window` 或 DevTools 程式碼

## 6. Documentation & Examples

- [x] 6.1 撰寫 README：功能摘要、MVP 範圍（支援 / 不支援）、與 `TestTransport` 的差異、為何不含 `msw`
- [x] 6.2 README 加入快速上手：`createGrpcMockRegistry` + `grpc.unary` + `createGrpcMockTransport` 範例
- [x] 6.3 README 加入環境變數 transport factory 範例（Vite `VITE_ENABLE_API_MOCK`）與動態 import 的 tree-shaking 注意事項
- [x] 6.4 README 加入「如何與現有 `RpcInterceptor` 一起使用」小節，示範把 `devtoolsInterceptor` 傳進 `RpcOptions.interceptors`，mock / real transport 行為一致
- [x] 6.5 於 README 明確標示：本 library 不提供 MSW bridge；若未來要加，會是獨立 change
- [x] 6.6 API reference（可由 tsdoc 產生）：列出所有公開匯出與型別

## 7. Release Readiness

- [x] 7.1 CHANGELOG 初版：標示 MVP 內容與已知 non-goals（`clientStreaming` / `duplex` UNIMPLEMENTED；無 MSW bridge）
- [x] 7.2 驗證 `npm pack` 輸出內容：僅含 `dist/`、`README.md`、`CHANGELOG.md`、`package.json`；無 `src/` 原始碼與測試檔；`dist/` 內無 `msw` 相關字串
- [x] 7.3 本地模擬安裝：在暫時專案以 `npm install ./<tarball>` 驗證單一入口能 import 且型別正確，且在未安裝 `msw` 的專案中也能順利解析
- [x] 7.4 以使用者現有 `protobuf-ts` 專案做一個 service 的 pilot 導入，驗證：（a）transport factory + env 切換、（b）既有 DevTools interceptor 在 mock 模式下仍能正確顯示
- [x] 7.5 最終決策：package 名稱與 scope、env var 命名、是否同時提供 CJS build，於發佈前與專案擁有者確認

## 8. Validation

- [x] 8.1 `openspec validate add-grpc-web-mock-library` 通過
- [x] 8.2 所有公開 API 有對應單元測試並覆蓋 spec 中每個 scenario
- [x] 8.3 `pnpm build` / `pnpm test` / `pnpm lint` / `pnpm typecheck` 全綠
- [x] 8.4 grep 檢查：整個 repo 的 `src/` 與 `package.json` 皆不含 `msw` 字串（註解與 README 說明除外）
