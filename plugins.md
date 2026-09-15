# Pontmore Extensions and Economic Connectors

Updated 14 September 2026.

## Decision

Pontmore should not have a general plugin system.

The protocol kernel is compiled, versioned, and tested as one security boundary.
Applications extend Pontmore by running as separate clients. The only daemon-loaded
extensions are operator-configured economic connectors, and those run as long-lived
subprocesses behind a closed, typed interface.

This reduces four previously proposed extension classes to two integration boundaries:

| Boundary              | Execution                                       | Authority                                                 |
| --------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| Application extension | Separate process using the client API           | May submit complete signed events and consume SSE         |
| Economic connector    | Long-lived child process managed by `pontmored` | May perform only daemon-authorized typed economic effects |

There are no protocol-profile plugins, in-process application plugins, Wasm validators,
arbitrary RPC methods, dynamic installation, hot loading, or public connector-operation
API. A protocol or profile change requires a reviewed core release.

## Why this is the simpler safe model

The word _plugin_ was hiding several unrelated concerns: protocol semantics,
application features, economic integrations, packaging, and operator UX. Combining them
creates an authority problem. A plugin capable of changing validation is part of the
consensus-like protocol interpreter; a plugin capable of moving value is a privileged
service; an application integration needs neither form of host access.

The selected model makes those distinctions structural:

- remote protocol data can never select or load executable code;
- every implementation of a supported PIP/profile runs the same compiled rules;
- application failures and dependencies remain outside the daemon;
- clients cannot turn the daemon into an arbitrary connector proxy;
- connector crashes and dependency conflicts are isolated from the Rust process;
- connector results remain private operational evidence until represented by a valid
  signed Pontmore event; and
- the first compatibility surface is small enough to test exhaustively.

## Architecture

```text
application extensions
  OpenClaw | mobile/web | CLI | agent frameworks
          |                         ^
          | POST complete           | SSE snapshot,
          | signed events           | replay, live updates
          v                         |
       +-------------------------------+
       |           pontmored            |
       | signed-event verification      |
       | immutable event store          |
       | deterministic core             |
       | projections + SSE event log    |
       | durable effect controller      |
       +---------------+---------------+
                       |
              closed typed commands
                       |
          long-lived economic connectors
             escrow | resolver
```

### Client boundary

The current client surface deliberately contains only:

- `POST /v1/events` for complete signed-event ingestion;
- `GET /v1/stream` for snapshot, replay, and live Server-Sent Events;
- `GET /health/live`; and
- `GET /health/ready`.

SSE is the sole daemon-to-client data channel. `POST /v1/events` returns only status:
`202` for insertion and `200` for an already stored event. A reconnecting client sends
`Last-Event-ID`; the daemon replays durable stream records after that cursor. With no
cursor it sends a transactionally consistent snapshot before live updates.

SSE is one-way, so signed HTTP submission is retained as the one inbound data path.
Health responses are operational probes. There are no query, reconstruction, plugin,
connector-discovery, or economic-operation endpoints. Application extensions must
verify signed protocol events rather than trusting a projection as canonical state.

### Protocol kernel

The non-extensible core owns all PIP-00, PIP-01, PIP-02, and pinned coordination-profile
semantics, including signatures, schemas, authority, graph construction, expiry,
replay/fork handling, dispute rules, and terminal-state exclusivity. Profiles remain
versioned protocol specifications, not executable plugins.

This is the LDK lesson applied strictly: keep the state machine deterministic and
runtime-agnostic, then assemble storage and external effects around it.[^1]

### Economic connector boundary

Connectors are statically configured by the operator and started once with the daemon.
Connector API version 1 uses strict JSON Lines messages over retained stdin/stdout:

- `hello` negotiates the exact API version;
- `health` checks the existing process;
- `execute` carries a daemon-created operation ID, coordination ID, profile, network,
  closed operation enum, and operation-specific payload;
- `inspect` reconciles a prior operation by its durable ID; and
- `shutdown` requests clean termination.

The initial operation enum is deliberately closed: `escrow_secure`, `escrow_settle`,
`escrow_refund`, and `resolve_dispute`. The daemon checks connector type, supported
profile, and supported network before dispatch. It does not accept a method name from a
client.

Manifests contain identity, package version, connector API version and type, supported
profiles/networks, a relative entrypoint, SHA-256 digest, and source provenance. The
daemon uses a static allowlist, rejects parent-directory entrypoints, verifies the
digest at startup and before exchanges, clears the child environment, limits responses,
serializes access to each process, and terminates a timed-out child.

Connector success is not protocol settlement. It is private evidence from which an
authorized outcome event may later be constructed, signed, validated, and published.

