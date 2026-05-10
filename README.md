# protobuf-ts-grpc-mock

Typed gRPC-Web mock transport for `protobuf-ts` clients.

This package gives `protobuf-ts` projects a transport-first mock layer: you register typed unary and server-streaming handlers, inject the mock transport into generated clients, and keep the normal `RpcInterceptor` pipeline intact.

> **Status:** MVP `0.1.x`. Final publish defaults for this change are **unscoped `protobuf-ts-grpc-mock`**, **`VITE_ENABLE_API_MOCK`** for the Vite toggle, and **ESM-only output** with no CJS build.

## What it supports

| Area | Status |
| --- | --- |
| Unary RPC | Supported |
| Server streaming RPC | Supported |
| `grpc.reply()` delay / headers / trailers | Supported |
| `grpc.error()` / `RpcError` propagation | Supported |
| `fallbackTransport` / `ctx.passthrough()` | Supported |
| Existing `RpcInterceptor` pipeline | Supported |
| Client streaming | `UNIMPLEMENTED` |
| Duplex streaming | `UNIMPLEMENTED` |
| MSW bridge / `./msw` export | Not included |

## Why this package does not depend on MSW

This library mocks at the `RpcTransport` layer, not the HTTP layer. That keeps the package:

- fully typed at the decoded message level
- usable in Vitest, Node integration tests, and local development with one registry
- free of `msw` and `@protobuf-ts/grpcweb-transport` runtime dependencies

If you need a future MSW bridge, that should be added as a separate change instead of expanding the main entrypoint.

## How this differs from `TestTransport`

`@protobuf-ts/runtime-rpc` already ships `TestTransport`, but it is intentionally low-level. `protobuf-ts-grpc-mock` adds:

- service + method registration instead of transport fixture objects
- resolver helpers for reply metadata, delay, and typed errors
- fallback and passthrough behavior for gradual adoption
- parity with normal interceptor usage so existing tooling keeps working

## Quick start

```ts
import {
  createGrpcMockRegistry,
  createGrpcMockTransport,
  grpc,
} from "protobuf-ts-grpc-mock";

import { GreeterClient, GreeterService } from "./gen/greeter.client";

const registry = createGrpcMockRegistry();

registry.register(
  grpc.unary(GreeterService, "sayHello", ({ request }) => ({
    message: `Hello, ${request.name}!`,
  })),
  grpc.serverStreaming(GreeterService, "watchGreetings", ({ request }) => [
    { message: `${request.name}-1` },
    { message: `${request.name}-2` },
  ]),
);

const transport = createGrpcMockTransport({ registry });
const client = new GreeterClient(transport);

const hello = await client.sayHello({ name: "Ada" });
```

If you prefer, the registry also exposes `registry.unary()` and `registry.serverStreaming()` convenience methods.

For MSW-like fixture files, `grpc.unary()` can take a static response directly:

```ts
export default grpc.unary(ArticleService, "addTagToArticle", {
  articleId: "1",
  tags: [{ id: "2", label: "frontend" }],
});
```

## Reply helpers

### `grpc.error()`

```ts
registry.register(
  grpc.unary(GreeterService, "sayHello", () => {
    throw grpc.error("NOT_FOUND", "missing-user", { "x-reason": "demo" });
  }),
);
```

### `grpc.reply()`

```ts
registry.register(
  grpc.unary(GreeterService, "sayHello", ({ request }) =>
    grpc.reply(
      { message: `Hello, ${request.name}!` },
      {
        delay: 150,
        headers: { "x-mock": "true" },
        trailers: { "x-mock-finished": "true" },
      },
    ),
  ),
);
```

## Fallback transport and passthrough

Use `fallbackTransport` when you only want to mock some methods.

```ts
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";

const realTransport = new GrpcWebFetchTransport({
  baseUrl: import.meta.env.VITE_API_URL,
});

const transport = createGrpcMockTransport({
  registry,
  fallbackTransport: realTransport,
});
```

Resolvers can explicitly delegate:

```ts
registry.register(
  grpc.unary(GreeterService, "sayHello", ({ passthrough }) => passthrough()),
);
```

