## 1. Public API 與型別

- [ ] 1.1 新增 `src/session.ts`，實作 `createGrpcMockSession()`、`GrpcMockSession<TState>` 與 `DeepReadonly<T>`。
- [ ] 1.2 將 `createGrpcMockSession`、`GrpcMockSession` 與 `DeepReadonly` 從主 entry 匯出。
- [ ] 1.3 擴充 `GrpcMockContext`、resolver types、`MockHandler` 與 `GrpcMockRegistry` 泛型，使 resolver 可取得 typed `ctx.session`。
- [ ] 1.4 確保既有不使用 session 的 handlers 與 `createGrpcMockRegistry()` / `createGrpcMockTransport({ registry })` 呼叫點仍可 typecheck。

## 2. Registry 與 Transport 整合

- [ ] 2.1 讓 `createGrpcMockRegistry()` 預設建立 registry-owned session。
- [ ] 2.2 支援 `createGrpcMockRegistry({ initialState })` 與 `createGrpcMockRegistry({ session })`。
- [ ] 2.3 讓 `MockRpcTransport` 預設使用 `registry.session`。
- [ ] 2.4 支援 `createGrpcMockTransport({ registry, session })` 覆寫 transport active session。
- [ ] 2.5 在 unary 與 server-streaming resolver context 中注入 active session。

## 3. Clone Safety 與 Review 補強

- [ ] 3.1 使用 clone snapshot 保護 initial state、`getState()` 回傳值、`update()` callback input/output 與 `reset()` 回傳值。
- [ ] 3.2 將 `DeepReadonly` array branch 改為 `ReadonlyArray<...>`，讓 readonly array 型別語意更明確。
- [ ] 3.3 在 `cloneState()` 包裝 `structuredClone()` 失敗錯誤，說明 session state 必須是 cloneable data。
- [ ] 3.4 在文件說明 `structuredClone()` 不支援 functions、DOM nodes、WeakMap/WeakSet 等值。
- [ ] 3.5 在文件說明 read-modify-write 必須放在 `session.update()` callback 內完成。

## 4. Tests

- [ ] 4.1 新增 typed session unary test，驗證 request/response 推論與 session state 型別。
- [ ] 4.2 新增 reset 與 initial snapshot clone safety tests。
- [ ] 4.3 新增同一 registry 多 transports 共享 session 的 test。
- [ ] 4.4 新增 transport-level session override 隔離 test。
- [ ] 4.5 新增既有 handler 不使用 session 仍可註冊的相容性 test。
- [ ] 4.6 新增 unsupported clone value 的錯誤訊息 test。

## 5. Documentation 與 Playground

- [ ] 5.1 更新 README 支援範圍、session stateful mocks 範例與 API reference。
- [ ] 5.2 將 playground 的 article session mock 改用 `createGrpcMockSession()`。
- [ ] 5.3 保留 playground reset button 行為，改由正式 `session.reset()` 實作。

## 6. Validation

- [ ] 6.1 執行 `pnpm lint`。
- [ ] 6.2 執行 `pnpm typecheck`。
- [ ] 6.3 執行 `pnpm build`。
- [ ] 6.4 執行 `pnpm test`。
- [ ] 6.5 執行 `pnpm playground:build`。