### Durable operation rule

Value-moving retries cannot be based on transport failure alone:

```text
valid protocol authorization
  -> durable operation intent
  -> connector execute
  -> durable succeeded / failed / ambiguous result
  -> inspect ambiguous operation before any retry
  -> valid signed outcome event
```

An operation found in `running` state after daemon interruption becomes `ambiguous`.
It is never blindly repeated. This follows Temporal and Restate's central lesson that
external effects require durable history and reconciliation, while keeping that history
an implementation overlay rather than canonical Pontmore state.[^2]

## What the reviewed projects teach us

### Selected patterns

| Project/model               | Lesson adopted                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| LDK / LDK Node              | Small deterministic core assembled into an opinionated daemon                             |
| HashiCorp go-plugin         | Versioned, checksummed subprocess boundary and lifecycle                                  |
| Core Lightning              | Long-lived connector processes, explicit requests, notifications, and regtest discipline  |
| Dapr components             | Components remain outside the application process and expose an explicit service contract |
| Temporal / Restate          | Record intent and reconcile uncertain effects instead of blind retries                    |
| Kubernetes controllers      | Reconcile desired and observed state; tolerate restart and redelivery                     |
| Matrix Complement / A2A TCK | Test running implementations as black boxes, including process death and replay           |
| BTCPay Server               | Copy templates, diagnostics, provenance, release testing, and operator clarity            |

HashiCorp and Core Lightning are the closest runtime precedents. Both demonstrate that a
long-lived subprocess can preserve state and amortize startup while keeping dependencies
and crashes out of the host.[^3] Dapr reinforces the explicit component boundary, though
Pontmore does not initially need its gRPC/container complexity.[^4]

### Patterns intentionally not selected

| Model                        | Why it is not the current Pontmore model                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| BTCPay in-process plugins    | Excellent developer UX, but extension code shares the payment server's process and trust boundary                       |
| OpenClaw runtime plugins     | Useful application-host extensibility, but tools/hooks/services must not alter Pontmore validation or access connectors |
| elizaOS plugins              | Appropriate above Pontmore as an external application, not inside the economic daemon                                   |
| Wasm components              | Strong isolation for pure extensions, but there is currently no justified runtime-extensible protocol function          |
| Envoy dynamic filters        | Mature discovery/versioning machinery is disproportionate before a real connector ecosystem exists                      |
| Grafana/VS Code marketplaces | Signing and provenance lessons are useful later; a marketplace is premature                                             |
| Temporal as canonical state  | Durable workflow state is operational history and cannot replace signed PIP-02 history                                  |

BTCPay's merits still matter. Its templates, local debug loop, package metadata,
immutable releases, compatibility testing, diagnostics, and explicit warning that
listing is not endorsement are strong ecosystem practices.[^5] Pontmore can adopt them
for connector distribution without adopting in-process loading or plugin-owned protocol
semantics.

OpenClaw and elizaOS remain valuable examples of application frameworks. A Pontmore
integration for either should run outside `pontmored`, sign locally or via an approved
signer, submit signed events, and consume SSE.[^6]

Wasmtime/WASI was evaluated as a capability-oriented option for pure code.[^7] It is
deferred, not placed on the roadmap: adding it without a concrete extension requirement
would create another ABI, toolchain, lifecycle, and trust model while weakening the
simple rule that protocol semantics ship in the core.

## Current implementation

The reference workspace now implements the selected first slice:

