## Context

現有 mock library 已有 `createGrpcMockRegistry()`、`grpc.unary()`、`grpc.serverStreaming()` 與 `MockRpcTransport`，resolver context 目前負責提供 request metadata、abort signal 與 `passthrough()`。playground 的 `Session stateful unary mocks` 需求則是另外在 `playground/src/mocks/article/session.ts` 以 module-level state 實作，代表核心套件沒有正式 session contract。

這個 change 要把 session state 提升為 package-level 能力，同時保持既有 handler 寫法相容。review 目前實作時，主要要確認三件事：typed session 不破壞 request/response 推論、registry 與 transport 的 session ownership 清楚、clone/reset 行為不讓外部 reference 污染狀態。

## Goals / Non-Goals

**Goals:**

- 在 resolver context 注入 `session`，讓 unary 與 server-streaming handlers 都能存取同一份 mock session state。
- 提供 `createGrpcMockSession<TState>()`，支援 typed initial state、`getState()`、`update()` 與 `reset()`。
- 讓 registry 預設持有 session，使同一 registry 建立的多個 transports 預設共享 mock session。
- 允許 transport 覆寫 session，支援測試隔離或局部 mock world。
- 對 initial state 與回傳 state 做 clone，避免 reference mutation 污染 session snapshot。
- 保持既有 handlers、registry 與 transport 基本用法相容。

**Non-Goals:**

- 不提供全域 singleton session。
- 不提供 persistence、localStorage、跨頁籤同步或 time-travel state。
- 不提供 deep merge / patch API；read-modify-write 以 `update()` 為唯一寫入入口。
- 不保證 resolver 在 `update()` 外先讀取舊 state 再寫入時具備交易隔離。
- 不新增外部 runtime dependency。

## Decisions

### Session API 使用 explicit factory

新增 `createGrpcMockSession(initialState?)` 回傳 `GrpcMockSession<TState>`。API 只提供：

- `getState()`：回傳 state clone 的 deep readonly type。
- `update(updater)`：以目前 state clone 呼叫 updater，並把 updater 回傳值作為下一個 state snapshot。
- `reset()`：回復到建立 session 時的 initial snapshot。

替代方案是提供 `session.state` mutable property 或 `patch(partial)`。這會讓使用者直接 mutate reference，或讓 shallow/deep merge 語意變得模糊，因此不採用。

### Session ownership 放在 registry，transport 可覆寫

`createGrpcMockRegistry()` 預設建立一份 session；`createGrpcMockRegistry({ initialState })` 與 `createGrpcMockRegistry({ session })` 可建立 typed registry。`createGrpcMockTransport({ registry })` 預設使用 `registry.session`，同一 registry 的多個 transports 因此共享狀態；`createGrpcMockTransport({ registry, session })` 則可覆寫。

替代方案是每個 transport 預設各自建立 session。這會讓「同一 registry 代表同一 mock world」的直覺失效，尤其在多個 generated clients 或 component tests 共用 registry 時容易得到非預期狀態隔離，因此不採用。

### Context 與 handler 泛型保留既有推論

`GrpcMockContext<I, O, TState = Record<string, unknown>>` 增加第三個泛型預設值，`UnaryResolver`、`ServerStreamResolver`、`MockHandler` 與 `GrpcMockRegistry` 也帶入相同預設。既有不指定 session state 的使用者仍得到 `Record<string, unknown>` session；使用 typed registry 或顯式 `grpc.unary<I, O, TState>()` 時，resolver 內的 `ctx.session` 會取得 typed state。

替代方案是讓 session 永遠是 untyped `Record<string, unknown>`，會降低正式 API 的價值；或讓所有 registry/handler 成為必填泛型，會破壞既有呼叫點，因此不採用。

### Clone safety 以 `structuredClone()` 為基礎

Session 建立時 clone initial state，`getState()`、`update()` 與 `reset()` 都回傳 clone。這可避免外部保留 initial state reference 後 mutate，或 resolver 拿到 state 後直接改動內部 snapshot。

`structuredClone()` 無法處理 functions、DOM nodes、WeakMap/WeakSet、部分 prototype semantics 等資料，因此文件必須明確限制 session state 應只放可 clone 的 plain data。實作也應在 clone 失敗時提供可理解的錯誤訊息，而不是讓低階 `DataCloneError` 缺少上下文。

### Review 目前實作的結論

目前實作方向與架構相容：session 插入點在 `createContext()`，registry 持有預設 session，transport 可覆寫 session，並已補 session-focused tests。review 需補強的點是：

- `DeepReadonly` array branch 可改用 `ReadonlyArray<...>`，讓型別語意更明確。
- `cloneState()` 應包裝 `structuredClone()` 失敗錯誤，說明 session state 必須可 clone。
- README 應列出 structured clone 限制與 `update()` 使用方式，避免使用者在 updater 外讀取舊 state 後再寫入造成 lost update 語意。

## Risks / Trade-offs

- **Risk: 使用者在 `update()` 外先 `getState()` 後再寫入，可能覆蓋其他 resolver 已更新的 state。** → Mitigation：文件要求 read-modify-write 必須在 `update()` callback 內完成；測試覆蓋並行 unary calls 使用 `update()` 的行為。
- **Risk: `structuredClone()` 無法 clone 某些值，使用者把 class instance 或 function 放進 session state 會 runtime throw。** → Mitigation：文件列出限制；`cloneState()` 補上明確錯誤訊息。
- **Risk: `getState()` 每次 clone 可能增加大型 state 的成本。** → Mitigation：session state 定位為 mock data，不應承載大型資料庫；clone 可換取 reference safety。
- **Risk: 泛型增加 public type surface 複雜度。** → Mitigation：所有新增泛型都有預設值，既有呼叫點不需修改。
- **Risk: passthrough resolver 若先更新 session 再呼叫 `passthrough()`，狀態會保留。** → Mitigation：視為明確 resolver side effect；文件可在 passthrough 章節補充此語意。
