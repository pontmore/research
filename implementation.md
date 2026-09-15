# Pontmore Reference Implementation Research

Updated 14 September 2026.

## Executive conclusion

Pontmore should be built as four small deliverables:

1. a deterministic Rust library implementing pinned PIP/profile versions;
2. a black-box Technology Compatibility Kit (TCK);
3. `pontmored`, a durable node whose only outbound client data channel is SSE; and
4. a closed internal manager for operator-configured, long-lived economic connector
   subprocesses.

Application integrations are external clients, not daemon plugins. They submit complete
signed events and consume an SSE snapshot/replay/live stream. Protocol semantics are not
runtime-extensible. Economic connector operations are generated and authorized inside
the daemon and are never client-callable.

This conclusion narrows the earlier framework proposal. It deliberately rejects a
general plugin ABI, dynamic profile modules, Wasm validators, an embedded application
host, gRPC/WebSocket client APIs, and a connector marketplace for the initial reference
implementation.

## Protocol and implementation boundary

The Pontmore specifications define public Nostr facts: Agent definitions, escrow
descriptors, coordination roots/actions, and pinned profiles. Operator accounts,
indexes, stream cursors, private evidence, connector operations, queues, and database
records are implementation overlays.[^1]

The implementation must preserve these rules:

- complete signed events remain the portable evidence;
- validation is deterministic and independent of relay delivery order;
- an index or projection never becomes canonical state;
- exact PIP and profile versions are selected explicitly;
- a connector response is private operational evidence, not settlement; and
- only a valid signed action can change reconstructed protocol state.

## Lessons from public implementations

| Project             | Primary lesson for Pontmore                                                           | What not to copy                                                     |
| ------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| LDK / LDK Node      | Runtime-agnostic security core plus opinionated assembled node                        | Hiding persistence/effect obligations behind a simple API            |
| A2A SDK and TCK     | Shared protocol surface, independent implementations, black-box compatibility testing | Large multi-transport surface at the start                           |
| NDK / nostr         | Reuse proven Nostr serialization, signature, relay, and signer primitives             | Letting SDK cache behavior define Pontmore semantics                 |
| Matrix Complement   | Test real processes, restarts, reordering, and heterogeneous implementations          | Treating unit tests of one shared core as interoperability           |
| Temporal / Restate  | Durable intent, replay, reconciliation, and no blind effect repetition                | Treating private workflow history as public protocol state           |
| HashiCorp go-plugin | Versioned/checksummed long-lived subprocess lifecycle                                 | A general arbitrary plugin interface                                 |
| Core Lightning      | Persistent subprocess integrations, explicit messages, regtest, diagnostics           | Allowing extensions to redefine core validation                      |
| Dapr components     | Service integrations outside the host process                                         | Initial gRPC/container complexity without demonstrated need          |
| BTCPay Server       | Templates, immutable releases, provenance, diagnostics, compatibility testing         | In-process trust for third-party money-moving code                   |
| OpenClaw / elizaOS  | Strong external application and AI integration ergonomics                             | Loading application tools, hooks, or model services into `pontmored` |
| Wasmtime / Extism   | Capability-oriented isolation if a future pure-extension need appears                 | Adding a second runtime and ABI without a concrete need              |

### Deterministic core: LDK is the strongest shape

LDK keeps Lightning state-machine logic runtime-agnostic while requiring surrounding
components to provide persistence, networking, chain access, and keys. LDK Node then
assembles an opinionated runnable system.[^2]

Pontmore should use the same shape. The `pontmore` crate owns signature checks, parsing,
PIP/profile selection, graph reconstruction, authority, expiry, replay, fork, dispute,
and finality rules. `pontmored` assembles storage, streaming, relay work, and external
effects without changing those rules.

### Compatibility: A2A, Matrix, and libp2p

A2A maintains a specification, multiple SDKs, samples, an inspector, and a TCK. Matrix
Complement launches real implementations as black boxes and tests federation and
failure behavior. libp2p demonstrates why independent language implementations matter
for protocol governance.[^3]

Pontmore therefore needs both fixed JSON vectors and a system-under-test interface. A
Rust producer and independent TypeScript consumer must exchange signed histories in
both directions. Wrappers around the same Rust library are useful bindings, not
independent interoperability evidence.

