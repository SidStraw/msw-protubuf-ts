# @sidtw/protobuf-ts-grpc-mock

Typed gRPC-Web mock transport for `protobuf-ts` clients.

這個套件提供一層以 `RpcTransport` 為核心的 mock 機制。你可以用 generated `protobuf-ts` service metadata 註冊 typed unary / server-streaming handlers，再把 mock transport 注入既有 generated clients。它不是 HTTP layer mock，也不依賴 MSW；目標是讓 gRPC-Web client 在瀏覽器、Vite playground、Vitest 或本機開發環境中，用接近 MSW GraphQL fixture 的方式定義 mock。

## 支援範圍

| 功能 | 狀態 |
| --- | --- |
| Unary RPC | 支援 |
| Server streaming RPC | 支援 |
| `grpc.reply()` delay / headers / trailers | 支援 |
| `grpc.error()` / `RpcError` 傳遞 | 支援 |
| `fallbackTransport` / `ctx.passthrough()` | 支援 |
| Session stateful mocks | 支援 |
| 既有 `RpcInterceptor` pipeline | 支援 |
| Client streaming | `UNIMPLEMENTED` |
| Duplex streaming | `UNIMPLEMENTED` |
| MSW bridge / `./msw` export | 不包含 |

## 安裝

```sh
pnpm add @sidtw/protobuf-ts-grpc-mock @protobuf-ts/runtime @protobuf-ts/runtime-rpc
```

`@protobuf-ts/runtime` 與 `@protobuf-ts/runtime-rpc` 是 peer dependencies。實際專案通常已經因為 generated `protobuf-ts` client 而安裝它們。

如果你的專案需要真實 gRPC-Web transport，也會需要安裝：

```sh
pnpm add @protobuf-ts/grpcweb-transport
```

## 快速開始

```ts
import {
  createGrpcMockRegistry,
  createGrpcMockTransport,
  grpc,
} from '@sidtw/protobuf-ts-grpc-mock'

import { GreeterClient, GreeterService } from './gen/greeter.client'

const registry = createGrpcMockRegistry()

registry.register(
  grpc.unary(GreeterService, 'sayHello', ({ request }) => ({
    message: `Hello, ${request.name}!`,
  })),
  grpc.serverStreaming(GreeterService, 'watchGreetings', ({ request }) => [
    { message: `${request.name}-1` },
    { message: `${request.name}-2` },
  ]),
)

const transport = createGrpcMockTransport({ registry })
const client = new GreeterClient(transport)

const hello = await client.sayHello({ name: 'Ada' })
```

`registry.register()` 可以一次註冊多個 handlers。registry 以 `service.typeName` 加上 method name 做 key，因此多個 generated clients 共用同一個 transport 時，不會因為不同 service 有同名 method 而互相覆蓋。

## 像 playground 一樣放進現有專案

playground 採用的模式可以直接搬到既有 Vite + React 專案：保留你的 generated clients、集中建立 transport，並把 mocks 拆成「每個 client 一個目錄、每個 method 一個檔案」。

建議檔案結構：

```txt
src/
  api/
    clients.ts
    transport.ts
  gen/
    greeter.client.ts
    greeter.ts
    article.client.ts
    article.ts
  mocks/
    index.ts
    greeter/
      say-hello.ts
      watch-greetings.ts
    article/
      session.ts
      list-tags.ts
      add-tag-to-article.ts
```

### 1. 在 method 檔案定義 mock

Static unary response 適合單純 fixture，寫法會接近 MSW GraphQL：

```ts
// src/mocks/article/list-tags.ts
import { grpc } from '@sidtw/protobuf-ts-grpc-mock'

import { ArticleService } from '../../gen/article.client'

export default grpc.unary(ArticleService, 'listTags', {
  tags: [
    { id: 'tag-1', label: 'typescript' },
    { id: 'tag-2', label: 'grpc-web' },
  ],
})
```

需要讀 request、metadata、延遲、headers、trailers 或丟錯時，改用 resolver：