## Vite transport factory and tree-shaking

Keep the client construction point unchanged and switch transports in one factory.

```ts
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";

export async function createApiTransport() {
  const realTransport = new GrpcWebFetchTransport({
    baseUrl: import.meta.env.VITE_API_URL,
  });

  if (import.meta.env.VITE_ENABLE_API_MOCK !== "true") {
    return realTransport;
  }

  const { createGrpcMockTransport } = await import("protobuf-ts-grpc-mock");

  return createGrpcMockTransport({
    registry,
    fallbackTransport: realTransport,
  });
}
```

If your bundler can statically prove `VITE_ENABLE_API_MOCK !== "true"`, wrapping the mock branch in `import()` keeps the mock runtime out of the production bundle.

## Playground

This repo includes a Vite + React playground as a pnpm workspace package. It is a consumer-style example that starts from `playground/proto/*.proto`, generates `protobuf-ts` client code into `playground/src/gen/`, and calls those generated clients through `protobuf-ts-grpc-mock`.

```sh
pnpm install
pnpm playground:gen
pnpm playground:dev
```

For a production build check:

```sh
pnpm playground:build
```

The playground demonstrates:

- unary mock responses with headers, trailers, metadata, and delay
- `RpcError` propagation from a resolver
- server-streaming responses emitted from an async iterable
- two generated clients (`GreeterServiceClient` and `ArticleServiceClient`) sharing one mock transport
- MSW-like mock organization: one client directory under `playground/src/mocks/`, one file per method
- session stateful mocks where `addTagToArticle()` updates data that `listTags()` reads later in the same browser session
- using this package through the workspace dependency `protobuf-ts-grpc-mock`

The playground is a transport-level mock example. It does not start a real gRPC-Web backend, does not use MSW, and does not provide a network-level bridge. It is also excluded from the published npm package by the root `files` whitelist.

## Publish decisions for this MVP

- package name: `protobuf-ts-grpc-mock`
- package scope: none
- env flag: `VITE_ENABLE_API_MOCK`
- module format: ESM-only
- CJS build: not included

## Using existing `RpcInterceptor`s

This library does not import `window`, browser APIs, or DevTools code. Interceptors stay user-supplied through normal `RpcOptions`.

```ts
import { createGrpcMockTransport } from "protobuf-ts-grpc-mock";
import { devtoolsInterceptor } from "../docs/devtool";

const transport = createGrpcMockTransport({ registry });

await client.sayHello(
  { name: "Ada" },
  { interceptors: [devtoolsInterceptor] },
);
```

That means mock mode and real transport mode share the same interceptor behavior.

## API reference

### Values

| Export | Description |
| --- | --- |
| `createGrpcMockRegistry()` | Creates a mutable registry backed by a method-keyed map. |
| `createGrpcMockTransport(options)` | Creates the mock `RpcTransport`. |
| `MockRpcTransport` | `RpcTransport` implementation used by the factory. |
| `grpc.unary()` | Creates a unary handler registration from a resolver or static response. |
| `grpc.serverStreaming()` | Creates a server-streaming handler registration. |
| `grpc.error()` | Convenience helper for `RpcError`. |
| `grpc.reply()` | Convenience helper for delayed replies with headers and trailers. |

### Types

| Export | Description |
| --- | --- |
| `GrpcMockContext<I, O>` | Resolver context with `request`, `method`, `meta`, `signal`, and `passthrough()`. |
| `GrpcMockRegistry` | Registry contract used by the transport factory. |
| `MockHandler` | Registration object created by `grpc.unary()` or `grpc.serverStreaming()`. |
| `UnaryResolver<I, O>` | Resolver type for unary methods. |
| `ServerStreamResolver<I, O>` | Resolver type for server-streaming methods. |
| `StreamController<O>` | Imperative stream API with `send()`, `complete()`, and `error()`. |

## Non-goals

- no MSW bridge
- no `./msw` subpath export
- no `msw` dependency
- no support for client-streaming or duplex gRPC-Web methods
