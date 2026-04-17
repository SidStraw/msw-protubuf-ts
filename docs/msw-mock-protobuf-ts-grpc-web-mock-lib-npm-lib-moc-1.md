# MSW + protobuf-ts：建構型別安全的 gRPC-Web Mock Library 可行性深度研究

## Executive Summary

**完全可行**。基於 MSW 的攔截機制搭配 protobuf-ts 的 runtime 型別系統，可以打造一個如 MSW 般簡潔、同時具備 gRPC 型別安全的 npm mock library。本研究分析了兩條主要路徑——**MSW HTTP 層攔截**與**Mock RpcTransport 替換**——並推薦採用 **Mock RpcTransport** 作為核心方案，搭配可選的 MSW HTTP handler 作為進階整合層。protobuf-ts 生成的 `ServiceInfo`、`MethodInfo`、`IMessageType<T>` 提供了完整的 runtime 反射資訊，使得型別推導與序列化/反序列化完全可以在 library 內部自動完成，使用者只需提供純 TypeScript 物件作為 mock 回應即可。

---

## 目錄

1. [技術背景分析](#1-技術背景分析)
2. [gRPC-Web 協定格式解析](#2-grpc-web-協定格式解析)
3. [protobuf-ts 的 Runtime 架構](#3-protobuf-ts-的-runtime-架構)
4. [MSW v2 Handler 機制分析](#4-msw-v2-handler-機制分析)
5. [方案一：MSW HTTP 層攔截](#5-方案一msw-http-層攔截)
6. [方案二：Mock RpcTransport（推薦）](#6-方案二mock-rpctransport推薦)
7. [方案三：混合架構](#7-方案三混合架構)
8. [推薦 API 設計](#8-推薦-api-設計)
9. [npm Library 封裝設計](#9-npm-library-封裝設計)
10. [環境變數切換機制](#10-環境變數切換機制)
11. [現有生態系分析](#11-現有生態系分析)
12. [與 ConnectRPC 方案的比較](#12-與-connectrpc-方案的比較)
13. [實作路線圖](#13-實作路線圖)
14. [Confidence Assessment](#14-confidence-assessment)
15. [Footnotes](#15-footnotes)

---

## 1. 技術背景分析

### 1.1 使用者目前的工作流程

```
┌──────────────┐    protobuf-ts     ┌──────────────────────┐
│  .proto 檔案  │ ──── 編譯 ────▶  │ 產出 TypeScript 檔案：  │
│  (proto 專案)  │                  │  - *_pb.ts (Message)   │
└──────────────┘                   │  - *_client.ts (Client)│
                                   └──────────┬───────────┘
                                              │ npm install / copy
                                              ▼
                                   ┌──────────────────────┐
                                   │   前端專案直接 import   │
                                   │   打包好的型別與 client  │
                                   └──────────────────────┘
```

protobuf-ts 的 code generator 會為每個 service 產出[^1]：
- **Message types**：`interface` + `IMessageType<T>` 實例（包含 `toBinary`、`fromBinary`、`toJson`、`fromJson`）
- **Service client**：繼承自 `ServiceType`，包含 `ServiceInfo` 與 `MethodInfo[]` runtime 元資料
- **Client stub**：接受 `RpcTransport` 作為唯一建構參數

### 1.2 核心需求

| 需求 | 說明 |
|------|------|
| npm library 形式 | 可被任何使用 protobuf-ts + gRPC-Web 的專案引入 |
| 環境變數切換 | 透過 `VITE_ENABLE_MOCK=true` 等方式開關 mock |
| MSW 風格 API | handler 定義方式直覺、簡潔 |
| gRPC 型別安全 | mock response 必須符合 proto message 型別 |
| 支援 unary + server streaming | gRPC-Web 支援的兩種 RPC 模式 |

---

## 2. gRPC-Web 協定格式解析

gRPC-Web 是 gRPC 的 HTTP/1.1 變體，使其能在瀏覽器中運行[^2]。理解其協定格式是建構 mock 的關鍵。

### 2.1 HTTP 請求格式

```
POST /{package.ServiceName}/{MethodName} HTTP/1.1
Content-Type: application/grpc-web+proto  (binary)
             application/grpc-web-text    (base64)
X-Grpc-Web: 1

Body: [Frame]
```

### 2.2 Frame 結構

```
┌─────────┬──────────────┬───────────────┐
│ 1 byte  │   4 bytes    │  N bytes      │
│  type   │  length (BE) │  payload      │
├─────────┼──────────────┼───────────────┤
│  0x00   │  msg length  │  protobuf msg │  ← DATA frame
│  0x80   │  trailer len │  trailer text │  ← TRAILER frame
└─────────┴──────────────┴───────────────┘
```

protobuf-ts 的 `grpc-web-format.ts` 中，`createGrpcWebRequestBody` 負責建立 request frame，`readGrpcWebResponseBody` 負責解析 response frame[^3]。

### 2.3 Response 結構

一個完整的 unary response 包含兩個 frame：
1. **DATA frame** (0x00)：包含序列化的 protobuf response message
2. **TRAILER frame** (0x80)：包含 `grpc-status: 0\r\ngrpc-message: ` 等 trailer 資訊

這意味著如果要在 MSW HTTP 層攔截，我們必須手動建構這個二進位 frame 結構。

---

## 3. protobuf-ts 的 Runtime 架構

### 3.1 核心型別系統

```
┌─────────────────────────────────────────────────┐
│                 RpcTransport                      │
│  (interface)                                      │
│  ├── mergeOptions(options?)                       │
│  ├── unary<I,O>(method, input, options)           │
│  ├── serverStreaming<I,O>(method, input, options)  │
│  ├── clientStreaming<I,O>(method, options)         │
│  └── duplex<I,O>(method, options)                 │
└────────────────────┬────────────────────────────┘
                     │ implements
        ┌────────────┴────────────┐
        │  GrpcWebFetchTransport  │
        │  TwirpFetchTransport    │
        │  ★ MockRpcTransport ★   │  ← 我們要建立的
        └─────────────────────────┘
```

**`RpcTransport` interface** 是 protobuf-ts 整個 RPC 系統的核心抽象[^4]。它定義了四個方法：

```typescript
export interface RpcTransport {
    mergeOptions(options?: Partial<RpcOptions>): RpcOptions;
    unary<I extends object, O extends object>(
        method: MethodInfo<I, O>, input: I, options: RpcOptions
    ): UnaryCall<I, O>;
    serverStreaming<I extends object, O extends object>(
        method: MethodInfo<I, O>, input: I, options: RpcOptions
    ): ServerStreamingCall<I, O>;
    clientStreaming<I extends object, O extends object>(
        method: MethodInfo<I, O>, options: RpcOptions
    ): ClientStreamingCall<I, O>;
    duplex<I extends object, O extends object>(
        method: MethodInfo<I, O>, options: RpcOptions
    ): DuplexStreamingCall<I, O>;
}
```

### 3.2 MethodInfo 攜帶完整型別資訊

```typescript
export interface MethodInfo<I extends object = any, O extends object = any> {
    readonly service: ServiceInfo;
    readonly name: string;            // "SayHello"
    readonly localName: string;       // "sayHello"
    readonly I: IMessageType<I>;      // 輸入 message 型別（含 encode/decode）
    readonly O: IMessageType<O>;      // 輸出 message 型別（含 encode/decode）
    readonly serverStreaming: boolean;
    readonly clientStreaming: boolean;
}
```

**關鍵發現**：`MethodInfo.I` 和 `MethodInfo.O` 都是 `IMessageType<T>` 實例，包含 `toBinary`、`fromBinary`、`create` 等方法[^5]。這意味著在 mock transport 中，我們可以直接利用這些型別資訊來驗證和序列化回應，**無需使用者手動處理 protobuf 編碼**。

### 3.3 UnaryCall 回傳結構

```typescript
export class UnaryCall<I, O> implements PromiseLike<FinishedUnaryCall<I, O>> {
    readonly method: MethodInfo<I, O>;
    readonly requestHeaders: RpcMetadata;
    readonly request: I;
    readonly headers: Promise<RpcMetadata>;
    readonly response: Promise<O>;       // ← 直接是 typed object
    readonly status: Promise<RpcStatus>;
    readonly trailers: Promise<RpcMetadata>;
}
```

`UnaryCall` 已經 implement `PromiseLike`，所以使用者可以直接 `await` 得到 `FinishedUnaryCall`[^6]。

---

## 4. MSW v2 Handler 機制分析

### 4.1 Handler 繼承體系

```
RequestHandler (abstract)
├── HttpHandler          ← http.get(), http.post()
└── GraphQLHandler       ← graphql.query(), graphql.mutation()
    └── ★ GrpcHandler ★  ← 我們可以建立的
```

MSW v2 的 `RequestHandler` 提供了清晰的擴展點[^7]：

```typescript
abstract class RequestHandler<HandlerInfo, ParsedResult, ResolverExtras> {
    abstract predicate(args): boolean | Promise<boolean>;
    abstract log(args): void;
    async parse(args): Promise<ParsedResult>;
    protected extendResolverArgs(args): ResolverExtras;
}
```

### 4.2 GraphQLHandler 作為範例

MSW 的 `GraphQLHandler` 是建構自訂 handler 的最佳參考[^8]：
- 它在 `parse()` 中解析 request body 取得 operation name 和 variables
- 在 `predicate()` 中比對 operation type 和 name
- 在 `extendResolverArgs()` 中將解析後的資料傳給 resolver

同理，我們的 `GrpcHandler` 可以：
- 在 `parse()` 中解碼 gRPC-Web frame + protobuf message
- 在 `predicate()` 中比對 service name + method name
- 在 `extendResolverArgs()` 中傳入 typed request message

---

## 5. 方案一：MSW HTTP 層攔截

### 5.1 原理

直接在 HTTP 層攔截 gRPC-Web 的 POST 請求，解碼 protobuf request，建構 protobuf response frame。

### 5.2 實作概念

```typescript
// 使用者端 API
import { grpc } from 'grpc-web-mock';
import { GreeterService, SayHelloRequest, SayHelloResponse } from './gen/greeter';

export const handlers = [
  grpc.unary(GreeterService, 'sayHello', ({ request }) => {
    // request: SayHelloRequest (typed!)
    return SayHelloResponse.create({
      message: `Hello, ${request.name}!`
    });
  }),
];
```

### 5.3 內部實作（核心邏輯）

```typescript
import { http, HttpResponse } from 'msw';

function createGrpcWebResponse(message: Uint8Array): ArrayBuffer {
  // DATA frame: 0x00 + 4-byte length + message
  const dataFrame = new Uint8Array(5 + message.length);
  dataFrame[0] = 0x00;
  const len = message.length;
  dataFrame[1] = (len >> 24) & 0xff;
  dataFrame[2] = (len >> 16) & 0xff;
  dataFrame[3] = (len >> 8) & 0xff;
  dataFrame[4] = len & 0xff;
  dataFrame.set(message, 5);

  // TRAILER frame: 0x80 + trailer
  const trailerStr = 'grpc-status:0\r\ngrpc-message:\r\n';
  const trailerBytes = new TextEncoder().encode(trailerStr);
  const trailerFrame = new Uint8Array(5 + trailerBytes.length);
  trailerFrame[0] = 0x80;
  const tLen = trailerBytes.length;
  trailerFrame[1] = (tLen >> 24) & 0xff;
  trailerFrame[2] = (tLen >> 16) & 0xff;
  trailerFrame[3] = (tLen >> 8) & 0xff;
  trailerFrame[4] = tLen & 0xff;
  trailerFrame.set(trailerBytes, 5);

  // Combine
  const full = new Uint8Array(dataFrame.length + trailerFrame.length);
  full.set(dataFrame);
  full.set(trailerFrame, dataFrame.length);
  return full.buffer;
}

function parseGrpcWebRequest(body: ArrayBuffer): Uint8Array {
  const bytes = new Uint8Array(body);
  // Skip frame header (5 bytes): type(1) + length(4)
  return bytes.subarray(5);
}

// 核心 handler 建立函式
function unaryHandler<I extends object, O extends object>(
  service: ServiceInfo,
  methodName: string,
  resolver: (args: { request: I }) => O
) {
  const method = service.methods.find(m => m.localName === methodName)!;
  const url = `*/${service.typeName}/${method.name}`;

  return http.post(url, async ({ request }) => {
    const body = await request.arrayBuffer();
    const msgBytes = parseGrpcWebRequest(body);
    const typedRequest = method.I.fromBinary(msgBytes) as I;
    const response = resolver({ request: typedRequest });
    const responseBytes = method.O.toBinary(response as O);
    const grpcBody = createGrpcWebResponse(responseBytes);

    return new HttpResponse(grpcBody, {
      headers: {
        'content-type': 'application/grpc-web+proto',
      },
    });
  });
}
```

### 5.4 優點

| 優點 | 說明 |
|------|------|
| 真實網路層攔截 | Mock 行為最接近真實環境，Service Worker 攔截 fetch |
| 與 MSW 生態整合 | 可直接與 REST/GraphQL handlers 共存 |
| 瀏覽器 DevTools 可見 | 攔截的請求在 Network tab 中可觀察 |
| 不修改 client 程式碼 | 前端 client 完全不知道 mock 的存在 |

### 5.5 缺點

| 缺點 | 說明 |
|------|------|
| 二進位 frame 處理複雜 | 必須完整實作 gRPC-Web frame 編解碼 |
| base64 格式支援 | 如果使用 `grpc-web-text` 格式需要額外處理 |
| Server streaming 困難 | MSW 的 `HttpResponse` 不直接支援分段回傳多個 frame |
| 型別推導間接 | TypeScript 型別推導需要更多泛型體操 |

---

## 6. 方案二：Mock RpcTransport（推薦）

### 6.1 原理

不在 HTTP 層攔截，而是直接替換 `RpcTransport` 實作。由於 protobuf-ts 的 client 唯一依賴就是 transport，替換 transport 等同替換整個通訊層。

### 6.2 為什麼這是更好的方案

```
方案一（MSW 層）：
Client → GrpcWebFetchTransport → fetch() → [MSW 攔截] → 解碼 → handler → 編碼 → 回傳

方案二（Transport 層）：
Client → MockRpcTransport → 直接呼叫 handler → 回傳 typed object
```

Transport 層方案**跳過了所有 protobuf 序列化/反序列化和 gRPC-Web frame 編解碼**，直接在 TypeScript 物件層面運作。

### 6.3 核心實作

```typescript
import {
  RpcTransport, RpcOptions, UnaryCall, ServerStreamingCall,
  ClientStreamingCall, DuplexStreamingCall,
  MethodInfo, RpcMetadata, RpcStatus, RpcError,
  Deferred, RpcOutputStreamController,
  mergeRpcOptions
} from '@protobuf-ts/runtime-rpc';
import type { ServiceInfo } from '@protobuf-ts/runtime-rpc';

// ===== 型別定義 =====

type UnaryMockHandler<I extends object, O extends object> = (
  request: I,
  context: MockContext
) => O | Promise<O>;

type ServerStreamingMockHandler<I extends object, O extends object> = (
  request: I,
  context: MockStreamContext<O>
) => void | Promise<void>;

interface MockContext {
  metadata: RpcMetadata;
}

interface MockStreamContext<O extends object> extends MockContext {
  send: (message: O) => void;
  complete: () => void;
  error: (err: RpcError) => void;
}

interface MockMethodRegistration {
  serviceName: string;
  methodName: string;
  handler: UnaryMockHandler<any, any> | ServerStreamingMockHandler<any, any>;
  type: 'unary' | 'serverStreaming';
}

// ===== Mock Transport =====

export class MockGrpcTransport implements RpcTransport {
  private handlers = new Map<string, MockMethodRegistration>();
  private defaultOptions: RpcOptions;

  constructor(options?: Partial<RpcOptions>) {
    this.defaultOptions = { ...options } as RpcOptions;
  }

  /** 註冊一個 unary mock handler */
  addUnaryHandler<I extends object, O extends object>(
    service: ServiceInfo,
    methodName: string,
    handler: UnaryMockHandler<I, O>
  ): this {
    const method = service.methods.find(m => m.localName === methodName);
    if (!method) throw new Error(`Method ${methodName} not found in ${service.typeName}`);
    const key = `${service.typeName}/${method.name}`;
    this.handlers.set(key, {
      serviceName: service.typeName,
      methodName: method.name,
      handler,
      type: 'unary',
    });
    return this;
  }

  /** 註冊一個 server streaming mock handler */
  addServerStreamingHandler<I extends object, O extends object>(
    service: ServiceInfo,
    methodName: string,
    handler: ServerStreamingMockHandler<I, O>
  ): this {
    const method = service.methods.find(m => m.localName === methodName);
    if (!method) throw new Error(`Method ${methodName} not found in ${service.typeName}`);
    const key = `${service.typeName}/${method.name}`;
    this.handlers.set(key, {
      serviceName: service.typeName,
      methodName: method.name,
      handler,
      type: 'serverStreaming',
    });
    return this;
  }

  mergeOptions(options?: Partial<RpcOptions>): RpcOptions {
    return mergeRpcOptions(this.defaultOptions, options);
  }

  unary<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions
  ): UnaryCall<I, O> {
    const key = `${method.service.typeName}/${method.name}`;
    const reg = this.handlers.get(key);

    const defHeader = new Deferred<RpcMetadata>();
    const defMessage = new Deferred<O>();
    const defStatus = new Deferred<RpcStatus>();
    const defTrailer = new Deferred<RpcMetadata>();

    if (!reg || reg.type !== 'unary') {
      const err = new RpcError(
        `No mock handler for ${key}`,
        'UNIMPLEMENTED'
      );
      defHeader.reject(err);
      defMessage.reject(err);
      defStatus.reject(err);
      defTrailer.reject(err);
    } else {
      // 非同步執行 handler
      Promise.resolve()
        .then(() => (reg.handler as UnaryMockHandler<I, O>)(
          input,
          { metadata: options.meta ?? {} }
        ))
        .then(response => {
          defHeader.resolve({});
          defMessage.resolve(response);
          defStatus.resolve({ code: 'OK', detail: 'OK' });
          defTrailer.resolve({});
        })
        .catch(err => {
          const rpcErr = err instanceof RpcError
            ? err
            : new RpcError(err.message ?? 'Unknown error', 'INTERNAL');
          defHeader.rejectPending(rpcErr);
          defMessage.rejectPending(rpcErr);
          defStatus.rejectPending(rpcErr);
          defTrailer.rejectPending(rpcErr);
        });
    }

    return new UnaryCall<I, O>(
      method,
      options.meta ?? {},
      input,
      defHeader.promise,
      defMessage.promise,
      defStatus.promise,
      defTrailer.promise
    );
  }

  serverStreaming<I extends object, O extends object>(
    method: MethodInfo<I, O>,
    input: I,
    options: RpcOptions
  ): ServerStreamingCall<I, O> {
    const key = `${method.service.typeName}/${method.name}`;
    const reg = this.handlers.get(key);

    const defHeader = new Deferred<RpcMetadata>();
    const responseStream = new RpcOutputStreamController<O>();
    const defStatus = new Deferred<RpcStatus>();
    const defTrailer = new Deferred<RpcMetadata>();

    if (!reg || reg.type !== 'serverStreaming') {
      const err = new RpcError(`No mock handler for ${key}`, 'UNIMPLEMENTED');
      defHeader.reject(err);
      responseStream.notifyError(err);
      defStatus.reject(err);
      defTrailer.reject(err);
    } else {
      const streamCtx: MockStreamContext<O> = {
        metadata: options.meta ?? {},
        send: (msg) => responseStream.notifyMessage(msg),
        complete: () => {
          responseStream.notifyComplete();
          defStatus.resolve({ code: 'OK', detail: 'OK' });
          defTrailer.resolve({});
        },
        error: (err) => {
          responseStream.notifyError(err);
          defStatus.reject(err);
          defTrailer.reject(err);
        },
      };

      defHeader.resolve({});
      Promise.resolve()
        .then(() => (reg.handler as ServerStreamingMockHandler<I, O>)(input, streamCtx))
        .catch(err => {
          const rpcErr = err instanceof RpcError ? err : new RpcError(err.message, 'INTERNAL');
          responseStream.notifyError(rpcErr);
          defStatus.rejectPending(rpcErr);
          defTrailer.rejectPending(rpcErr);
        });
    }

    return new ServerStreamingCall<I, O>(
      method,
      options.meta ?? {},
      input,
      defHeader.promise,
      responseStream,
      defStatus.promise,
      defTrailer.promise
    );
  }

  clientStreaming<I extends object, O extends object>(
    method: MethodInfo<I, O>
  ): ClientStreamingCall<I, O> {
    throw new RpcError('Client streaming not supported by gRPC-Web', 'UNIMPLEMENTED');
  }

  duplex<I extends object, O extends object>(
    method: MethodInfo<I, O>
  ): DuplexStreamingCall<I, O> {
    throw new RpcError('Duplex streaming not supported by gRPC-Web', 'UNIMPLEMENTED');
  }
}
```

### 6.4 優點

| 優點 | 說明 |
|------|------|
| 零序列化開銷 | 直接操作 TypeScript 物件，不需 protobuf 編解碼 |
| 完美型別安全 | `MethodInfo<I,O>` 的泛型直接傳遞到 handler |
| Server streaming 天然支援 | `RpcOutputStreamController` 已內建於 protobuf-ts |
| 實作簡潔 | 不需處理 gRPC-Web frame 格式 |
| 無 MSW 依賴 | 可獨立使用，也可與 MSW 共存 |
| Node.js 測試通用 | 在 vitest/jest 中直接使用，無需 Service Worker |

### 6.5 缺點

| 缺點 | 說明 |
|------|------|
| 需修改 transport 注入 | 前端程式碼需支援 transport 切換 |
| 不經過真實網路層 | 無法測試 HTTP header、CORS 等網路行為 |
| DevTools 不可見 | mock 請求不會出現在 Network tab |

---

## 7. 方案三：混合架構

結合兩個方案的優點：核心使用 Mock RpcTransport 提供型別安全的 handler 定義，同時提供 MSW adapter 層讓 handler 也能在 HTTP 層運作。

```
┌─────────────────────────────────────────────────────────────┐
│                    grpc-web-mock (npm lib)                    │
│                                                               │
│  ┌──────────────────┐     ┌────────────────────────────┐     │
│  │  Handler Registry │     │    MSW Adapter (optional)   │     │
│  │                    │     │                              │     │
│  │  grpc.unary(...)  │────▶│  轉換為 http.post() handler  │     │
│  │  grpc.stream(...) │     │  自動處理 frame 編解碼        │     │
│  └────────┬─────────┘     └──────────┬─────────────────┘     │
│           │                          │                         │
│           ▼                          ▼                         │
│  ┌──────────────────┐     ┌────────────────────────────┐     │
│  │ MockRpcTransport  │     │  MSW setupWorker/Server    │     │
│  │ (Transport 層 mock)│     │  (HTTP 層 mock)            │     │
│  └──────────────────┘     └────────────────────────────┘     │
│                                                               │
│  共用同一套 handler 定義！                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. 推薦 API 設計

### 8.1 MSW 風格 Handler 定義

參考 MSW 的 `http.get()` / `graphql.query()` 風格[^9]，設計 `grpc.unary()` / `grpc.serverStreaming()`：

```typescript
import { grpc } from 'grpc-web-mock';
import { GreeterService } from './gen/greeter.client';
import { SayHelloResponse } from './gen/greeter';

// ===== Handler 定義（MSW 風格）=====

export const handlers = [
  // Unary RPC
  grpc.unary(GreeterService, 'sayHello', ({ request }) => {
    // request 自動推導為 SayHelloRequest
    // 回傳值自動推導為 SayHelloResponse
    return { message: `Hello, ${request.name}!` };
  }),

  // Server Streaming RPC
  grpc.serverStreaming(GreeterService, 'streamGreetings', ({ request, stream }) => {
    stream.send({ message: `Hi ${request.name} #1` });
    stream.send({ message: `Hi ${request.name} #2` });
    stream.complete();
  }),

  // 模擬錯誤
  grpc.unary(GreeterService, 'sayHello', ({ request }) => {
    throw grpc.error('NOT_FOUND', 'User not found');
  }),
];
```

### 8.2 TypeScript 型別推導

透過 `ServiceInfo` 的 `methods` 陣列中的 `MethodInfo<I,O>` 泛型，我們可以實現完整的型別推導：

```typescript
// 型別輔助（Library 內部）
type ExtractMethod<
  S extends ServiceInfo,
  N extends string
> = Extract<S['methods'][number], { localName: N }>;

type ExtractInput<M extends MethodInfo> = M extends MethodInfo<infer I, any> ? I : never;
type ExtractOutput<M extends MethodInfo> = M extends MethodInfo<any, infer O> ? O : never;

// grpc.unary 的完整型別簽名
function unary<
  S extends ServiceInfo,
  N extends string,
  M extends ExtractMethod<S, N>
>(
  service: S,
  methodName: N,
  resolver: (args: {
    request: ExtractInput<M>;
    metadata: RpcMetadata;
  }) => ExtractOutput<M> | Promise<ExtractOutput<M>>
): MockHandler;
```

> **注意**：protobuf-ts 產出的 `ServiceType` 使用 `PartialMethodInfo[]`，在 normalize 後變成 `MethodInfo[]`。由於 TypeScript 的結構型別限制，要完美推導 method name → I/O type 的映射，可能需要搭配一個額外的 type map 物件（類似 ConnectRPC 的 `GenService<T>` 做法[^10]），或使用 protobuf-ts 的 plugin 生成額外的型別輔助。

### 8.3 實際可行的型別推導方式

考慮到 protobuf-ts 的 code generation 不像 ConnectRPC 那樣產出泛型 service type，最務實的做法是：

```typescript
// 方式 A：使用 generated client 的方法型別
import { IGreeterServiceClient } from './gen/greeter.client';

type GreeterMethods = {
  [K in keyof IGreeterServiceClient]:
    IGreeterServiceClient[K] extends (input: infer I, options?: any) => any
      ? { input: I; output: /* ... */ }
      : never;
};

// 方式 B（推薦）：直接使用 MethodInfo 比對
// Library 提供 helper 從 ServiceType 提取型別
import { GreeterService } from './gen/greeter.client';
import { SayHelloRequest, SayHelloResponse } from './gen/greeter';

grpc.unary<SayHelloRequest, SayHelloResponse>(
  GreeterService, 'SayHello',
  ({ request }) => ({ message: `Hello ${request.name}` })
);

// 方式 C（最簡潔，需 codegen plugin 或 type augmentation）：
// Library 提供 protoc plugin 生成額外的 type map
grpc.unary(GreeterService, 'sayHello', ({ request }) => {
  // request: SayHelloRequest ← 自動推導
  return { message: `Hello ${request.name}` };
  // ^^ 自動推導為 SayHelloResponse
});
```

---

## 9. npm Library 封裝設計

### 9.1 Package 結構

```
grpc-web-mock/
├── src/
│   ├── index.ts              # 主要匯出
│   ├── transport.ts          # MockGrpcTransport 實作
│   ├── handlers.ts           # grpc.unary / grpc.serverStreaming
│   ├── msw-adapter.ts        # MSW handler 轉換器（optional）
│   ├── frame.ts              # gRPC-Web frame 編解碼（for MSW adapter）
│   ├── errors.ts             # gRPC error 建立工具
│   └── types.ts              # 公開型別定義
├── package.json
├── tsconfig.json
└── README.md
```

### 9.2 package.json 建議

```json
{
  "name": "grpc-web-mock",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./msw": {
      "import": "./dist/msw-adapter.js",
      "types": "./dist/msw-adapter.d.ts"
    }
  },
  "peerDependencies": {
    "@protobuf-ts/runtime": "^2.0.0",
    "@protobuf-ts/runtime-rpc": "^2.0.0",
    "msw": "^2.0.0"
  },
  "peerDependenciesMeta": {
    "msw": { "optional": true }
  }
}
```

### 9.3 匯出 API

```typescript
// grpc-web-mock/src/index.ts

export { MockGrpcTransport } from './transport';
export { grpc } from './handlers';
export { createMockTransport } from './transport';
export type { MockHandler, UnaryMockResolver, StreamMockResolver } from './types';

// grpc-web-mock/msw
export { toMswHandlers } from './msw-adapter';
```

---

## 10. 環境變數切換機制

### 10.1 Transport 切換模式（推薦）

```typescript
// src/transport.ts（前端專案中）
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import { createMockTransport } from 'grpc-web-mock';
import { handlers } from './mocks/grpc-handlers';

function createTransport() {
  if (import.meta.env.VITE_ENABLE_MOCK === 'true') {
    return createMockTransport(handlers);
  }
  return new GrpcWebFetchTransport({
    baseUrl: import.meta.env.VITE_API_URL,
  });
}

export const transport = createTransport();
```

```typescript
// src/services/greeter.ts（前端專案中）
import { GreeterServiceClient } from './gen/greeter.client';
import { transport } from '../transport';

export const greeterClient = new GreeterServiceClient(transport);
// 完全不需要知道是 mock 還是真實 transport
```

### 10.2 MSW 模式（進階）

```typescript
// src/mocks/browser.ts
import { setupWorker } from 'msw/browser';
import { toMswHandlers } from 'grpc-web-mock/msw';
import { handlers } from './grpc-handlers';

export const worker = setupWorker(...toMswHandlers(handlers));
```

```typescript
// src/main.ts
if (import.meta.env.VITE_ENABLE_MOCK === 'true') {
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}
```

### 10.3 Vite 環境設定

```bash
# .env.development
VITE_ENABLE_MOCK=true
VITE_API_URL=http://localhost:8080

# .env.production
VITE_ENABLE_MOCK=false
VITE_API_URL=https://api.example.com
```

### 10.4 Tree-shaking 考量

使用 Transport 切換模式時，可以利用 Vite 的 define 確保 production build 完全移除 mock 程式碼：

```typescript
// vite.config.ts
export default defineConfig({
  define: {
    'import.meta.env.VITE_ENABLE_MOCK': JSON.stringify(process.env.VITE_ENABLE_MOCK),
  },
});
```

搭配 dynamic import：

```typescript
const transport = import.meta.env.VITE_ENABLE_MOCK === 'true'
  ? (await import('grpc-web-mock')).createMockTransport(
      (await import('./mocks/grpc-handlers')).handlers
    )
  : new GrpcWebFetchTransport({ baseUrl: import.meta.env.VITE_API_URL });
```

---

## 11. 現有生態系分析

### 11.1 目前不存在的東西

截至研究時點（2026-04），**不存在**一個成熟的 npm package 同時滿足以下條件[^11]：
- 針對 protobuf-ts 的型別系統
- 提供 MSW 風格的 handler API
- 支援 gRPC-Web 協定
- 可作為 npm library 引入

### 11.2 相關但不完全符合的方案

| 方案 | 說明 | 差異 |
|------|------|------|
| `@alenon/grpc-mock-server` | Node.js gRPC mock server | 需要啟動真實 server，非瀏覽器內 mock |
| ConnectRPC `createRouterTransport` | ConnectRPC 的內建 mock transport | 僅限 ConnectRPC 生態，非 protobuf-ts |
| `@connectrpc/connect-playwright` | Playwright E2E mock | 測試專用，非開發環境 mock |
| `nakatanakatana/feed-reader` 的 `mockConnectWeb` | 社群實作的 MSW+Connect mock | 針對 ConnectRPC（JSON），非 gRPC-Web binary[^10] |
| 手動 MSW `http.post` handler | 部落格文章介紹的方式 | 無型別安全，需手動處理 frame 格式[^12] |

### 11.3 ConnectRPC 的 `createRouterTransport` 給我們的啟發

ConnectRPC 的做法值得參考[^13]：

```typescript
// ConnectRPC 的方式
const mockTransport = createRouterTransport(({ service }) => {
  service(ElizaService, {
    say: (req) => ({ sentence: "Mocked!" }),
  });
});
```

我們的 protobuf-ts 版本應該提供類似的簡潔度。

---

## 12. 與 ConnectRPC 方案的比較

| 面向 | protobuf-ts + gRPC-Web | ConnectRPC |
|------|------------------------|------------|
| 協定 | gRPC-Web (binary/text) | Connect Protocol (JSON-first) |
| Mock 難度 | 需處理 binary frame | JSON-based，較簡單 |
| 現有 mock 支援 | ❌ 無官方方案 | ✅ `createRouterTransport` |
| 型別系統 | `ServiceInfo` + `MethodInfo` | `GenService<T>` |
| Transport 抽象 | `RpcTransport` interface | `Transport` interface |
| 可 mock 性 | ✅ 可透過 Transport 替換 | ✅ 內建支援 |

**結論**：兩者的 Transport 抽象都支援替換，但 protobuf-ts 需要自己建構 mock transport，而 ConnectRPC 已有官方方案。這正是我們要填補的空缺。

---

## 13. 實作路線圖

### Phase 1：核心 Mock Transport

- 實作 `MockGrpcTransport implements RpcTransport`
- 支援 `unary` 和 `serverStreaming`
- 提供 `grpc.unary()` / `grpc.serverStreaming()` handler API
- 基本的型別推導

### Phase 2：MSW Adapter

- 實作 `toMswHandlers()` 將 mock handlers 轉換為 MSW http handlers
- 完整的 gRPC-Web frame 編解碼
- 支援 binary 和 text 格式

### Phase 3：DX 增強

- 提供 protobuf-ts plugin 生成額外型別輔助（讓 method name → I/O type 自動推導）
- 支援 delay / timing 控制
- 支援 response 動態生成（faker 整合）
- 錯誤模擬工具（`grpc.error(code, message)`）

### Phase 4：進階功能

- Request logging / DevTools 整合
- 支援 metadata/header 比對
- 支援 interceptor chain mock
- Vitest/Jest 專用 setup helper

---

## 14. Confidence Assessment

| 評估項目 | 信心度 | 說明 |
|----------|--------|------|
| 技術可行性 | 🟢 高 | `RpcTransport` interface 設計使 mock transport 完全可行 |
| MSW HTTP 層攔截 | 🟢 高 | gRPC-Web 走 HTTP POST，MSW 可攔截，但需手動處理 frame |
| 型別安全 | 🟡 中高 | Transport 層有完美型別安全；MSW 層需額外泛型設計 |
| 自動型別推導（method name → I/O） | 🟡 中 | protobuf-ts 的 codegen 不像 ConnectRPC 提供泛型 service type，需要額外工作 |
| Server streaming 支援 | 🟢 高 | `RpcOutputStreamController` 在 Transport 層已可用 |
| MSW 層 streaming | 🟠 中低 | MSW 的 `HttpResponse` 不直接支援 chunked streaming response |
| npm library 封裝 | 🟢 高 | peer dependency 設計清晰，tree-shaking 友好 |
| 生態系空缺 | 🟢 確定 | 確認目前無現成方案，此 library 有明確市場 |

### 關鍵假設

1. 使用者的前端專案已使用 protobuf-ts 的 `RpcTransport` 作為 client 建構參數（非直接操作 fetch）
2. 環境變數切換可以在 transport 初始化時期決定
3. 主要使用場景是 unary 和 server streaming（gRPC-Web 不支援 client/duplex streaming）

---

## 15. Footnotes

[^1]: protobuf-ts code generation 產出 `ServiceType` 包含完整 runtime 反射資訊。參見 [timostamm/protobuf-ts](https://github.com/timostamm/protobuf-ts) `packages/runtime-rpc/src/service-type.ts`

[^2]: gRPC-Web 協定規範：[grpc/grpc-web protocol](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md)，使用 HTTP/1.1 POST 請求，body 中包含 framed protobuf messages

[^3]: protobuf-ts 的 gRPC-Web frame 格式實作：`packages/grpcweb-transport/src/grpc-web-format.ts`，包含 `createGrpcWebRequestBody()`、`readGrpcWebResponseBody()`、`GrpcWebFrame` enum

[^4]: `RpcTransport` interface 定義於 `packages/runtime-rpc/src/rpc-transport.ts`，是所有 transport 實作的核心抽象，定義了 `unary`、`serverStreaming`、`clientStreaming`、`duplex` 四個方法

[^5]: `MethodInfo<I,O>` 定義於 `packages/runtime-rpc/src/reflection-info.ts`，`I` 和 `O` 屬性為 `IMessageType<T>` 型別，攜帶完整的序列化/反序列化能力

[^6]: `UnaryCall` 定義於 `packages/runtime-rpc/src/unary-call.ts`，implements `PromiseLike<FinishedUnaryCall<I,O>>`，建構時接受 method、headers、response、status、trailers 等 Promise

[^7]: MSW v2 `RequestHandler` 抽象類別定義於 [mswjs/msw](https://github.com/mswjs/msw) `src/core/handlers/RequestHandler.ts`，提供 `predicate()`、`parse()`、`extendResolverArgs()` 等擴展點

[^8]: MSW `GraphQLHandler` 定義於 `src/core/handlers/GraphQLHandler.ts`，展示如何擴展 `RequestHandler` 建構自訂協定 handler，包含 request body 解析、operation name 比對等邏輯

[^9]: MSW v2 handler API 設計參見 [MSW 官方文件](https://mswjs.io/)

[^10]: `nakatanakatana/feed-reader` 的 `frontend/src/mocks/connect.ts` 展示了如何在 MSW 中 mock ConnectRPC (JSON) 請求，使用 `@bufbuild/protobuf` 的 `GenService<T>` 型別取得完整的方法型別推導

[^11]: 基於 GitHub code search、npm search、web search 綜合結果，截至 2026-04 無完整的 protobuf-ts + gRPC-Web mock library

[^12]: Lucas Levin 的部落格文章 [Mocking gRPC-web responses](https://lucas-levin.com/code/blog/mocking-grpc-web-requests-for-integration-testing) 展示了手動建構 gRPC-Web frame 的 MSW handler，但無型別安全

[^13]: ConnectRPC 官方 testing 文件 [connectrpc.com/docs/web/testing](https://connectrpc.com/docs/web/testing/) 介紹 `createRouterTransport` 的 in-memory mock 方案