### Nostr substrate: NDK, nostr, and nak

NDK and the Rust `nostr` ecosystem already implement Nostr event serialization,
signatures, relay access, filters, NIP-46, and related primitives. `nak` is useful as an
independent fixture oracle.[^4] Pontmore should wrap and pin a mature library, then keep
Pontmore-specific content/tag and coordination semantics in its own core.

### Durable effects: Temporal and Restate

An authorized intent and an external economic result are separated by crashes, timeouts,
and lost replies:

```text
authorization observed
  -> durable intent recorded
  -> connector call attempted
  -> response recorded or outcome becomes ambiguous
  -> connector inspected before retry
  -> exact signed outcome event produced
```

Temporal and Restate show why completed steps must not be repeated merely because the
caller lost the response.[^5] Pontmore can implement this discipline with PostgreSQL
first. The operation history remains private overlay state.

### Connector processes: HashiCorp, Core Lightning, and Dapr

HashiCorp go-plugin launches versioned subprocesses and supports checksums, structured
communication, and lifecycle management. Core Lightning demonstrates long-running
JSON-RPC extensions. Dapr demonstrates out-of-process service components.[^6]

Pontmore needs only the common denominator: one long-lived process per configured
economic connector, an exact protocol version, a strict command set, correlation IDs,
health and inspection, bounded messages/timeouts, and explicit shutdown. JSON Lines is
adequate for the first implementation; Protobuf/gRPC is unnecessary until cross-language
experience reveals schema-evolution or throughput needs.

### Application hosts: OpenClaw, A2A, MCP, and elizaOS

These systems are consumers above Pontmore. They may decide to propose a swap, gather
human approval, sign an event, or render a stream. They must not be loaded into the
daemon or receive a money-moving method. An OpenClaw integration, for example, is an
external client that submits a complete signed event and listens to SSE.[^7]

### BTCPay and Wasm: useful lessons, rejected runtime models

BTCPay's package templates, local debugging, immutable releases, compatibility testing,
installed-extension diagnostics, and provenance are worth copying for future connector
distribution. Its in-process plugin trust model is unsuitable for third-party economic
code in Pontmore.[^8]

Wasmtime/Extism can constrain pure guest code, but Pontmore currently has no justified
pure runtime extension. Profiles are protocol specifications and should ship in the
compiled core. Adding Wasm now would create another ABI, toolchain, updater, and
compatibility policy without simplifying a real requirement.[^9]

## Recommended architecture

```text
external applications
 OpenClaw | web/mobile | CLI | independent SDKs
        |                              ^
        | POST complete signed event   | SSE only:
        v                              | snapshot/replay/live
 +-------------------------------------------+
 |                 pontmored                 |
 | signature verification + immutable events|
 | deterministic projections                |
 | durable SSE log                           |
 | durable economic-operation controller    |
 +--------------------+----------------------+
                      |
          typed internal effect commands
                      |
       long-lived escrow/resolver processes

                 pontmore core
 signatures | schemas | graph | pinned profiles
```

### Non-extensible kernel

The compiled kernel owns every rule that can affect whether an event or history is
valid. Remote Nostr content can select a supported exact version but cannot load code.
New profiles or semantic versions require code review, TCK vectors, and a core release.

### Minimal client surface

The initial daemon exposes:

- `POST /v1/events` — the sole inbound data path, accepting a complete signed event;
- `GET /v1/stream` — the sole outbound client data path;
- `GET /health/live`; and
- `GET /health/ready`.

Submission returns HTTP status only. SSE event IDs are durable monotonic cursors. A new
subscription receives a transactionally consistent snapshot; a subscription with
`Last-Event-ID` receives records strictly after that cursor, followed by live updates.
Database replay closes broadcast-race and slow-consumer gaps.

There are no generic query, projection mutation, reconstruction, connector discovery,
or connector execution endpoints. If later experience justifies another client
operation, it should be added as a specific protocol-derived action rather than an
arbitrary RPC escape hatch.

### Economic connector contract

Connector manifests include identity, package version, connector API version/type,
supported profiles and networks, relative entrypoint, executable digest, and source
provenance. Operators explicitly allowlist them and restart the daemon to change the
set.