```ts
// src/mocks/greeter/say-hello.ts
import { grpc } from '@sidtw/protobuf-ts-grpc-mock'

import { GreeterService } from '../../gen/greeter.client'

export default grpc.unary(GreeterService, 'sayHello', ({ meta, request }) => {
  if (request.name === 'missing') {
    throw grpc.error('NOT_FOUND', '找不到這位使用者', {
      'x-reason': 'playground-demo',
    })
  }

  return grpc.reply(
    { message: `Hello, ${request.name}!` },
    {
      delay: 150,
      headers: { 'x-mock': 'true' },
      trailers: { 'x-mock-finished': 'true' },
    },
  )
})
```

Server streaming 目前維持 resolver-based API：

```ts
// src/mocks/greeter/watch-greetings.ts
import { grpc } from '@sidtw/protobuf-ts-grpc-mock'

import { GreeterService } from '../../gen/greeter.client'

export default grpc.serverStreaming(
  GreeterService,
  'watchGreetings',
  async function* ({ request }) {
    for (let index = 1; index <= 3; index += 1) {
      yield { message: `${request.name}-${index}` }
    }
  },
)
```

### 2. 用 session state 模擬 mutation 後 query 更新

`createGrpcMockRegistry()` 可以持有一份 typed session。所有透過同一個 registry 建出的 mock transport 會共用這份 session；resolver 可透過 `ctx.session` 讀寫目前 mock session 的資料。

```ts
// src/mocks/article/session.ts
import { createGrpcMockSession } from '@sidtw/protobuf-ts-grpc-mock'

type ArticleTag = {
  id: string
  label: string
}

export type ArticleMockState = {
  tags: ArticleTag[]
}

export const articleSession = createGrpcMockSession<ArticleMockState>({
  tags: [
    { id: 'tag-1', label: 'typescript' },
    { id: 'tag-2', label: 'grpc-web' },
  ],
})
```

```ts
// src/mocks/article/list-tags.ts
import { grpc } from '@sidtw/protobuf-ts-grpc-mock'

import { ArticleService } from '../../gen/article.client'
import type { ListTagsRequest, ListTagsResponse } from '../../gen/article'
import type { ArticleMockState } from './session'

export default grpc.unary<ListTagsRequest, ListTagsResponse, ArticleMockState>(
  ArticleService,
  'listTags',
  ({ session }) => ({
    tags: [...session.getState().tags],
  }),
)
```

```ts
// src/mocks/article/add-tag-to-article.ts
import { grpc } from '@sidtw/protobuf-ts-grpc-mock'

import { ArticleService } from '../../gen/article.client'
import type {
  AddTagToArticleRequest,
  AddTagToArticleResponse,
} from '../../gen/article'
import type { ArticleMockState } from './session'

export default grpc.unary<
  AddTagToArticleRequest,
  AddTagToArticleResponse,
  ArticleMockState
>(ArticleService, 'addTagToArticle', ({ request, session }) => {
  const label = request.label.trim()

  if (label === '') {
    throw grpc.error('INVALID_ARGUMENT', 'label 不可為空')
  }

  const state = session.update((current) => ({
    tags: [
      ...current.tags,
      { id: request.tagId || `tag-${current.tags.length + 1}`, label },
    ],
  }))

  return {
    articleId: request.articleId,
    tags: [...state.tags],
  }
})
```

這個模式可以還原常見的 MSW 使用體驗：先呼叫 mutation 更新 mock session，再呼叫 query 時讀到同一個 session 裡的新資料。

在建立 registry 時傳入 session，就能讓 `ctx.session` 保持同一份狀態：

```ts
import { createGrpcMockRegistry } from '@sidtw/protobuf-ts-grpc-mock'

import { articleSession } from './article/session'

const registry = createGrpcMockRegistry({ session: articleSession })
registry.register(...mockHandlers)
```

`session.update()` 是建議的寫入方式，適合 read-modify-write；請把「讀目前 state、計算下一個 state」放在同一個 `update()` callback 內完成。`session.reset()` 會回到建立 session 時的 initial snapshot，方便在測試或 playground reset button 中清掉目前 session。

Session state 會透過 `structuredClone()` 複製，因此 initial state 應該只放可 clone 的 plain data；不要放 function、DOM node、WeakMap、WeakSet 或依賴 prototype method 的 class instance。

