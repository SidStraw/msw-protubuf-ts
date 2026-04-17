## ADDED Requirements

### Requirement: 函式庫必須以單一 npm package 搭配單一 entry 發佈

函式庫 SHALL 以單一 npm package 發佈，`package.json` 的 `exports` 欄位 MUST 只暴露唯一 entry point `"."`（包含 `import` 與 `types` 兩個子條件）。它 SHALL NOT 宣告 `"./msw"` 或任何與 `msw` 相關的 subpath export。

主 entry 在執行期 MUST NOT 匯入 `msw`、亦 MUST NOT 匯入 `@protobuf-ts/grpcweb-transport`；這兩個套件都不屬於本 library 的相依範圍。

#### Scenario: 主入口在執行期不依賴 MSW
- **WHEN** 使用者從主入口匯入 `createGrpcMockTransport`、`createGrpcMockRegistry` 或 `grpc`
- **THEN** 即使使用者專案沒有安裝 `msw` 或 `@protobuf-ts/grpcweb-transport`，module resolution 與 bundling 也 MUST 成功
- **AND** 產出的 bundle MUST NOT 包含 `msw` 的任何執行期 code

#### Scenario: 不存在 `./msw` subpath
- **WHEN** 使用者嘗試從 `<package>/msw` 匯入任何 symbol
- **THEN** module resolution MUST 失敗，因為 `package.json` 的 `exports` 並未定義該 subpath

### Requirement: 相依性必須以 peer 宣告，且不含 msw

套件的 `package.json` SHALL 依下列規則宣告相依性：

- `peerDependencies` MUST 僅包含 `@protobuf-ts/runtime` 與 `@protobuf-ts/runtime-rpc`，版本範圍需對應專案使用的 `protobuf-ts` major 版本（MVP 階段為 `^2.x`）。
- `peerDependencies`、`dependencies`、`devDependencies`、`optionalDependencies` 皆 MUST NOT 包含 `msw`。
- `peerDependencies`、`dependencies` MUST NOT 包含 `@protobuf-ts/grpcweb-transport`；該套件若需出現在測試環境，MAY 僅以 `devDependencies` 存在。

#### Scenario: 未安裝 MSW 仍可成功安裝
- **WHEN** 使用者在未列出 `msw` 的專案中執行 `pnpm add <package>`
- **THEN** package manager MUST NOT 產生任何與 `msw` 相關的 missing-peer warning
- **AND** 若缺少 `@protobuf-ts/runtime` 或 `@protobuf-ts/runtime-rpc`，則 MUST 產生 unresolved-peer error

#### Scenario: Source 中無 msw import
- **WHEN** 以 grep / lint 規則掃描 `src/`
- **THEN** MUST NOT 存在任何 `from 'msw'` 或 `require('msw')` 形式的匯入

### Requirement: TypeScript 型別必須是一等公民，且與 runtime 形狀一致

套件 SHALL 為主要 entry point 提供 TypeScript 型別定義，確保：

- 當 `MockRpcTransport` 取代 `GrpcWebFetchTransport` 使用時，generated `protobuf-ts` client 型別仍能正確推導。
- `grpc.unary(Service, 'methodLocalName', resolver)` 在 generated service 具有足夠型別資訊時，MUST 能從 `MethodInfo<I, O>` 推導 resolver 的 `request: I` 與回傳型別 `O`；若型別資訊不足，則 MUST 提供顯式泛型寫法 `grpc.unary<Req, Res>(...)` 作為 fallback。
- 所有公開型別 MUST 以具名匯出方式提供（例如 `MockHandler`、`GrpcMockRegistry`、`GrpcMockContext`、`UnaryResolver`、`ServerStreamResolver`、`StreamController`）。

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
- README MUST 附上「與既有 `RpcInterceptor` 並用」的範例，說明 interceptor（例如 `docs/devtool.ts` 的 `devtoolsInterceptor`）會隨 `RpcOptions.interceptors` 傳入 client，無論 transport 為 mock 或 real 都能如常運作。

#### Scenario: 以 factory 切換 transport
- **WHEN** 使用者把 `createApiTransport` 設定為僅在 `VITE_ENABLE_API_MOCK === 'true'` 時回傳 `createGrpcMockTransport({registry, fallbackTransport: realTransport})`
- **THEN** 既有的 `new XxxServiceClient(transport)` 呼叫點 MUST 在 mock mode 與 real mode 下都維持不變
- **AND** 既有 `RpcInterceptor`（含 DevTools interceptor）設定 MUST NOT 需要因為 mock 模式而修改

#### Scenario: production bundle 可 tree-shake 掉 mock 程式碼
- **WHEN** 建置時環境變數被靜態判定為 `false`，且使用者以該旗標包住動態 `import()`
- **THEN** mock library 的 runtime code MUST NOT 被打包進 production bundle

### Requirement: 套件必須遵守 SemVer，並明確標示 MVP 範圍

套件 SHALL 遵守 Semantic Versioning，且 MVP 以 `0.x` 版號發佈。文件 SHALL 清楚標示 MVP 範圍：

- 支援：`unary`、`serverStreaming`、`passthrough`、`delay`、headers/trailers、`RpcError`、與既有 `RpcInterceptor` 管線相容。
- 不支援：`clientStreaming`、`duplex`（會丟出 `UNIMPLEMENTED`）。
- 不在 scope：MSW bridge / `./msw` subpath / `msw` 相依。未來若要加，將在獨立 change 中以新 capability 評估。

#### Scenario: 文件與 runtime 對不支援方法的描述一致
- **WHEN** 開發者閱讀 `clientStreaming` 或 `duplex` 的 README 說明或 TypeScript docstring
- **THEN** 文件 MUST 明確指出它們在 MVP 不支援，且行為必須與 runtime 丟出 `RpcError('UNIMPLEMENTED', ...)` 一致

#### Scenario: 1.0 前的 breaking changes
- **WHEN** 套件在 `1.0.0` 之前發佈新的 minor 版本
- **THEN** breaking API changes MUST 在 CHANGELOG 中明確標示，並遵守 `0.x` 版本慣例
