## Why

目前專案只有 library 原始碼、測試 fixture 與 README 片段，缺少可在本機直接啟動的 consumer playground。這讓維護者難以確認 `protobuf-ts` codegen、`grpc-web-mock` transport 注入與前端實際互動效果，也讓使用者缺少可複製的完整範例。

## What Changes

- 新增一個以 pnpm workspace 管理的 `playground` package，作為不隨 npm library 發佈的 consumer 範例。
- 新增 playground 專用 `.proto`，並提供 `protobuf-ts` codegen script，把產物輸出到 playground 的 `src/gen/`。
- 新增 Vite + React 小型應用程式，展示以 generated client 呼叫 mock transport 的 unary、server-streaming、error 與 metadata/delay 等效果。
- 在 core `grpc.unary()` 支援 static response，讓使用套件的專案可用更接近 MSW fixture 的方式定義 unary mock，不必自行實作薄 helper。
- 擴充 playground 至兩個 proto / 兩個 generated client，並把 mock 拆成每個 client 一個目錄、每個 method 一個檔案。
- 擴充 playground UI，展示 mutation-like unary 呼叫更新 session state 後，後續 query-like unary 呼叫會讀到更新後資料。
- 新增 root scripts，讓維護者可從 repo 根目錄執行 playground codegen、dev server 與 production build。
- 更新文件，說明如何啟動 playground、如何重新產生 `protobuf-ts` 程式碼，以及 playground 不屬於 npm package 發佈內容。

## Capabilities

### New Capabilities

- `vite-react-playground`: 規範 workspace playground package、Vite + React 示範應用、`protobuf-ts` codegen、mock handler 展示與相關 scripts。

### Modified Capabilities

<!-- 本 repo 目前 openspec/specs/ 尚無既有 capability，無需 delta spec。 -->

## Impact

- **新增目錄**：`playground/`，包含 `package.json`、Vite/React 設定、兩個 `.proto`、generated code、依 client/method 拆分的 mock handlers 與 UI source。
- **新增 workspace 設定**：root 專案需加入 pnpm workspace 設定，使 `playground` 成為獨立 workspace package。
- **新增 devDependencies**：playground 需要 Vite、React、React DOM、`@vitejs/plugin-react`、`@protobuf-ts/plugin` 與 `@protobuf-ts/protoc` 等開發相依性；library 的 runtime/peer dependency 契約不改變。
- **新增 scripts**：root scripts 將加入 playground codegen、dev 與 build 指令；既有 `build`、`test`、`lint`、`typecheck` 行為應維持相容。
- **發佈影響**：`package.json` 的 `files` 仍應只包含 `dist`、`README.md`、`CHANGELOG.md`，playground 不會進入 npm package。
- **公開 API 影響**：`grpc.unary()` 新增 static response overload；`exports` 仍只暴露主 entry `"."`，不新增 subpath。
