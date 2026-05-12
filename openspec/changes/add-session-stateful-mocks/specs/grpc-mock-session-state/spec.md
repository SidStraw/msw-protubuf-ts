## ADDED Requirements

### Requirement: Typed mock session creation

The system SHALL provide a public `createGrpcMockSession<TState extends object>()` factory that creates a `GrpcMockSession<TState>` with `getState()`, `update()`, and `reset()` APIs.

#### Scenario: Create session with initial state

- **WHEN** a user creates a session with an initial state object
- **THEN** the returned session exposes typed state through `getState()`
- **THEN** `reset()` restores the session to the original initial snapshot

#### Scenario: Create default empty session

- **WHEN** a user creates a session without an initial state
- **THEN** the returned session uses an empty record as its initial state

### Requirement: Session state clone safety

The system MUST protect session state snapshots from external reference mutation by cloning initial state and returned state values.

#### Scenario: Mutating original initial state

- **WHEN** a user mutates the original object that was passed to `createGrpcMockSession()`
- **THEN** the session state remains equal to the cloned initial snapshot

#### Scenario: Mutating returned state

- **WHEN** a resolver reads state from `getState()` or `update()`
- **THEN** mutating that returned value MUST NOT mutate the internal session snapshot

#### Scenario: Unsupported clone value

- **WHEN** session state contains a value that `structuredClone()` cannot clone
- **THEN** the system throws an error that explains session state must contain cloneable data

### Requirement: Resolver context session injection

The system SHALL include `session` in `GrpcMockContext` for mock resolvers.

#### Scenario: Unary resolver uses session

- **WHEN** a unary handler is invoked by `MockRpcTransport`
- **THEN** its resolver receives a context with the active `GrpcMockSession`

#### Scenario: Server-streaming resolver uses session

- **WHEN** a server-streaming handler is invoked by `MockRpcTransport`
- **THEN** its resolver receives a context with the active `GrpcMockSession`

### Requirement: Registry-owned default session

The system SHALL make each `GrpcMockRegistry` own a default session.

#### Scenario: Registry created with initial state

- **WHEN** a user calls `createGrpcMockRegistry({ initialState })`
- **THEN** the registry exposes a typed `session`
- **THEN** handlers registered through the registry receive that typed session in resolver context

#### Scenario: Multiple transports share registry session

- **WHEN** multiple transports are created with the same registry and no transport-level session override
- **THEN** handlers invoked through those transports observe the same registry session state

### Requirement: Transport-level session override

The system SHALL allow `createGrpcMockTransport()` to receive an optional `session` that overrides the registry session for that transport.

#### Scenario: Isolated transport sessions

- **WHEN** two transports are created with the same registry but different session overrides
- **THEN** each transport invokes handlers with its own override session
- **THEN** the registry default session remains unchanged by those transport-specific updates

### Requirement: Backward compatibility for existing handlers

The system MUST preserve existing handler registration and transport creation flows for users that do not use session state.

#### Scenario: Existing unary handler without session usage

- **WHEN** a user registers an existing unary resolver that only reads `request`, `meta`, `signal`, or `passthrough`
- **THEN** the handler continues to typecheck and run without requiring session-specific arguments

#### Scenario: Existing transport creation without session options

- **WHEN** a user calls `createGrpcMockRegistry()` and `createGrpcMockTransport({ registry })`
- **THEN** the transport can invoke registered handlers without additional session configuration

### Requirement: Session documentation and examples

The system SHALL document session stateful mocks as a package feature.

#### Scenario: README explains stateful mutation/query flow

- **WHEN** a user reads the README session example
- **THEN** it demonstrates a mutation-like unary mock updating session state
- **THEN** it demonstrates a query-like unary mock reading the updated state

#### Scenario: README explains clone and update constraints

- **WHEN** a user reads the README session documentation
- **THEN** it states that session state must contain `structuredClone()`-compatible data
- **THEN** it states that read-modify-write updates MUST be performed inside `session.update()`
