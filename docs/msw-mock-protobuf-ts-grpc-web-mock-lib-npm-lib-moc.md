# `msw` + `protobuf-ts` 建立 gRPC-Web mock npm lib 可行性研究

## Executive Summary

可以做，而且**最佳切入點不是只靠 `msw` handler 硬做 wire-level mock**，而是把 `protobuf-ts` 的 `RpcTransport` 當成核心抽象，再額外提供一層可選的 `msw` bridge。`protobuf-ts` generated client 本來就依賴 `RpcTransport`，並透過 `MethodInfo`／`ServiceInfo` 暴露 runtime reflection，因此很適合包成一個型別安全的 mock library；反過來說，若只靠 `msw`，你仍得自己處理 gRPC-Web 的 framing、content-type、trailers 與 method URL 映射，MSW 官方目前也沒有一級的 gRPC API。[^^1][^^2][^^3][^^4][^^5]

你的現況「proto 專案以 `protobuf-ts` 打包出 req 與 client，前端直接引入打包後檔案」其實非常適合這種設計，因為整合點只需要集中在「建立 client 時注入哪個 transport」。也就是說，前端大多數呼叫程式碼可以不變，只把 `new XxxClient(transport)` 的 `transport` 換成 `mock` 或 `real` 即可，再用環境變數決定是否啟用 mock。[^^2][^^3][^^6]

若你希望 DX 接近 `msw`，建議做成**單一 npm lib、兩種模式**：第一種是「transport mode」，直接以型別安全 resolver 回傳 decoded message，最適合單元測試、元件測試與大多數整合測試；第二種是「MSW bridge mode」，把同一套 resolver 轉成 `msw` 的 `http.post()` handlers，讓你在瀏覽器與 Node 測試裡保留 network-level mock 與 DevTools 可觀察性。這樣能同時兼顧易用性、型別安全與 `msw` 風格。[^^3][^^4][^^7][^^8]

## Architecture / System Overview

```text
┌─────────────────────────── App code ───────────────────────────┐
│                                                               │
│  const transport = createApiTransport(env)                    │
│  const client = new UserServiceClient(transport)              │
│                                                               │
└───────────────────────────────────────────────────────────────┘
                             │
                             ▼
                 ┌──────────────────────────┐
                 │  generated client code   │
                 │  - accepts RpcTransport  │
                 │  - runs stackIntercept   │
                 └──────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
┌──────────────────────────┐   ┌───────────────────────────────┐
│ real transport mode      │   │ mock transport mode           │
│ GrpcWebFetchTransport    │   │ createGrpcMockTransport()     │
│                          │   │                               │
│ POST /pkg.Service/Method │   │ registry.unary()/stream()     │
│ application/grpc-web...  │   │ decoded request object        │
│ fetch()                  │   │ typed response object         │
└──────────────────────────┘   └───────────────────────────────┘
              │                             │
              │                             ├────────────────────────────┐
              │                             │ optional                    │
              ▼                             ▼                             ▼
   ┌─────────────────────┐      ┌───────────────────────┐      ┌────────────────────┐
   │ real backend/proxy  │      │ same mock registry    │─────▶│ msw bridge         │
   └─────────────────────┘      │ -> msw http handlers  │      │ setupWorker/server │
                                 └───────────────────────┘      └────────────────────┘
```

上圖之所以成立，是因為 `protobuf-ts` generated client 並不綁死在 `GrpcWebFetchTransport`，而是依賴 `RpcTransport` 介面；同時 generated client 也會先走 `stackIntercept()`，所以現有的認證、log、header 注入等 interceptor 邏輯可以跟 mock transport 共存，不需要為了 mock 另外重寫一套 client 初始化流程。[^^2][^^3][^^6]

## Key Repositories Summary

