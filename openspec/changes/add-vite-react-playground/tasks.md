## 1. Workspace 與相依性

- [x] 1.1 新增 `pnpm-workspace.yaml`，將 root package 與 `playground` 納入 workspace。
- [x] 1.2 建立 `playground/package.json`，宣告 Vite、React、React DOM、`@vitejs/plugin-react`、`@protobuf-ts/plugin`、`@protobuf-ts/protoc` 與本 repo library 的 workspace 相依性。
- [x] 1.3 調整 root scripts，新增 `playground:gen`、`playground:dev`、`playground:build`，並確認既有 `build`、`test`、`lint`、`typecheck` 行為不被破壞。

## 2. Proto 與 protobuf-ts codegen

- [x] 2.1 新增 `playground/proto/greeter.proto`，定義可展示 unary 與 server-streaming 的示範 service 與 messages。
- [x] 2.2 設定 playground codegen script，從 `playground/proto/` 產生 TypeScript 到 `playground/src/gen/`。
- [x] 2.3 執行 codegen 並提交 generated `protobuf-ts` 產物，確認 generated client 與 service metadata 可被 TypeScript 匯入。

## 3. Playground 應用程式

- [x] 3.1 建立 Vite + React 基礎檔案：`index.html`、`vite.config.ts`、`tsconfig.json`、`src/main.tsx`、`src/App.tsx`。
- [x] 3.2 建立 `playground/src/mocks/`，使用 `createGrpcMockRegistry()`、`grpc.unary()`、`grpc.serverStreaming()` 註冊示範 handlers。
- [x] 3.3 建立 `playground/src/transport.ts`，集中建立 mock transport 與 generated client。
- [x] 3.4 實作 UI：展示 unary response、server-streaming 多筆訊息、`RpcError` 錯誤狀態，以及 metadata/delay 示範。

## 4. 文件與發佈邊界

- [x] 4.1 更新 README，加入 playground 安裝、codegen、dev server 與 build 指令。
- [x] 4.2 在 README 說明 playground 是 transport-level mock 範例，不提供 MSW bridge 或真實 gRPC-Web backend。
- [x] 4.3 確認 root `package.json` 的 `files` 白名單不包含 `playground/`，且 `exports` 仍只暴露主 entry `"."`。

## 5. Validation

- [x] 5.1 執行 `pnpm install` 更新 lockfile 與 workspace metadata。
- [x] 5.2 執行 `pnpm playground:gen`，確認 generated code 與 proto 同步。
- [x] 5.3 執行 `pnpm playground:build`，確認 Vite + React playground 可 production build。
- [x] 5.4 執行 `pnpm typecheck`，確認 root TypeScript 檢查通過。
- [x] 5.5 執行 `pnpm build`、`pnpm test`、`pnpm lint`，確認既有 library 行為未被破壞。
- [x] 5.6 執行 npm pack 檢查，確認 tarball 不包含 `playground/`。
