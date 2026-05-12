## Why

目前「Session stateful unary mocks」只透過 playground 的 module-level state 示範，外部專案使用套件時沒有正式、可重用、可 reset、可型別化的 session state API。這會讓 mutation-like mock 更新後再由 query-like mock 讀取同一份 session 的常見需求落在 consumer 自行拼裝，難以在測試、playground 與本機開發間保持一致。

## What Changes

- 新增正式 session state API，讓 mock resolver 可以透過 `ctx.session` 讀取、更新與 reset mock session state。
- `createGrpcMockRegistry()` 支援建立或接收 typed session；同一 registry 建立出的 transports 預設共享同一份 session state。
- `createGrpcMockTransport()` 支援以 optional `session` 覆寫 registry session，讓測試可針對個別 transport 做隔離。
- Session state 需以 clone snapshot 維護，避免 initial state 或回傳 state reference 被外部 mutation 污染；clone 失敗需提供可理解的錯誤訊息。
- 更新 README 與 playground，將原本 consumer-side module state 範例改成正式 session API。
- 新增單元測試覆蓋 typed session、跨 unary calls 狀態共享、reset、registry/transport session ownership 與既有 handler 相容性。
- 不新增 runtime dependency，不新增全域 singleton，不改變既有 `grpc.unary()` / `grpc.serverStreaming()` 的基本使用方式。

## Capabilities

### New Capabilities

- `grpc-mock-session-state`: 規範 gRPC mock resolver 可用的 session state API，包含 typed session 建立、resolver context 注入、registry-level shared state、transport-level override、reset 與 clone safety。

### Modified Capabilities

<!-- 本 repo 目前 openspec/specs/ 尚無既有 capability，無需 delta spec。 -->

## Impact

- **Public API**：新增 `createGrpcMockSession()`、`GrpcMockSession<TState>` 與 `DeepReadonly<T>`；`GrpcMockContext` 新增 `session` 欄位；`createGrpcMockRegistry()` 與 `createGrpcMockTransport()` 增加 session 相關 options。
- **Source**：新增 session state implementation，調整 registry、transport 與 context 建立流程。
- **Playground**：`playground/src/mocks/article/session.ts` 改用正式 session API。
- **Documentation**：README session 範例與 API reference 更新為 package-level 能力，並說明 `structuredClone()` 限制。
- **Tests**：新增 session-focused tests，確保既有 unary / streaming / fallback 行為維持相容。
- **Compatibility**：既有不使用 session 的 handlers 不需修改；既有 registry/transport 建立流程仍可不帶 options 使用。