Connector API version 1 has a closed command set:

| Command    | Purpose                                               |
| ---------- | ----------------------------------------------------- |
| `hello`    | Exact API negotiation and process startup check       |
| `health`   | Probe the already-running process                     |
| `execute`  | Perform a daemon-authorized closed economic operation |
| `inspect`  | Reconcile a durable operation after uncertainty       |
| `shutdown` | Clean process termination                             |

The initial closed effects are escrow secure, settle, refund, and dispute resolution.
The daemon checks the connector category, profile, and network before dispatch. It
supplies operation and coordination IDs but no database handle, general signer, client
socket, or protocol validation callback.

## Repository shape

```text
crates/core/       deterministic Pontmore validation and reconstruction
crates/daemon/     `pontmored`, PostgreSQL, SSE, connector lifecycle
crates/tck/        vector runner
tck/vectors/       language-neutral positive and negative cases
examples/connectors/simulated-escrow/
deploy/connectors.example.json
```

Keeping three Rust crates is already a useful minimum: consumers can embed the core
without the daemon, the TCK stays an executable compatibility tool, and the node owns
all operational dependencies. More repositories should be created only when an
independently implemented SDK/TCK consumer exists.

## TCK structure

The TCK should grow in four layers:

1. wire vectors for complete signed events;
2. pure reconstruction vectors for unordered histories and stable error codes;
3. black-box daemon tests for submission, SSE snapshot/replay, restart, and backfill;
4. adversarial tests for duplicates, reorder, descriptor replacement, forks, process
   death, stale approval, timeout, and ambiguous connector outcomes.

Each case should identify the originating PIP/profile rule. The harness should test a
running executable through public boundaries and should be usable by a non-Rust
implementation.

## Current implementation assessment

The workspace now implements deterministic PIP-00/01/02 validation, the
`pontmore/swap@1` reducer, stable vectors, a minimal POST+SSE API, relay backfill and
subscription, safe descriptor/schema resolution, durable leased work, signed-outcome
publication reconciliation, and supervised static long-lived connector processes.

The daemon derives secure, settle, refund, and resolver effects from applied validated
actions, records intent before dispatch, updates durable outcomes, reconciles ambiguous
operations at startup, and supervises failed connectors with bounded backoff. Public
SSE records expose only operation ID, coordination ID, operation type, and status. A
PostgreSQL integration test covers a complete signed settlement history, automatic
projection, two idempotent connector effects, duplicate delivery, and private-field
redaction.

The connector request includes both a daemon operation UUID and a stable idempotency key
derived from coordination ID, triggering signed action, and operation type. Connectors
must persistently enforce the latter across daemon database loss or replacement.

The P0/P1 control plane is now implemented. Relay checkpoints and NIP-01 revision
selection establish discovery context; fetched OpenAPI/AsyncAPI artifacts are bounded,
DNS/IP checked, redirect-disabled, validated, and digest pinned; schema-defined authority
semantics require an operator-reviewed digest policy. Connector-returned signed outcomes
are revalidated, durably queued, published, observed, and only then reconstructed.

Production still depends on deployment-supplied controls: authenticated ingress, an
operator-reviewed OS sandbox launcher, a real isolated signing connector, real economic
connectors, and persistent connector-side idempotency. Independent-language
interoperability and a security audit remain P2 work, not hidden P0/P1 protocol behavior.

## Delivery plan

### Phase 0 — executable protocol contract

- Pin the supported protocol commit and exact profile versions.
- Keep stable positive/negative vectors and error codes.
- Resolve discovered semantic ambiguity in the PIPs, not in hidden daemon behavior.

### Phase 1 — minimal durable node (complete reference slice)

- Retain relay-backed safe descriptor discovery and explicitly reviewed schema facts.
- Retain bounded, versioned SSE snapshot/replay/live behavior.

### Phase 2 — durable economic controller (complete reference slice)

- Retain the implemented typed effects, intent-before-dispatch, idempotency, and
  inspect-before-retry invariants.
- Retain bounded restart backoff, continuous health state, and structured diagnostics.
- Add one independently implemented no-value/regtest connector.

