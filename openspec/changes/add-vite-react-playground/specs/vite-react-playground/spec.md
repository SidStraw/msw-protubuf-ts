## ADDED Requirements

### Requirement: 專案必須提供 workspace playground package

專案 SHALL 提供一個名為 `playground` 的 pnpm workspace package，作為 consumer-style 範例。此 package MUST 與 library source 分離，並以 workspace 相依方式使用本 repo 的 `@sidtw/protobuf-ts-grpc-mock` package。

#### Scenario: playground 被 pnpm workspace 識別

- **WHEN** 維護者在 repo 根目錄執行 pnpm workspace 相關指令
- **THEN** `playground` MUST 被列為 workspace package
- **AND** `playground` MUST 能以 workspace 相依方式解析本 repo 的 library package

#### Scenario: playground 不進入 npm package 發佈內容

- **WHEN** 維護者執行 npm pack 驗證發佈內容
- **THEN** tarball MUST NOT 包含 `playground/` 目錄
- **AND** library package 的 `exports` MUST 維持只有主 entry `"."`

### Requirement: playground 必須包含示範用 proto 與 protobuf-ts codegen

playground SHALL 包含示範用 `.proto` 檔案與可重複執行的 `protobuf-ts` codegen 流程。codegen MUST 產生 TypeScript message、service 與 client 程式碼，供 playground React app 直接使用。

#### Scenario: 重新產生 protobuf-ts 程式碼

- **WHEN** 維護者在 repo 根目錄執行 playground codegen script
- **THEN** script MUST 從 `playground/proto/` 讀取 `.proto`
- **AND** MUST 將 generated TypeScript 輸出到 `playground/src/gen/`

#### Scenario: generated client 可被 playground 匯入

- **WHEN** playground source 匯入 generated client 與 service metadata
- **THEN** TypeScript MUST 能解析 generated types
- **AND** generated client MUST 可接受 `createGrpcMockTransport(...)` 建立的 transport

### Requirement: playground 必須展示 mock transport 的核心互動

playground React app SHALL 展示 `protobuf-ts-grpc-mock` 的核心使用方式，包含 registry 註冊、transport 建立、generated client 呼叫，以及 UI 中可觀察的 mock 結果。

#### Scenario: 展示 unary mock response

- **WHEN** 使用者在 playground UI 觸發 unary RPC
- **THEN** app MUST 透過 generated client 呼叫 mock transport
- **AND** UI MUST 顯示 resolver 回傳的 response 內容

#### Scenario: 展示 server-streaming mock response

- **WHEN** 使用者在 playground UI 觸發 server-streaming RPC
- **THEN** app MUST 依序顯示 stream 中收到的多筆 message
- **AND** stream 完成後 MUST 在 UI 中呈現完成狀態

#### Scenario: 展示錯誤與 metadata/delay 行為

- **WHEN** 使用者在 playground UI 觸發錯誤或延遲示範
- **THEN** app MUST 顯示對應的 `RpcError` 狀態或延遲後的 response
- **AND** mock handler MUST 能示範 request metadata 被 resolver 讀取

### Requirement: core unary helper 必須支援 static response

core library SHALL 讓 `grpc.unary()` 與 `registry.unary()` 可接受 resolver 或 static response，讓使用者可以用接近 MSW fixture 的方式定義 unary mock，而不需要在使用端自行撰寫薄 helper。server-streaming mock MUST 維持 resolver-based API。

#### Scenario: 使用 static response 定義 unary mock

- **WHEN** 使用者呼叫 `grpc.unary(Service, 'methodName', responseObject)`
- **THEN** helper MUST 回傳可傳入 registry 的 `MockHandler`
- **AND** resolver 或靜態 response MUST 只綁定指定的 service method

#### Scenario: 不新增平行 helper namespace

- **WHEN** 使用者從 root package `@sidtw/protobuf-ts-grpc-mock` 匯入公開 API
- **THEN** package MUST NOT 新增與 `grpc` 平行且等價的 mock helper namespace
- **AND** `package.json` 的 `exports` MUST 維持只有主 entry `"."`

### Requirement: playground mocks 必須依 client 與 method 拆分

playground SHALL 將 mock 檔案拆分為每個 generated client 一個目錄、每個 method 一個檔案，讓使用者能複製接近 MSW GraphQL 的 mock 檔案組織方式。

#### Scenario: 每個 client 有獨立 mock 目錄

- **WHEN** 使用者檢視 `playground/src/mocks/`
- **THEN** 每個 generated client MUST 有對應目錄
- **AND** 每個目錄 MUST 以 method 檔案匯出 handlers

#### Scenario: 多個 client 共用同一個 mock transport

- **WHEN** playground 建立兩個 generated clients
- **THEN** clients MUST 共用同一個 registry 與 mock transport
- **AND** registry MUST 以 service/method key 區分不同 client 的 handlers

### Requirement: playground 必須展示 session stateful mock

playground SHALL 展示目前 session 內的 mock state 可以被 mutation-like RPC 更新，且後續 query-like RPC 會回傳更新後資料。session state MUST 由 playground mock 層管理，不得要求核心 library 內建特定 state model。

#### Scenario: mutation 後 query 讀到更新後資料

- **WHEN** 使用者在 playground UI 先觸發 query-like RPC 讀取目前 tags
- **AND** 接著觸發 mutation-like RPC 新增 tag
- **AND** 再次觸發 query-like RPC
- **THEN** 第二次 query-like RPC MUST 回傳包含新增 tag 的資料

#### Scenario: 使用者可以重置 mock session

- **WHEN** 使用者在 playground UI 觸發 reset
- **THEN** mock session MUST 回到初始資料
- **AND** 後續 query-like RPC MUST 回傳初始資料

### Requirement: repo 根目錄必須提供 playground 操作 scripts

repo root SHALL 提供一致的 playground 操作 scripts，讓維護者不需切換目錄即可執行 codegen、dev server 與 build 驗證。

#### Scenario: 從根目錄啟動 playground dev server

- **WHEN** 維護者在 repo 根目錄執行 playground dev script
- **THEN** script MUST 啟動 Vite dev server
- **AND** dev server MUST 載入 playground React app

#### Scenario: 從根目錄建置 playground

- **WHEN** 維護者在 repo 根目錄執行 playground build script
- **THEN** script MUST 對 playground 執行 TypeScript 與 Vite production build 驗證
- **AND** build MUST 使用 workspace 中的本 repo library package

### Requirement: 文件必須說明 playground 使用方式與範圍

README 或相關文件 SHALL 說明如何啟動 playground、如何重新產生 `protobuf-ts` 程式碼，以及 playground 的範圍限制。

#### Scenario: 使用者閱讀 playground 文件

- **WHEN** 使用者閱讀專案文件中的 playground 章節
- **THEN** 文件 MUST 提供安裝、codegen、dev server 與 build 指令
- **AND** 文件 MUST 說明 playground 是 transport-level mock 範例，不提供 MSW bridge 或真實 gRPC-Web backend
- **AND** 文件 MUST 說明 playground 使用兩個 generated clients 與依 method 拆分的 mock files