### 3. 集中匯出 handlers

```ts
// src/mocks/index.ts
import addTagToArticle from './article/add-tag-to-article'
import listTags from './article/list-tags'
import sayHello from './greeter/say-hello'
import watchGreetings from './greeter/watch-greetings'

export const mockHandlers = [
  sayHello,
  watchGreetings,
  listTags,
  addTagToArticle,
]
```

### 4. 建立可切換 mock / real API 的 transport

在 Vite 專案中，建議只在一個 factory 裡切換 transport。mock 開啟時使用 `createGrpcMockTransport()`，並把真實 transport 傳入 `fallbackTransport`；沒有註冊 mock 的 method 會自動打真實 API。

```ts
// src/api/transport.ts
import type { RpcTransport } from '@protobuf-ts/runtime-rpc'
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport'

import { mockHandlers } from '../mocks'

export async function createApiTransport(): Promise<RpcTransport> {
  const realTransport = new GrpcWebFetchTransport({
    baseUrl: import.meta.env.VITE_API_URL,
  })

  if (import.meta.env.VITE_ENABLE_API_MOCK !== 'true') {
    return realTransport
  }

  const { createGrpcMockRegistry, createGrpcMockTransport } = await import(
    '@sidtw/protobuf-ts-grpc-mock'
  )

  const registry = createGrpcMockRegistry()
  registry.register(...mockHandlers)

  return createGrpcMockTransport({
    registry,
    fallbackTransport: realTransport,
  })
}
```

用 dynamic `import()` 包住 mock branch，可以讓 bundler 在 production 環境變數固定為 `false` 時更容易移除 mock runtime。

### 5. 多個 generated clients 共用同一個 transport

```ts
// src/api/clients.ts
import { ArticleServiceClient } from '../gen/article.client'
import { GreeterServiceClient } from '../gen/greeter.client'
import { createApiTransport } from './transport'

export async function createApiClients() {
  const transport = await createApiTransport()

  return {
    article: new ArticleServiceClient(transport),
    greeter: new GreeterServiceClient(transport),
  }
}
```

mock 是否命中是 method-level 行為，不是 client-level 開關。只要某個 service method 有註冊 handler，就走 mock；沒有註冊且有 `fallbackTransport`，就走真實 API。

## 用環境變數控制 mock

Vite 只會把 `VITE_` 前綴的變數暴露到瀏覽器端，因此建議使用：

```env
VITE_API_URL=http://localhost:8080
VITE_ENABLE_API_MOCK=false
```

本機需要開 mock 時，可以在 `.env.local` 設定：

```env
VITE_ENABLE_API_MOCK=true
```

Production 建議明確關閉：

```env
VITE_ENABLE_API_MOCK=false
```

判斷方式建議維持嚴格字串比較：

```ts
const enableMock = import.meta.env.VITE_ENABLE_API_MOCK === 'true'
```

不要用 truthy 判斷，因為 `"false"` 在 JavaScript 中仍然是真值。

## Fallback transport 與 passthrough

`fallbackTransport` 適合漸進式導入：只 mock 目前需要的 method，其他 method 維持打真實 API。

```ts
const transport = createGrpcMockTransport({
  registry,
  fallbackTransport: realTransport,
})
```

Resolver 也可以明確委派給真實 API：

```ts
registry.register(
  grpc.unary(GreeterService, 'sayHello', ({ passthrough }) => passthrough()),
)
```

## 使用既有 `RpcInterceptor`

這個套件不會匯入 `window`、瀏覽器 DevTools 或 MSW。Interceptors 仍然透過 `RpcOptions` 傳入，因此 mock mode 與 real transport mode 可以共用相同的 interceptor 行為。

```ts
import { createGrpcMockTransport } from '@sidtw/protobuf-ts-grpc-mock'
import { devtoolsInterceptor } from './devtools'

const transport = createGrpcMockTransport({ registry })

await client.sayHello(
  { name: 'Ada' },
  { interceptors: [devtoolsInterceptor] },
)
```

## Playground

