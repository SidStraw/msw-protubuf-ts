## Context

`grpc-web-mock` 目前已提供 transport-first mock library、測試 fixture 與 README 範例，但缺少一個能從 `.proto` 開始、經過 `protobuf-ts` codegen、再由 Vite + React UI 實際呼叫 generated client 的可執行範例。既有測試中的 `tests/fixtures/service.ts` 是手寫 service fixture，適合單元測試，但不適合展示使用者實際導入時會看到的檔案結構與開發流程。

這個 playground 應視為 consumer package，而不是 library source 的一部分。它要驗證與展示 library 對外使用方式，同時避免影響 npm package 發佈內容與主 entry 的相依性契約。

## Goals / Non-Goals

**Goals:**

- 以 pnpm workspace 建立 `playground` package，隔離 React/Vite/codegen 相關 devDependencies。
- 提供 playground 專用 `.proto` 與 `protobuf-ts` codegen script，讓使用者能理解從 proto 到 generated client 的完整路徑。
- 使用 Vite + React 建立小型 UI，展示 unary、server-streaming、error、metadata 與 delay 等 mock 效果。
- 從 repo 根目錄提供一致 scripts，讓維護者可執行 codegen、dev server 與 production build。
- 確保 playground 不會被打包進 library 的 npm tarball，且不改變主 package 的 runtime/peer dependency 範圍。

**Non-Goals:**

- 不提供真實 gRPC-Web backend 或 network-level MSW bridge。
- 不改變 `grpc-web-mock` 的公開 API、`exports` 或 peer dependency 契約。
- 不把 playground helper 視為核心 library 的穩定公開 API；它是 consumer DX 探索範例。
- 不把 playground 作為正式文件網站或 Storybook。
- 不支援 client streaming 或 duplex 示範，因為 library MVP 已明確不支援這兩種 gRPC-Web 模式。

## Decisions

### 1. `playground` 作為 pnpm workspace package

採用 `pnpm-workspace.yaml` 將 root package 與 `playground` 納入 workspace。`playground/package.json` 會管理 React、Vite、`@vitejs/plugin-react`、`@protobuf-ts/plugin`、`@protobuf-ts/protoc` 等範例專用相依性。

替代方案是把所有 playground deps 放在 root `devDependencies`，但這會讓 library package 本體看起來直接依賴 React/Vite，降低發佈契約的清晰度。workspace package 更接近真實 consumer，也能用 `workspace:*` 連到本 repo 的 library。

### 2. playground 自帶 `.proto` 與 generated output

新增 `playground/proto/greeter.proto`，至少包含 unary 與 server-streaming RPC，例如 `SayHello`、`WatchGreetings`，並額外保留可展示 error 或 metadata 的 request 欄位。codegen 輸出到 `playground/src/gen/`，讓 playground source 可直接 import generated `ServiceInfo` 與 client。

generated output 應提交進 repo，確保 clone 後不一定要先安裝 protoc 才能閱讀與建置；同時提供 `playground:gen` script 讓維護者可在 proto 變更後重新產生。

### 3. UI 聚焦展示 library 行為

React UI 應保持小型且明確：一個 unary 表單、一個 server-streaming 示範區、一個 error 示範按鈕，以及一個 metadata/delay 狀態顯示。mock handlers 放在 `playground/src/mocks/`，transport factory 放在 `playground/src/transport.ts`，讓使用者可以快速對照 README 的整合方式。

不導入 routing、state management 或 UI component library，避免範例焦點偏離 `protobuf-ts` 與 `grpc-web-mock`。

### 4. Root scripts 作為主要入口

root `package.json` 應新增：

- `playground:gen`
- `playground:dev`
- `playground:build`
- 視需要新增 `playground:typecheck`

這些 script 透過 pnpm workspace filter 執行，讓維護者不需要切換目錄。既有 `build`、`test`、`lint`、`typecheck` 不應被改成隱式包含 playground，除非任務明確要求；playground build 應由獨立 script 驗證。

### 5. MSW-like helper 先放在 playground

新增 `playground/src/mocks/define-grpc-mock.ts`，提供薄封裝：

- `defineUnaryMock(...)`：接受 `ServiceInfo`、method `localName` 與 resolver 或靜態 response，回傳 `MockHandler`，讓 mock 設定可組成宣告式 handler 陣列。
- `createGrpcMockSession(initialState)`：建立目前 playground session 內的 mutable state 容器，提供 `getState()`、`update()` 與 `reset()`。
- `defineSessionUnaryMock(...)`：將 session 注入 resolver context，示範 mutation-like handler 更新 state、query-like handler 讀取 state。

這一層不放進核心 library，理由是 session shape、reset semantics、是否支援 persistence 與是否要模仿 GraphQL document-style API 都屬於 DX 探索。核心 `grpc-web-mock` 已經提供 method-level registry 與 fallback 能力，playground helper 應先驗證實際使用手感，再決定未來是否正式化。

### 6. Session state demo 採 query/mutation-like unary

擴充 `greeter.proto`，新增類 GraphQL query/mutation 的 unary RPC：

- `ListTags(ListTagsRequest) returns (ListTagsResponse)`
- `AddTagToArticle(AddTagToArticleRequest) returns (AddTagToArticleResponse)`

mock session 會保存 article tags。`ListTags` 回傳目前 session tag snapshot；`AddTagToArticle` 會新增 tag 並回傳更新後的 article 狀態。React UI 提供 Query、Mutation 與 Reset 按鈕，讓使用者看到「mutation 後 query 回傳值在同一 session 更新」的效果。

## Risks / Trade-offs

- **Risk: playground deps 讓 repo 安裝變重** → 透過 workspace package 隔離，並避免把 React/Vite 放進 library runtime dependencies。
- **Risk: generated code 與 `.proto` 不一致** → 提供 `playground:gen`，並在 tasks 中加入重新產生與 build 驗證。
- **Risk: playground 誤進 npm tarball** → 維持 root `files` 白名單，只包含 `dist`、`README.md`、`CHANGELOG.md`，並在驗證中檢查 pack 內容。
- **Risk: 範例暗示支援真實 backend 或 MSW** → UI 與文件明確標示這是 transport-level mock playground，不提供 MSW bridge 或真實 gRPC-Web server。
- **Risk: playground helper 被誤認為核心 API** → 檔案放在 `playground/src/mocks/`，README 明確標示這是範例層 helper，未從 package `exports` 匯出。
- **Risk: HMR 或 StrictMode 造成 session state 重置** → session 建立於 mock module scope，並提供顯式 reset API；若模組本身被 HMR 重載，仍以 Reset 按鈕與文件說明維持 demo 可理解性。
