## ADDED Requirements

### Requirement: 函式庫必須以單一 npm package 搭配 subpath exports 發佈

函式庫 SHALL 以單一 npm package 發佈，並透過 `package.json` 的 `exports` 欄位暴露兩個 entry point：

- `"."`：核心入口（registry + `MockRpcTransport`），MUST NOT 匯入 `msw` 或 `@protobuf-ts/grpcweb-transport`。
- `"./msw"`：MSW bridge 入口，MAY 匯入 `msw` 與 `@protobuf-ts/grpcweb-transport`。

兩個 entry point 都 MUST 同時輸出 runtime code 與 TypeScript declaration files。

#### Scenario: 主入口在執行期不依賴 MSW
- **WHEN** 使用者從主入口匯入 `createGrpcMockTransport`、`createGrpcMockRegistry` 或 `grpc`
- **THEN** 即使使用者專案沒有安裝 `msw`，module resolution 與 bundling 也 MUST 成功

#### Scenario: 從正確的 subpath 匯入 MSW 入口
- **WHEN** 使用者從 `./msw` subpath 匯入 `createGrpcMswHandlers`
- **THEN** 模組 MUST 從 `"./msw"` 的 exports entry 解析，且 MUST 在此時才拉入 `msw` 與 `@protobuf-ts/grpcweb-transport`

### Requirement: 相依性必須以 peer 宣告，且 optionality 正確

套件的 `package.json` SHALL 依下列規則宣告相依性：

- `peerDependencies` MUST 包含 `@protobuf-ts/runtime` 與 `@protobuf-ts/runtime-rpc`，其版本範圍需對應專案使用的 `protobuf-ts` major 版本（MVP 階段為 `^2.x`）。
- `peerDependencies` MUST 包含 `msw`（`^2`）與 `@protobuf-ts/grpcweb-transport`（`^2`）。
- `peerDependenciesMeta` MUST 將 `msw` 與 `@protobuf-ts/grpcweb-transport` 標記為 `{"optional": true}`，讓只使用核心入口的使用者不會被強制安裝這兩個套件。
- `dependencies` MUST NOT 重複列出上述任何 peer 套件。

#### Scenario: 未安裝 MSW 仍可成功安裝
- **WHEN** 使用者在未列出 `msw` 或 `@protobuf-ts/grpcweb-transport` 的專案中執行 `npm install <package>`
- **THEN** `npm` MUST NOT 對這兩個套件產生 missing-peer error（因為它們是 optional）
- **AND** 若缺少 `@protobuf-ts/runtime` 或 `@protobuf-ts/runtime-rpc`，則 MUST 產生 unresolved-peer error

### Requirement: TypeScript 型別必須是一等公民，且與 runtime 形狀一致

套件 SHALL 為兩個 entry point 提供 TypeScript 型別定義，確保：

- 當 `MockRpcTransport` 取代 `GrpcWebFetchTransport` 使用時，generated `protobuf-ts` client 型別仍能正確推導。
- `grpc.unary(Service, 'methodLocalName', resolver)` 在 generated service 具有足夠型別資訊時，MUST 能從 `MethodInfo<I, O>` 推導 resolver 的 `request: I` 與回傳型別 `O`；若型別資訊不足，則 MUST 提供顯式泛型寫法 `grpc.unary<Req, Res>(...)` 作為 fallback。
- 所有公開型別 MUST 以具名匯出方式提供（例如 `MockHandler`、`GrpcMockRegistry`、`GrpcMockContext`、`UnaryResolver`、`ServerStreamResolver`）。

#### Scenario: 使用 generated service 進行型別推導
- **WHEN** 開發者使用 `grpc.unary(GreeterService, 'sayHello', ({request}) => ({message: request.name}))`，且 `GreeterService` 帶有 `MethodInfo<SayHelloRequest, SayHelloResponse>`
- **THEN** TypeScript MUST 把 `request` 推導為 `SayHelloRequest`，並對不符合 `SayHelloResponse` 形狀的回傳值標示型別錯誤

#### Scenario: 顯式泛型 fallback
- **WHEN** generated service 的型別資訊不足以完成推導
- **THEN** `grpc.unary<SayHelloRequest, SayHelloResponse>(Service, 'sayHello', resolver)` MUST 能編譯，並對 resolver 強制套用指定的 `I` 與 `O` 型別

### Requirement: 套件必須支援以環境變數驅動的 transport factory 模式

套件 SHALL 在文件中提供 helper 或清楚的整合範例，讓使用者可以依環境變數在 `MockRpcTransport` 與真實 transport 之間切換，而不需要修改既有 generated client 的呼叫點。

- README MUST 包含一個 Vite 風格範例，示範如何在 `createApiTransport()` factory 中使用環境變數（例如 `VITE_ENABLE_API_MOCK`）。
- 該 factory 模式 MUST 支援可選的 `fallbackTransport`，讓未註冊 method 能在漸進導入期間打到真實後端。

#### Scenario: 以 factory 切換 transport
- **WHEN** 使用者把 `createApiTransport` 設定為僅在 `VITE_ENABLE_API_MOCK === 'true'` 時回傳 `createGrpcMockTransport({registry, fallbackTransport: realTransport})`
- **THEN** 既有的 `new XxxServiceClient(transport)` 呼叫點 MUST 在 mock mode 與 real mode 下都維持不變

#### Scenario: production bundle 可 tree-shake 掉 mock 程式碼
- **WHEN** 建置時環境變數被靜態判定為 `false`，且使用者以該旗標包住動態 `import()`
- **THEN** mock library 的 runtime code MUST NOT 被打包進 production bundle

### Requirement: 套件必須遵守 SemVer，並明確標示 MVP 範圍

套件 SHALL 遵守 Semantic Versioning，且 MVP 以 `0.x` 版號發佈。文件 SHALL 清楚標示 MVP 範圍：

- 支援：`unary`、`serverStreaming`、`passthrough`、`delay`、headers/trailers、`RpcError`。
- 不支援：`clientStreaming`、`duplex`（會丟出 `UNIMPLEMENTED`）。
- MSW bridge 的預設 wire format 為 `binary`；`text` 屬於實驗性支援。

#### Scenario: 文件與 runtime 對不支援方法的描述一致
- **WHEN** 開發者閱讀 `clientStreaming` 或 `duplex` 的 README 說明或 TypeScript docstring
- **THEN** 文件 MUST 明確指出它們在 MVP 不支援，且行為必須與 runtime 丟出 `RpcError('UNIMPLEMENTED', ...)` 一致

#### Scenario: 1.0 前的 breaking changes
- **WHEN** 套件在 `1.0.0` 之前發佈新的 minor 版本
- **THEN** breaking API changes MUST 在 CHANGELOG 中明確標示，並遵守 `0.x` 版本慣例