- [`crates/daemon/src/api.rs`](https://github.com/pontmore/pontmore/blob/a19e4a0b4b400594b953c8db9332a50bb8a32bc9/crates/daemon/src/api.rs) exposes only signed
  event submission, SSE, and health probes;
- [`crates/daemon/src/connector.rs`](https://github.com/pontmore/pontmore/blob/a19e4a0b4b400594b953c8db9332a50bb8a32bc9/crates/daemon/src/connector.rs) manages
  static long-lived subprocesses and the closed connector command set;
- [`crates/daemon/src/coordinator.rs`](https://github.com/pontmore/pontmore/blob/a19e4a0b4b400594b953c8db9332a50bb8a32bc9/crates/daemon/src/coordinator.rs)
  validates ingestion, rebuilds affected coordinations, and creates durable eligible
  effects;
- [`crates/daemon/src/store.rs`](https://github.com/pontmore/pontmore/blob/a19e4a0b4b400594b953c8db9332a50bb8a32bc9/crates/daemon/src/store.rs) separates raw
  events, projections, connector operations, and durable stream events;
- [`deploy/connectors.example.json`](https://github.com/pontmore/pontmore/blob/a19e4a0b4b400594b953c8db9332a50bb8a32bc9/deploy/connectors.example.json) is the
  static allowlist example; and
- [`examples/connectors/simulated-escrow`](https://github.com/pontmore/pontmore/tree/a19e4a0b4b400594b953c8db9332a50bb8a32bc9/examples/connectors/simulated-escrow)
  is a no-value persistent connector used by the lifecycle test.

The process tests verify that handshake, health, execute, and inspect use the same PID,
and contain process death, malformed output, and timeout faults with bounded restart
backoff. The PostgreSQL pipeline
test replays a complete signed settlement history, checks automatic reconstruction and
idempotent secure/settle effects, and proves that the SSE projection excludes private
connector data. Descriptor currentness, authority validation, and resolution-effect
support remain explicit operator-established inputs; the daemon does not infer them
from local event order.

Execute commands carry the daemon operation UUID and a deterministic key derived from
coordination ID, triggering signed action, and operation type. Real connectors must
persistently deduplicate that key so database loss or node replacement cannot repeat an
external effect.

The P0/P1 connector control plane now includes periodic durable health, package/digest
audit identity, bounded restart backoff/budget, bounded structured stderr, operation-
scoped secret files sent only through the private channel, value approval thresholds,
resolver dispatch, and a fail-closed requirement for an external sandbox launcher.
Relay discovery, safe digest-pinned schema resolution, and signed-outcome publication
reconciliation are implemented without adding a public connector route.

OS resource/syscall/network enforcement and authenticated ingress are intentionally
deployment-owned: `pontmored` can require a configured sandbox launcher, but it does not
pretend a portable process API can enforce every host policy. A real connector must
provide persistent idempotency and isolated authority signing. Independent connector and
black-box relay implementations remain the next interoperability milestone.

## Compatibility and evolution

Version the connector protocol independently from Pontmore PIPs. API version 1 should
remain small until a real connector demonstrates missing requirements. Incompatible
changes use a new connector API version; connector package versions and digests are
pinned independently. Active operations retain the connector identity/version used.

Do not add dynamic discovery yet. A connector is installed through an operator-reviewed
file and daemon restart. Do not add an SDK until at least two independent connector
implementations prove the wire contract. Do not add a registry until provenance,
signing, revocation, compatibility testing, and security-response ownership exist.

## Next implementation milestones

1. Build one no-value/regtest connector independently from the simulated example.
2. Exercise two real relay implementations and a remote/isolated signing connector.
3. Add deployment-specific sandbox profiles and black-box whole-daemon chaos tests.
4. Publish the connector contract only after differential and failure-injection tests.

## Final recommendation

Commit to a static protocol kernel, external application extensions, and a single
long-lived subprocess model for economic connectors. Copy subprocess lifecycle from
HashiCorp/Core Lightning, durable reconciliation from Temporal/Restate, black-box
testing from Matrix/A2A, and packaging/operator discipline from BTCPay. Do not commit to
a general plugin ABI, Wasm runtime, dynamic marketplace, or client-callable connector
API.

This is deliberately less extensible. That is its main security and operability merit.

## Sources

[^1]: Lightning Development Kit. [`rust-lightning`](https://github.com/lightningdevkit/rust-lightning) and [LDK Node](https://github.com/lightningdevkit/ldk-node). Accessed 14 September 2026.

[^2]: Temporal. [Rust Core SDK](https://github.com/temporalio/sdk-rust); Restate. [Documentation](https://docs.restate.dev/). Accessed 14 September 2026.

[^3]: HashiCorp. [`go-plugin`](https://github.com/hashicorp/go-plugin); Core Lightning. [Plugin documentation](https://docs.corelightning.org/docs/writing-plugins). Accessed 14 September 2026.

[^4]: Dapr. [Pluggable components](https://docs.dapr.io/developing-applications/develop-components/pluggable-components/). Accessed 14 September 2026.

[^5]: BTCPay Server. [Plugin development](https://docs.btcpayserver.org/Development/Plugins/), [plugin template](https://github.com/btcpayserver/btcpayserver-plugin-template), and [Plugin Builder](https://github.com/btcpayserver/btcpayserver-plugin-builder). Accessed 14 September 2026.

[^6]: OpenClaw. [Plugin documentation](https://github.com/openclaw/openclaw/blob/main/docs/tools/plugin.md); elizaOS. [Repository](https://github.com/elizaOS/eliza). Accessed 14 September 2026.

[^7]: Bytecode Alliance. [Wasmtime documentation](https://docs.wasmtime.dev/); WebAssembly. [WASI design principles](https://github.com/WebAssembly/WASI/blob/main/docs/DesignPrinciples.md). Accessed 14 September 2026.