### Phase 3 — production deployment and audit

- Supply and verify the deployment's OS sandbox, authenticated ingress, secrets, metrics,
  and traces.
- Fuzz parsing/state reconstruction and extend database/relay fault injection.
- Complete threat modeling, dependency review, and an external audit before real value.

### Phase 4 — interoperability

- Build an independent TypeScript implementation.
- Run bidirectional settlement/refund/dispute/fork scenarios.
- Publish black-box TCK reports and CI integration.
- Add external OpenClaw/A2A/MCP adapters without changing the daemon kernel.

## Principal risks

| Risk                                     | Consequence                                     | Control                                                                |
| ---------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| Projection treated as canonical          | Centralized or inconsistent outcomes            | Preserve signed events and reproducible reconstruction                 |
| Runtime extension changes protocol rules | Invalid settlement/refund                       | No protocol plugin interface                                           |
| Client can invoke connector              | Prompt injection or unauthorized value movement | No public connector route; effects originate in validated daemon state |
| Relay order selects a fork               | Conflicting economic action                     | Build the full graph and freeze valid siblings                         |
| Retry repeats value movement             | Financial loss                                  | Durable intent, stable operation ID, inspect-before-retry              |
| Connector receives broad authority       | Host compromise or theft                        | Closed commands, scoped secrets, subprocess and OS isolation           |
| Active semantics change on upgrade       | Historical inconsistency                        | Exact version pinning and reviewed core releases                       |
| Shared core called interoperability      | False confidence                                | Independent black-box implementation and TCK                           |
| Private evidence enters public events    | Irreversible privacy loss                       | Schema-level redaction and commitment-only public fields               |

## Final recommendation

Build the smallest system whose security boundary is explainable: a deterministic
non-extensible core, durable signed-event/SSE node, black-box TCK, and long-lived typed
economic connectors. Keep every application framework outside the daemon. Defer Wasm,
dynamic installation, generic RPC, additional client transports, and a marketplace
until concrete evidence shows that the simpler boundary is insufficient.

## Sources

[^1]: Pontmore. [Protocol repository](https://github.com/pontmore/protocol), commit `d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75`, 14 September 2026.

[^2]: Lightning Development Kit. [`rust-lightning`](https://github.com/lightningdevkit/rust-lightning) and [LDK Node](https://github.com/lightningdevkit/ldk-node). Accessed 14 September 2026.

[^3]: A2A Project. [A2A TCK](https://github.com/a2aproject/a2a-tck); Matrix.org. [Complement](https://github.com/matrix-org/complement); libp2p. [Specifications](https://github.com/libp2p/specs). Accessed 14 September 2026.

[^4]: Nostr Development Kit. [NDK](https://github.com/nostr-dev-kit/ndk); Rust Nostr. [`nostr`](https://github.com/rust-nostr/nostr); fiatjaf. [`nak`](https://github.com/fiatjaf/nak). Accessed 14 September 2026.

[^5]: Temporal. [Rust Core SDK](https://github.com/temporalio/sdk-rust); Restate. [Documentation](https://docs.restate.dev/). Accessed 14 September 2026.

[^6]: HashiCorp. [`go-plugin`](https://github.com/hashicorp/go-plugin); Core Lightning. [Writing plugins](https://docs.corelightning.org/docs/writing-plugins); Dapr. [Pluggable components](https://docs.dapr.io/developing-applications/develop-components/pluggable-components/). Accessed 14 September 2026.

[^7]: OpenClaw. [Architecture](https://github.com/openclaw/openclaw/blob/main/docs/concepts/architecture.md); A2A Project. [JavaScript SDK](https://github.com/a2aproject/a2a-js); Model Context Protocol. [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk); elizaOS. [Repository](https://github.com/elizaOS/eliza). Accessed 14 September 2026.

[^8]: BTCPay Server. [Plugin development](https://docs.btcpayserver.org/Development/Plugins/) and [plugin template](https://github.com/btcpayserver/btcpayserver-plugin-template). Accessed 14 September 2026.

[^9]: Bytecode Alliance. [Wasmtime](https://docs.wasmtime.dev/); Extism. [Framework](https://github.com/extism/extism). Accessed 14 September 2026.