本 repo 內含一個 Vite + React playground，作為 consumer-style 範例。它從 `playground/proto/*.proto` 開始，透過 `protobuf-ts` codegen 產生 client，並展示兩個 generated clients 共用同一個 mock transport。

```sh
pnpm install
pnpm playground:gen
pnpm playground:dev
```

Production build 檢查：

```sh
pnpm playground:build
```

playground 展示內容包含：

- unary mock responses、headers、trailers、metadata 與 delay。
- resolver 丟出 `RpcError` 後由 UI 顯示錯誤狀態。
- server-streaming responses 從 async iterable 逐筆送出。
- `GreeterServiceClient` 與 `ArticleServiceClient` 共用同一個 mock transport。
- `playground/src/mocks/` 依 client 目錄與 method 檔案拆分。
- `addTagToArticle()` 更新 session state 後，`listTags()` 讀到更新後資料。

playground 不會進入 npm package；發佈內容由 root `package.json` 的 `files` whitelist 控制。

## API reference

### Values

| Export | Description |
| --- | --- |
| `createGrpcMockRegistry()` | 建立以 service/method key 管理 handlers 的 mutable registry。 |
| `createGrpcMockSession(initialState)` | 建立 resolver context 可使用的 typed session state。 |
| `createGrpcMockTransport(options)` | 建立 mock `RpcTransport`。 |
| `MockRpcTransport` | factory 內使用的 `RpcTransport` 實作。 |
| `grpc.unary()` | 建立 unary handler，第三個參數可為 resolver 或 static response。 |
| `grpc.serverStreaming()` | 建立 server-streaming handler。 |
| `grpc.error()` | 建立 `RpcError` 的 helper。 |
| `grpc.reply()` | 建立包含 delay、headers、trailers 的回應 helper。 |

### Types

| Export | Description |
| --- | --- |
| `DeepReadonly<T>` | `session.getState()` 與 `session.update()` 回傳的深層 readonly state type。 |
| `GrpcMockContext<I, O>` | Resolver context，包含 `request`、`method`、`meta`、`signal`、`session` 與 `passthrough()`。 |
| `GrpcMockRegistry` | transport factory 使用的 registry contract。 |
| `GrpcMockSession<TState>` | Session state API，包含 `getState()`、`update()` 與 `reset()`。 |
| `MockHandler` | `grpc.unary()` 或 `grpc.serverStreaming()` 建立的 registration object。 |
| `UnaryMockValue<O>` | Unary mock 可回傳的 static response 或 `grpc.reply()` value。 |
| `UnaryResolver<I, O>` | Unary method resolver type。 |
| `ServerStreamResolver<I, O>` | Server-streaming method resolver type。 |
| `StreamController<O>` | Imperative stream API，包含 `send()`、`complete()` 與 `error()`。 |

## 為什麼不直接依賴 MSW

這個套件 mock 的位置是 `RpcTransport`，不是 HTTP layer。這樣可以：

- 在 decoded message level 保持完整 TypeScript 型別。
- 在 Vitest、Node integration tests 與本機開發共用同一份 registry。
- 避免主套件強制依賴 `msw` 或 `@protobuf-ts/grpcweb-transport`。

如果未來需要 MSW bridge，建議以獨立 entry 或獨立套件處理，而不是擴張目前主 entry。

## 與 `TestTransport` 的差異

`@protobuf-ts/runtime-rpc` 已經提供 `TestTransport`，但它偏低階 fixture。`@sidtw/protobuf-ts-grpc-mock` 補上：

- 以 service + method 註冊，而不是直接組 transport fixture object。
- `grpc.reply()`、delay、metadata、headers、trailers 與 typed errors。
- `fallbackTransport` / `passthrough()`，方便漸進導入。
- 與一般 generated client / interceptor 使用方式維持一致。

## 發佈設定

- package name：`@sidtw/protobuf-ts-grpc-mock`
- package scope：`@sidtw`
- access：public
- env flag：`VITE_ENABLE_API_MOCK`
- module format：ESM-only
- CJS build：不包含

## Non-goals

- 不提供 MSW bridge。
- 不提供 `./msw` subpath export。
- 不依賴 `msw`。
- 不支援 client-streaming 或 duplex gRPC-Web methods。