| Repository | 角色 | 這份研究最關鍵的證據 |
|---|---|---|
| [timostamm/protobuf-ts](https://github.com/timostamm/protobuf-ts) | 你的可插拔核心。提供 `RpcTransport`、reflection、`TestTransport`、gRPC-Web helper。 | `packages/runtime-rpc/src/rpc-transport.ts`、`packages/runtime-rpc/src/test-transport.ts`、`packages/grpcweb-transport/src/index.ts`[^^2][^^9][^^10] |
| [mswjs/msw](https://github.com/mswjs/msw) | 可選的 network-level bridge。適合 browser/Node 攔截與 DevTools 可視化。 | `README.md`、`src/core/http.ts`、`src/browser/setupWorker/setupWorker.ts`、`src/node/SetupServerApi.ts`[^^4][^^7][^^8] |
| [grpc/grpc](https://github.com/grpc/grpc) | gRPC-Web wire protocol 來源。定義 content-type、frame、trailers、stream 限制。 | `doc/PROTOCOL-WEB.md`[^^5] |

## 1. 只用 `msw` 直接 mock gRPC-Web，技術上可行，但 DX 不好

`msw` 的核心抽象仍然是 HTTP request handler；它提供 `http.get()`、`http.post()` 等 API 來攔截請求，瀏覽器端透過 `setupWorker()` 啟動 Service Worker，Node 端則透過 `setupServer()` 攔截 `fetch`、`XMLHttpRequest` 與 `ClientRequest`。這意味著 `msw` 很適合當「網路層攔截器」，但它並不知道 protobuf message、service descriptor 或 gRPC-Web method signature 本身是什麼。[^^4][^^7][^^8]

MSW maintainer 早期就明確表示：**只要請求能被 Service Worker 的 `fetch` event 攔截，理論上就能搭配 gRPC-Web 使用**；但同一串討論裡也明確承認「希望有 gRPC 支援，但目前沒有足夠人力做一級支援」。後續社群案例也顯示，要在 `msw` 內 mock gRPC-Web，通常必須手動組出 `application/grpc-web+proto` 或 `application/grpc-web-text` 的 response body 與 headers。[^^11]

這個成本並不是偶發，而是由 gRPC-Web protocol 本身決定：它不是純 JSON-over-HTTP，而是要求使用 `application/grpc-web` 或 `application/grpc-web-text` 類型、以 5-byte frame prefix 包住 message，並把 trailers 作為 body 末端的最後一個 frame；server-streaming 也是同樣基於 frame 與 EOF 關閉，而不是一般 REST response 的資料模型。[^^5][^^12]

因此，如果你直接做 `msw` 版 API，最終很容易退化成下面這種「其實不太像 `msw`」的做法：

1. 自己拼 `/package.Service/Method` URL。
2. 自己 decode request frame。
3. 自己 encode response frame 與 trailer frame。
4. 自己設 `Content-Type`、`X-Grpc-Web`、`grpc-status` 類型的 headers／trailers。

Lucas Levin 的文章就是這種典型案例：他用 `msw` 成功 mock 了 gRPC-Web，但核心工作是自己建立 data frame 與 trailer frame，再把整個 `ArrayBuffer` 當 response body 回傳。這證明「做得到」，也同時證明「很值得被包成 library」。[^^13]

## 2. `protobuf-ts` 正好提供做這個 library 的核心拼圖

### 2.1 `RpcTransport` 本身就是天然的 mock seam

`protobuf-ts` 的 `RpcTransport` 定義了 `unary`、`serverStreaming`、`clientStreaming`、`duplex` 四種 RPC 執行方式；它明確說明這個介面就是 generated service client 與 wire protocol（gRPC、gRPC-Web、Twirp 或其他）的契約。也就是說，對 generated client 而言，**「真正的後端」與「mock」在設計上本來就只是不同的 transport implementation**。[^^2]

generated client 端的程式碼也印證了這件事。`ElizaServiceClient` 的 constructor 只收一個 `RpcTransport`，每個方法都先 `mergeOptions()`，再呼叫 `stackIntercept(..., this._transport, method, ...)`。換句話說，只要你的 mock library 實作的是 `RpcTransport`，對 consumer 來說就能像真正 transport 一樣被注入，而不是入侵每個 API call site。[^^3][^^6]

### 2.2 reflection 資訊足夠做出型別安全 API

`protobuf-ts` 的 `MethodInfo` 包含 `service`、`name`、`localName`、是否 streaming、以及輸入／輸出 message type handler `I` / `O`。這兩個 type handler 直接提供 binary / JSON encode/decode 能力。這表示你的 mock library 可以不靠字串猜測，而是直接用 service/method reflection 來：

1. 驗證 resolver 對應到哪個 RPC。
2. 將 wire bytes decode 成 typed request。
3. 驗證 resolver 回傳的 response 是否符合 `method.O`。
4. 自動導出 gRPC-Web URL 與 handler metadata。[^^14]

更關鍵的是，`localName` 與 method 順序也都在 reflection 裡，所以 library API 可以設計成接近 `msw` 的易用形式，例如 `mock.unary(UserService, 'getUser', resolver)`，而不必要求使用者手動記 `/pkg.UserService/GetUser` 這種 wire-level 路徑。[^^14]

### 2.3 `TestTransport` 證明官方 runtime 已經有 mock transport 前例

`@protobuf-ts/runtime-rpc` 直接公開匯出 `TestTransport`，而且它不是隨便的 stub：它支援 headers、response、status、trailers、各種 streaming call、delay、abort，以及將 response 與 trailers 錯誤傳遞到對應的 promise / stream；在建立 response 時還會用 `method.O.is(...)` 驗證訊息形狀是否正確。這表示 `protobuf-ts` 官方 runtime 已經接受「mock / test transport」是合理的擴充方向，只是目前 DX 偏向測試輔助，而不是 `msw` 式 registry API。[^^9][^^10]

對你來說，這是一個很好的設計訊號：你的 npm lib 不一定要從零發明 transport 抽象，而是可以站在現有 `RpcTransport` / `UnaryCall` / `ServerStreamingCall` 資料模型上，把它包裝成更像 `msw` 的宣告式註冊 API。[^^2][^^9]

### 2.4 gRPC-Web framing helper 已公開匯出，不必硬複製內部實作

這點非常關鍵。`@protobuf-ts/grpcweb-transport` 的 public API 不只匯出 `GrpcWebFetchTransport`，還公開匯出了 `createGrpcWebRequestBody`、`createGrpcWebRequestHeader`、`readGrpcWebResponseBody`、`readGrpcWebResponseHeader`、`readGrpcWebResponseTrailer` 與 `GrpcWebFrame`。因此，如果你要做 `msw` bridge，**你不需要複製 gRPC-Web framing 實作**，可以直接重用官方 helper。[^^10]

這件事會大幅降低維護成本，因為你要包的 library 就不用自己長期追蹤 gRPC-Web framing 細節；真正需要自行補的，反而是「request side 的 decode helper 與 registry/adapter 設計」，而不是 protocol framing 本身。[^^10][^^12]

## 3. 針對你的需求，建議做成「單一 npm lib、兩層能力」

### 3.1 核心層：`transport-first` mock（建議作為主路徑）

這一層應該是 library 的主產品。原因很簡單：你目前的前端已經是直接引入 `protobuf-ts` 打包後的 req 與 client，而 generated client 本來就接受 `RpcTransport`。因此最平順的整合方式不是改 handler，而是提供一個 `createGrpcMockTransport()`，讓現有 client 建構點切換 transport 即可。[^^2][^^3]

建議 API 草圖如下：

```ts
// 建議 API 草圖（非現有 API）
import {
  createGrpcMockRegistry,
  createGrpcMockTransport,
} from '@your-scope/protobuf-ts-grpc-mock'

import { UserServiceClient } from '@your-protos/user.client'
import { UserService } from '@your-protos/user'
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport'

const registry = createGrpcMockRegistry()

registry.unary(UserService, 'getUser', ({ request, meta }) => {
  return {
    id: request.id,
    name: 'Mock User',
  }
})

registry.serverStreaming(UserService, 'watchUsers', ({ request }) => {
  return [
    { id: request.id, status: 'PENDING' },
    { id: request.id, status: 'DONE' },
  ]
})

const realTransport = new GrpcWebFetchTransport({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  format: 'binary',
})

const transport =
  import.meta.env.VITE_ENABLE_API_MOCK === 'true'
    ? createGrpcMockTransport({
        registry,
        fallbackTransport: realTransport,
      })
    : realTransport

export const userClient = new UserServiceClient(transport)
```

這種設計最符合你想要的幾件事：設定簡單、型別安全、可做 npm lib、可用環境變數切換、也能沿用既有 generated client。[^^2][^^3][^^6][^^14]

### 3.2 第二層：可選的 `msw` bridge（保留 network-level mock）

如果你只做 transport mode，會有一個明顯 trade-off：mock 不會真的經過瀏覽器 network layer，因此在 DevTools Network 面板看不到「像真實 gRPC-Web request 一樣」的流量。這時候可以再加一個 `createGrpcMswHandlers(registry, options)`，把**同一套 registry** 轉成 `msw` handler，滿足你想要的 `msw` 式啟停體驗。[^^4][^^7][^^8][^^15]

建議 API 草圖：

```ts
// 建議 API 草圖（非現有 API）
import { http } from 'msw'
import { setupWorker } from 'msw/browser'
import {
  createGrpcMockRegistry,
  createGrpcMswHandlers,
} from '@your-scope/protobuf-ts-grpc-mock/msw'

const registry = createGrpcMockRegistry()
registry.unary(UserService, 'getUser', ({ request }) => ({
  id: request.id,
  name: 'Mock User',
}))

if (import.meta.env.VITE_ENABLE_API_MOCK === 'true') {
  const worker = setupWorker(
    ...createGrpcMswHandlers(registry, {
      baseUrl: import.meta.env.VITE_API_BASE_URL,
      format: 'binary',
    }),
  )
  await worker.start()
}
```

這個 bridge 內部其實就是自動做掉三件麻煩事：

1. 依照 `GrpcWebFetchTransport.makeUrl()` 的規則組出 `/package.Service/Method` 路徑。
2. 依照 gRPC-Web framing 規則 encode/decode request 與 response。
3. 用 `msw` 的 `http.post()` 與 `HttpResponse` / 原生 `Response` 把結果送回去。[^^4][^^6][^^10][^^12][^^15]

### 3.3 為什麼要兩層，而不是只做其中一層

只做 transport mode，DX 最乾淨、型別資訊最完整、整合侵入最小，但少了 network panel 可視化。只做 `msw` bridge，雖然更貼近 `msw` 的心智模型，但所有 gRPC-Web framing 與 request decode 成本都會落在 bridge 上，實作與維護都比較重。把兩者拆開，等於把「開發者體驗」與「網路層可觀察性」解耦，讓使用者依場景選擇最適合的模式。[^^2][^^4][^^10][^^11][^^13]

## 4. 你要的「像 `msw` 一樣簡單」API，具體可以怎麼設計

### 4.1 方法註冊應該以 service + method 為核心，不要以 URL 為核心

對使用者來說，最自然的寫法不是：

```ts
http.post('/my.pkg.UserService/GetUser', ...)
```

而是：

```ts
mock.unary(UserService, 'getUser', ...)
```

因為 `protobuf-ts` 已經有 `ServiceInfo.typeName`、`MethodInfo.name`、`MethodInfo.localName`，library 完全可以在內部把 `getUser` 轉成正確的 proto method 與 gRPC-Web URL。這樣既保留型別安全，也把使用者從 wire-level 細節中解放出來。[^^6][^^14]

### 4.2 resolver 應直接收到 decoded request，而不是 `Request`

若你真的想複製 `msw` 的體驗，最像的是 `({ request, params, cookies }) => ...` 這種 resolver；但對 gRPC-Web 而言，使用者真正想碰的不是 `Request`，而是 protobuf request object。建議 resolver context 至少包含：

- `request`: 已 decode 的 typed request message。
- `method`: `MethodInfo`。
- `meta`: `RpcMetadata` / headers。
- `signal`: `AbortSignal | undefined`。
- `passthrough()`: 導到 fallback real transport。

這樣可以把 `msw` 的易用性保留下來，但又避免使用者自己剝 5-byte frame、自己 `fromBinary()`。[^^2][^^6][^^12][^^14]

### 4.3 回傳值應該支援物件、陣列與錯誤，而不是要求使用者手動回 `UnaryCall`

`TestTransport` 已經證明 mock 資料其實可以很自然地表達成：

- 單一 response 物件。
- server-streaming 的 response 陣列。
- `RpcError`。
- headers / status / trailers / delay。[^^9]

因此對外 API 建議設計成：

```ts
mock.unary(Service, 'getUser', () => ({ id: '1', name: 'A' }))

mock.serverStreaming(Service, 'watchUsers', () => [
  { id: '1', status: 'STARTED' },
  { id: '1', status: 'DONE' },
])

mock.unary(Service, 'getUser', () => {
  throw new RpcError('not found', 'NOT_FOUND')
})
```

這樣既貼近 `msw` resolver 的簡潔感，也符合 `protobuf-ts` 現有 call model。[^^4][^^9]

## 5. gRPC-Web 範圍內，MVP 應先只做 unary + server streaming

`GrpcWebFetchTransport` 在原始碼裡直接寫明：它實作 gRPC-Web protocol，使用 `fetch` 發送 HTTP request，**但不支援 client streaming 與 duplex**，因為 gRPC-Web 本身就不支援這兩種型別；`grpc/grpc` 的 `PROTOCOL-WEB.md` 也同樣指出 bidi-streaming 仍 pending on browser fetch/streams 能力。[^^6][^^5]

所以你的 npm lib 如果目標是「gRPC-Web mock」，MVP 最合理的範圍就是：

1. `unary()`
2. `serverStreaming()`
3. `passthrough()`
4. `delay`／`headers`／`trailers`／`RpcError`

client-streaming 與 duplex 若要支援，應該被視為未來「泛 `RpcTransport` mock」能力，而不是 gRPC-Web 專屬能力；否則 API 會比真實瀏覽器 transport 還強，反而製造認知落差。[^^5][^^6][^^9]

## 6. `binary` 應作為預設 wire format，`text` 作為可選

`GrpcWebFetchTransport` 支援 `format: "text" | "binary"`，若未指定會走 `text`；但官方 browser 範例在建 transport 時明確把 format 設成 `"binary"`，因為 demo service 不支援 text format。從 library 設計角度看，`binary` 在 mock 端更直觀，也比較不需要處理 base64 chunking，因此很適合作為預設值，同時保留 `text` 選項給相容性需求。[^^6][^^16]

若你做 `msw` bridge，`binary` 模式可以直接處理 `Uint8Array` / `ArrayBuffer`；`text` 模式則要多一層 base64 編碼與解碼，且 gRPC-Web spec 還提醒 text streaming 的 chunk 不一定會剛好落在 frame 邊界。這些都表示：除非專案後端真的要求 `grpc-web-text`，否則 library 預設走 `binary` 會更穩。[^^5][^^12]

## 7. `msw` bridge 的實作成本，主要卡在 request decode 與 stream response

### 7.1 request decode 不是零成本，但可控

`protobuf-ts` 已公開 `createGrpcWebRequestBody()` 與各種 response parser helper，但沒有對應的「把 request body 還原成 decoded input message」高階 helper。因此你的 `msw` bridge 大致需要做：

1. `await req.arrayBuffer()`
2. 依 `binary` 或 `text` 格式解 base64（若是 text）
3. 去掉前 5 bytes 的 data frame prefix
4. `method.I.fromBinary(payload)` 取得 typed request。[^^10][^^12][^^14]

這部分不難，但的確是 bridge 需要自行包掉的額外責任；也因此更凸顯 transport-first 設計的優勢，因為 transport mode 根本不需要處理 gRPC-Web wire bytes。[^^2][^^12]

### 7.2 response 可以先做「一次性完整 body」，再視需要升級成真正 streaming

gRPC-Web server-streaming 本質上是「一個 HTTP response body 裡有多個 data frame，最後一個是 trailer frame」。因此 bridge 的第一版完全可以把所有 response message 先組成完整 `Uint8Array`，再一次用 `HttpResponse.arrayBuffer()` 或原生 `Response` 回傳。這樣雖然不是漸進式串流，但對大多數前端測試已經足夠，而且 wire format 仍正確。[^^5][^^10][^^15]

若你後續真的需要模擬逐筆串流延遲，MSW 文件明確說可以直接在 response resolver 回傳原生 `Response`，而 `HttpResponse` 的 call signature 也接受 `ReadableStream` 類型的 body；這意味著第二版 bridge 完全可以升級成用 `ReadableStream<Uint8Array>` 慢慢推 frame。[^^15]

## 8. 如果真的要做成可重用 npm lib，我會怎麼切 package API

### 8.1 單一 package、subpath exports

若你希望「專案中引入很簡單」，我會建議做成**單一 npm package**，但用 subpath exports 區分能力：

- `@your-scope/protobuf-ts-grpc-mock`
- `@your-scope/protobuf-ts-grpc-mock/msw`

主 entry 只依賴 `@protobuf-ts/runtime-rpc`，提供 registry 與 mock transport；`/msw` entry 再額外依賴 `msw` 與 `@protobuf-ts/grpcweb-transport`。這樣不需要用 `msw` 的專案也不會被強迫帶入瀏覽器攔截相關相依性，同時仍維持「這就是一個 library」的心理模型。[^^2][^^9][^^10]

### 8.2 主要型別建議

```ts
// 建議型別草圖（非現有 API）
type UnaryResolver<I extends object, O extends object> = (
  ctx: GrpcMockContext<I>,
) => MaybePromise<O | GrpcMockReply<O>>

type ServerStreamResolver<I extends object, O extends object> = (
  ctx: GrpcMockContext<I>,
) => MaybePromise<Iterable<O> | AsyncIterable<O> | GrpcMockStreamReply<O>>

interface GrpcMockContext<I extends object> {
  request: I
  meta: RpcMetadata
  method: MethodInfo<I, any>
  signal?: AbortSignal
  passthrough(): Promise<never>
}
```

這樣的 API 可以同時利用 `RpcOptions.meta`、`AbortSignal`、`MethodInfo` 與 `MethodInfo.I/O` 的能力，也很貼近 `msw` resolver 的心智模型。[^^6][^^14]

## 9. 環境變數切換，對你目前的專案型態是低侵入方案

因為現有前端專案本來就是直接引入打包後的 req 與 client，最適合的整合點是建立一個 `createApiTransport()` 或 `createClients()` 工廠。這個工廠裡用環境變數切換 mock / real transport，等於把 mock 啟用策略集中管理，而不需要到每個呼叫點做條件分支。[^^2][^^3]

建議整合方式：

1. `VITE_ENABLE_API_MOCK=true`（或你慣用的 env 名稱）時，建立 mock registry 與 mock transport。
2. 若同時需要 network-level 觀察，再啟動 `setupWorker(...createGrpcMswHandlers(...))`。
3. 否則使用 `GrpcWebFetchTransport` 指向真實 backend / proxy。[^^6][^^7]

這種做法最大的優勢，是你可以讓「mock 是否啟用」從業務程式碼中完全抽離，只留下 transport factory 是唯一的切換點。[^^2][^^3]

## 10. 實務風險與注意事項

### 10.1 若要靠 `msw` 處理 binary request，至少要站在 MSW 2.x

MSW 過去確實存在 binary request body 在某些情境被轉碼汙染的問題，但 maintainer 在 issue #1442 後續回覆中確認：依賴標準 Fetch API 的 MSW 2.x 已解決這個問題，提交的測試也已通過。因此若你的 bridge 需要 `req.arrayBuffer()` 正常處理 protobuf bytes，請把 `msw` v2+ 視為基線，而不要支援舊版行為。[^^17]

### 10.2 `msw` 不是 mock transport 的替代品，而是可選觀測層

`setupWorker()` 與 `setupServer()` 都很適合用來攔截網路流量，但從架構上看，它們解決的是「在哪裡攔截」，不是「如何利用 protobuf reflection 建立型別安全 mock」。這就是為什麼我會建議把 `msw` 放在 bridge 層，而不是整個 library 的唯一核心。[^^4][^^7][^^8]

### 10.3 `passthrough` 要做，而且要像 `msw` 一樣明確

`msw` 的一大優點是可以只 mock 部分 request，其他 request 照樣打到真實 API。你的 transport mode 也應該保留相同概念：若某個 method 沒有註冊 mock，可以選擇：

1. 丟出類似 `onUnhandledRequest` 的明確錯誤。
2. 導到 fallback real transport。

這樣才能在大型專案裡逐步導入，而不是一次全量切換。[^^4][^^7]

## 結論

**結論是：可以，而且很值得做。** 但我不建議把它定義成「幫 `msw` 補 gRPC-Web 支援」而已；更好的定位是：**一個以 `protobuf-ts` 為核心的型別安全 gRPC mock library，並提供 `msw` 風格的宣告式 API 與可選的 MSW bridge**。[^^2][^^3][^^10][^^11]

如果以你的專案現況為前提，我會推薦這個優先順序：

1. 先做 `transport-first` 的 mock registry + mock transport。
2. 以 `binary`、`unary`、`serverStreaming` 作為 MVP。
3. 再做 `msw` bridge，把同一套 registry 轉成 `http.post()` handlers。
4. 最後補 `passthrough`、`delay`、`trailers`、`ReadableStream` 級 streaming 模擬。[^^5][^^6][^^9][^^15]

這樣做出來的 npm lib，既能保有 `msw` 的簡潔設定體驗，又能真正吃到 `protobuf-ts` 帶來的 service/method reflection 與型別安全，對你描述的「proto 專案打包、前端直接引入 generated req/client」工作流是高度相容的。[^^3][^^14]

## Confidence Assessment

### 高信心（直接由原始碼或官方文件驗證）

- `protobuf-ts` generated client 的核心 seam 是 `RpcTransport`，不是綁死 `GrpcWebFetchTransport`。[^^2][^^3]
- `protobuf-ts` 已提供足夠的 reflection 資訊（`MethodInfo` / `ServiceInfo`）與現成 `TestTransport`，很適合衍生出型別安全 mock library。[^^9][^^14]
- `@protobuf-ts/grpcweb-transport` 已公開匯出 gRPC-Web frame helper，因此可直接用來做 `msw` bridge。[^^10]
- `msw` 目前沒有一級 gRPC API，但社群已證明可透過手動 framing 在 `msw` 內 mock gRPC-Web。[^^11][^^13]
- `msw` 2.x 已修復 binary request body 汙染問題，適合作為 protobuf bytes 的橋接層。[^^17]

### 中信心（依原始碼推得出的架構建議）

- 「transport-first + optional MSW bridge」是最適合你情境的 package 形態。這不是現成官方結論，而是根據 `RpcTransport` seam、公開 helper、MSW 的 HTTP 抽象與 gRPC-Web framing 成本所做的架構判斷。[^^2][^^4][^^10][^^12]
- 以 `binary` 作為預設 wire format、`text` 作為可選，是合理的 library 預設值。這是根據 `GrpcWebFetchTransport` 支援格式、官方 browser example 與 gRPC-Web spec 的 base64 chunk 特性推論出的實務建議。[^^5][^^6][^^16]

### 低信心／需在你的實際專案驗證

- 最終 API 命名（例如 `mock.unary()`、`createGrpcMswHandlers()`）與 env var 命名（例如 `VITE_ENABLE_API_MOCK`）屬於產品設計與專案慣例，不是上游專案既有標準。
- 若你們的 proto 打包流程在 client export 形式上做了額外包裝，library 最終要吃「service descriptor」還是「client class」可能要依實際產物微調。

## Footnotes

[^^1]: [timostamm/protobuf-ts](https://github.com/timostamm/protobuf-ts) `README.md`（commit `657e64e80009e503e94f608fda423fbcbf4fb5a7`），README 明確列出可產生 gRPC-Web client，且整體定位為 TypeScript 的 protobuf + RPC 工具鏈。

[^^2]: [timostamm/protobuf-ts](https://github.com/timostamm/protobuf-ts) `packages/runtime-rpc/src/rpc-transport.ts:10-15,36-72`（commit `657e64e80009e503e94f608fda423fbcbf4fb5a7`）。

[^^3]: [timostamm/protobuf-ts](https://github.com/timostamm/protobuf-ts) `packages/example-browser-grpcweb-transport-client/eliza.client.ts:19-32,76-111`（commit `657e64e80009e503e94f608fda423fbcbf4fb5a7`）。

[^^4]: [mswjs/msw](https://github.com/mswjs/msw) `src/core/http.ts:14-26,46-64`、`README.md` 的 browser / node 使用範例與「network-level interception」說明（commit `ef56f844d69983a87057b04c65d62166985b123b`）。

[^^5]: [grpc/grpc](https://github.com/grpc/grpc) `doc/PROTOCOL-WEB.md`，Content-Type、frame type、trailers 與 bidi-streaming 限制段落。

[^^6]: [timostamm/protobuf-ts](https://github.com/timostamm/protobuf-ts) `packages/grpcweb-transport/src/grpc-web-transport.ts:28-35,65-69,88-110,196-218`（commit `657e64e80009e503e94f608fda423fbcbf4fb5a7`）。

[^^7]: [mswjs/msw](https://github.com/mswjs/msw) `src/browser/setupWorker/setupWorker.ts:27-64,66-141,143-184`（commit `ef56f844d69983a87057b04c65d62166985b123b`）。

[^^8]: [mswjs/msw](https://github.com/mswjs/msw) `src/node/SetupServerApi.ts:19-24,51-66`（commit `ef56f844d69983a87057b04c65d62166985b123b`）。

[^^9]: [timostamm/protobuf-ts](https://github.com/timostamm/protobuf-ts) `packages/runtime-rpc/src/test-transport.ts:16-60,63-124,155-222,258-351,372-418`（commit `657e64e80009e503e94f608fda423fbcbf4fb5a7`）。

[^^10]: [timostamm/protobuf-ts](https://github.com/timostamm/protobuf-ts) `packages/grpcweb-transport/src/index.ts:1-13`、`packages/runtime-rpc/src/index.ts:1-28`（commit `657e64e80009e503e94f608fda423fbcbf4fb5a7`）。

[^^11]: [mswjs/msw issue #238](https://github.com/mswjs/msw/issues/238)，特別是 maintainer `kettanaito` 在 2021-05-12 與 2022-10-01 的留言，以及社群在 2020-09-15、2023-02-22 關於手動 framing 的討論。

[^^12]: [timostamm/protobuf-ts](https://github.com/timostamm/protobuf-ts) `packages/grpcweb-transport/src/grpc-web-format.ts:9-49,52-74,141-229,288-309`（commit `657e64e80009e503e94f608fda423fbcbf4fb5a7`）。

[^^13]: Lucas Levin，〈[Mocking gRPC-web requests for integration testing](https://lucas-levin.com/code/blog/mocking-grpc-web-requests-for-integration-testing)〉，文中示範在 `msw` 裡手動建立 data frame 與 trailer frame 後回傳 `ArrayBuffer`。

[^^14]: [timostamm/protobuf-ts](https://github.com/timostamm/protobuf-ts) `packages/runtime-rpc/src/reflection-info.ts:4-25,27-102,121-175`、`packages/runtime-rpc/src/service-type.ts:6-30`（commit `657e64e80009e503e94f608fda423fbcbf4fb5a7`）。

[^^15]: [MSW HttpResponse 文件](https://mswjs.io/docs/api/http-response)，其中說明可直接回傳原生 `Response`，且 `HttpResponse` 建構子接受 `ReadableStream` / `ArrayBuffer` 等 body 類型。

[^^16]: [timostamm/protobuf-ts](https://github.com/timostamm/protobuf-ts) `packages/example-browser-grpcweb-transport-client/client.ts:5-12`（commit `657e64e80009e503e94f608fda423fbcbf4fb5a7`）。

[^^17]: [mswjs/msw issue #1442](https://github.com/mswjs/msw/issues/1442)，特別是 maintainer `kettanaito` 在 2023-10-23 與 2023-11-16 的留言，確認此問題已在 `msw` 2.x 解決。
