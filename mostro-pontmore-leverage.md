# Building on Mostro: How Pontmore Can Use Mostro's Work

_Research snapshot: 19 October 2026. Mostro sources: `MostroP2P/mostro` `f1f7a62`, `MostroP2P/protocol` `1ee50e4`, and the MostroP2P organization's repository list and licences (GitHub API, 19 October 2026). Pontmore sources: protocol `d9a1eb3` and the clink/pontspark apps. This is strategy analysis, not an adopted roadmap._

Builds on: [Mostro][mostro-note] · [Escrow policies and exchange patterns][escrow-patterns] · [Resolver-recoverable preimages][rrp]

## Executive finding

Mostro and Pontmore share the same goal (bitcoin/fiat exchange on Nostr for unbanked and inflation-hit markets) and much of the same technology (NIP-69 orders, Lightning hold invoices, NIP-44 encryption). They split on one architectural question:

| | Mostro | Pontmore |
|---|---|---|
| Source of truth | **The daemon's database.** Public events are the operator's statements | **A chain signed by the participants** (PIP-02). Anyone can rebuild the state |
| Who signs offers | The **Mostro node** (`38383` with the node's pubkey) | The **agent** (`38383` with the agent's identity key) |
| Message pattern | Client ↔ daemon request/response over Nostr | Peer ↔ peer, plus a public chain |
| Escrow and resolver | Always the instance operator | Separate roles bound in each root, replaceable |
| Extensibility | Each daemon feature has a matching protocol chapter | Versioned PIPs + profiles; mechanism-neutral descriptors |

Mostro's choice lets it ship a **working, production system** with a solver network, operations tooling, reputation and fraud defenses. Pontmore's choice gives it **portability and verifiability**, and lets roles be filled by anyone.

**The opportunity is to reuse Mostro's specifications, MIT-licensed components and people (users, solvers), without taking on its daemon-centred trust model.** Concretely, Pontmore should:

1. **Adopt Mostro's battle-tested specifications** where Pontmore has nothing or something weaker: per-trade keys, signed chat with read-only disclosure for disputes, proof of work at first contact, message expiry, the deadline guardian, solver permission levels, reputation attestations, and payer-account history.
2. **Reuse the MIT components** (`mostro-core`, `serbero`, `mostro-push-server`, `mostro-watchdog`, `mobile`) and avoid the GPL/AGPL ones in Pontmore's private apps.
3. **Interoperate at the edges:**
   - a shared NIP-69 order book;
   - reputation imported from Mostro and lnp2pBot;
   - Pontmore agents that make and take orders on Mostro instances through `mostro-cli` or `mostro-mcp`.
4. **Turn Mostro solvers into Pontmore resolvers *without custody*.** Using resolver-recoverable preimages ([RRP][rrp]) or a shared Cashu 2-of-3 escrow, solvers decide disputes on peer-to-peer escrows without running LND or holding funds. This fixes Mostro's biggest weakness and Pontmore's biggest gap at the same time.
5. **Offer Mostro instances a role inside Pontmore**, as declared operator escrows. Through a gateway or a native "Pontmore mode", a Mostro node can be the `core/escrow` and `core/resolver` for coordinations whose history stays participant-signed.
6. **Standardize together.** Take the shared pieces (reputation attestations, dispute-disclosable chat, trade-key derivation, NIP-69 extensions) to NIPs. Pontmore's protocol-first process is suited to that.

The rest of this note explains each point and the rules that keep Pontmore from losing its own strengths.

## 1. Architecture compared in depth

### 1.1 Who signs what

| Fact | Mostro | Pontmore |
|---|---|---|
| Offer / order | Node key (`38383`) | Agent identity key (`38383`, [swap@1 §Offers][swap]) |
| Agreement to trade | `take-sell` / `take-buy` sent privately to the daemon | Root (`7300`) signed by the proposer; `core/accept` by the counterparty |
| Escrow secured | Daemon state `active`; order event updated by the node | `core/secure` by `core/escrow` |
| Fiat sent / confirmed | `fiat-sent`, `release` sent privately to the daemon | `swap/fiat_sent`, `swap/fiat_confirmed` signed by the participants |
| Dispute | Node publishes `38386` | `core/open_dispute`, `core/resolve_dispute` on the chain |
| Outcome | Node updates `38383` and `38386` status | `core/settle` / `core/refund` |
| Rating | Node publishes `38384` | — |

In Mostro, nobody outside the operator can check that a status update reflects what the traders actually did. In Pontmore, every step is signed by the role allowed to take it, and any client can replay the chain.

### 1.2 Mapping Mostro states to the PIP-02 kernel

| Mostro status (`mostro-core` `Status`) | PIP-02 / `swap@1` equivalent |
|---|---|
| `Pending` (order published) | NIP-69 offer (no root yet) |
| `WaitingMakerBond`, `WaitingTakerBond` | Linked `pontmore/bond@1` coordinations being funded |
| `WaitingBuyerInvoice`, `WaitingPayment` | Root + `core/accept`; lock being set up |
| `Active` | `core/secure` |
| `FiatSent` | `swap/fiat_sent` |
| `release` → `SettledHoldInvoice` → `Success` | `swap/fiat_confirmed` + `core/authorize_settlement` → `core/settle` |
| `CooperativelyCanceled` | `core/cancel`, or `authorize_refund` + `core/refund` after securing |
| `Dispute` | `core/open_dispute` |
| `SettledByAdmin` / `CompletedByAdmin` | `core/resolve_dispute{authorize_settlement}` → `core/settle` |
| `CanceledByAdmin` | `core/resolve_dispute{authorize_refund}` → `core/refund` |
| `Expired`, `Canceled` | `core/expire`, `core/cancel`, `core/decline` |

`InProgress` is a dispute status (`38386`), not an order outcome. The doc comments in `mostro-core` describe `Active` as "published and available to be taken". Here we follow the protocol book and daemon (`dispute.rs` allows disputes only in `Active` or `FiatSent`), where `Active` means the hold invoice is paid.

The mapping is nearly one-to-one. A Mostro trade can be written as a `swap@1` coordination without losing meaning, which is what makes the gateway in §5.2 feasible.

## 2. What Mostro has that Pontmore lacks

| Mostro asset | Licence | What Pontmore gains | How to use it |
|---|---|---|---|
| Protocol book (`MostroP2P/protocol`) | **None declared** | Years of edge cases in specification form | **Adopt the ideas; ask the Mostro team for a licence before copying text** |
| `mostro-core` (Rust) | MIT | Chat crypto, transport, rating/reputation, payer types | Reuse in Pontmore's Rust reference library ([implementation plan][impl]) where it fits; avoid daemon-specific types |
| `serbero` (dispute assistant) | MIT | Notifies solvers, gathers facts in the parties' language, mediates read-only, hands over a summary | Fork or adapt as a Pontmore **resolver assistant** bound under a separate assist-only marker (escrow note §7.2) |
| `mostro-push-server` | MIT | Waking mobile apps for Nostr events | Fixes resolver and recipient liveness (RRP's ~4h window, guardian escalation) |
| `mostro-watchdog` | MIT | Monitoring of instances and health events | Monitoring for agents and resolvers |
| `mobile` (Dart) | MIT | UI patterns for trade flows | Reference; reusable |
| `app` (Dart) | **AGPL-3.0** | New client | **Learn only.** Pontspark is private |
| `mostrod`, `mostro-cli`, `mostrix`, `mostro-startos` | **GPL-3.0** | Daemon, CLI and TUI | **Learn only** for private apps. A GPL Pontmore component would have to be separate and published |
| `mcp`, `mostro-skill` | none / MIT | AI agents trading on Mostro through MCP | A pattern for Pontmore agents run by AI (PactAgent) |
| Solver community, users, lnp2pBot history | — | People and liquidity | Interoperability (§4) and the resolver network (§5) |

**The licence boundary is a hard rule.** `pontmore/pontspark` is private. No GPL or AGPL Mostro code may enter it or clink. MIT components and **specifications** are fair to reuse. The protocol book has no declared licence, so Pontmore may implement its ideas but should get permission before reproducing its text.

## 3. Mostro's weaknesses and how Pontmore's design answers them

| Mostro weakness | Root cause | Pontmore's answer | Must keep |
|---|---|---|---|
| Operator holds the preimage, and holds funds briefly at payout | The operator is the escrow | Escrow is a declared policy. Peer-to-peer locks with resolver recovery ([RRP][rrp]), or Cashu/on-chain 2-of-3 | The [property checks][escrow-patterns] (§4): enforceable, no unilateral theft, declared default |
| Orders signed by the node, so traders are tied to one instance | Node-centred order book | Agent-signed offers that can be taken through any escrow or resolver the parties accept | Offers stay agent-signed; operators never sign offers on an agent's behalf |
| Status is the operator's word | Daemon database is the truth | Participant-signed PIP-02 chain | Operator actions are only those of a **bound authority** on the chain |
| Solver chosen and paid by the operator | Resolver tied to the escrow | `core/resolver` bound per root and approved by the party at risk; resolver sets with a threshold | Resolver independence (escrow note §4.4) |
| Reputation split across instances | Ratings stored per instance | Reputation from verifiable chains + imported attestations | No reputation scheme becomes canonical protocol state |
| Lightning only, horizon ~24h | LND hold invoices | Escrows that are neutral about mechanism (PIP-01 capabilities) | Descriptors describe capabilities, not brands |
| Operator liability and liveness | One node does everything | Roles split: escrow, resolver, assistant, relay | Every role can be replaced and is optional where the mechanism allows |

## 4. What Pontmore must not lose

Every Mostro-derived feature must pass these invariants:

1. **Participant-signed truth.** Economic progress is recorded only by chain actions from the role allowed to take them. Operator databases, gateway logs and daemon states are overlays ([README §Design Boundary][readme]).
2. **Offers belong to agents.** An offer is signed by the agent. An operator may relay, index or cache it, never author it.
3. **Authorities are bound and replaceable.** Mostro nodes, solvers and assistants appear only as `core/escrow`, `core/resolver` or assist-only keys in a root that the parties accepted.
4. **Specifications, not code.** Whatever Pontmore adopts is written as PIP or profile text with test vectors, so a second implementation can build it without Mostro's code.
5. **Neutral about mechanism.** A Mostro-style operator hold invoice is *one* escrow template (pattern A with `trust(operator)`), next to peer-to-peer, Cashu, on-chain and contract templates.
6. **Privacy matches Mostro or does better.** Per-trade keys and minimal public content; no feature adopted from Mostro may make public events easier to link than Mostro's.

## 5. Ways to integrate

### 5.1 Shared offers (low effort, low coupling)

Both projects publish NIP-69 `38383`. To let one client show both:
- Agree on extension tags: `rating` with `{total_reviews, total_rating, since}` (day-truncated, as Mostro does for unlinkability), `layer`, payment methods, `expires_at`.
- Mark the protocol clearly (`protocol` / `y` tags) so a client only *takes* an offer it can execute.
- Keep Pontmore's agent-signed offers. A Mostro-aware client sees "taking this offer needs Pontmore".

### 5.2 Mostro node as a Pontmore escrow operator (medium effort, needs Mostro buy-in)

A Mostro node is a ready-made operator escrow with solvers. Two options:

**Gateway sidecar (no upstream change).** A service next to `mostrod`:
- **Advertises** a PIP-01 descriptor:
  - `escrow_type: lightning_hold_invoice`;
  - capability template `operator-hold@1`;
  - `trust(operator)` declared;
  - service schema describing the gateway API.
- **Accepts** Pontmore roots that bind its key as `core/escrow` and a Mostro solver key as `core/resolver`.
- **Drives** `mostrod` through `mostro-cli`/MCP-style calls: creates and takes the order, relays invoices.
- **Publishes** `core/secure`, `core/settle` and `core/refund`, each with evidence, as Mostro reaches each state (§1.2 mapping).
- **Fit:** Mostro's flow is centred on its own orders, so the gateway must create a node order for each coordination. It works, but the node's order book shows orders that are really Pontmore trades.

**Native "Pontmore mode" in `mostrod` (upstream contribution).** `mostrod` validates PIP-02 roots and acts as escrow authority directly:
- signs kernel actions with a dedicated escrow key;
- maps its state machine onto the chain;
- adds a `38385` tag advertising Pontmore support.
- **Benefit:** this is cleaner and lets the Mostro community serve Pontmore coordinations natively. It requires agreement and work from the Mostro maintainers.

Either way the trust stays explicit: the descriptor declares the operator, the property checks list `trust(operator)`, and users choose it knowingly.

### 5.3 Mostro solvers as custody-free Pontmore resolvers (high value, low coupling)

The best fit:
- **Who:** a Mostro solver, or a solver team, publishes a `pontmore/resolver@1` capability: keys, policy, response-time promise, fee (escrow note §7.7).
- **Escrow they work with:**
  - **Lightning:** peer-to-peer Spark/LND hold invoices whose preimage can be recovered by the resolver through [RRP][rrp]. The solver needs **no LND node and holds no funds**. They release a preimage share when ruling for the recipient.
  - **Cashu or on-chain:** a 2-of-3 with the solver's key (policy C1/C2).
- **Assistant:** a Serbero fork bound under the assist-only marker. It notifies, gathers facts, and steers the parties towards settling it themselves (release or cooperative cancel). PIP-02 must stop freezing these actions during a dispute (escrow note §7.3).
- **Evidence:** Mostro's chat specification (signed inner events, read-only `K_conv` disclosure, the anti-hiding `p`-tag rule) becomes Pontmore's private channel, replacing unsigned NIP-59 rumors.
- **Liveness:** `mostro-push-server` wakes the solver's and recipient's apps within the hold horizon.

This keeps Mostro's best asset (a working human and AI resolution pipeline) and drops its weakest (operator custody). It also fixes Pontmore's worst gap (an agent that resolves its own disputes).

### 5.4 Shared Cashu escrow (medium effort, shared work)

Mostro's Cashu Track D (2-of-3 with the arbitrator key `P_M`, locktime refund to the seller, Mostro delivering its signature to the winner) and Pontmore's C2 policy are the same pattern. A single specification and shared test vectors would let:
- Mostro nodes and Pontmore resolvers act as interchangeable arbitrators;
- Pontmore's policy checks validate Mostro Cashu escrows (and flag the NUT-11 post-locktime race noted in the escrow note §3.3).

### 5.5 A bridge for reputation

- **Import.** Pontmore agents and clients accept Mostro `38388` attestations (and lnp2pBot's), using Mostro's rules: private delivery, native figures only, expiry, a trust list per destination.
- **Export with stronger backing.** Pontmore can issue attestations whose figures are **derived from verifiable PIP-02 chains** (count of settled coordinations, distinct counterparties), not from an operator's database. That is a strictly stronger signal, and Mostro nodes could choose to trust it.
- Rating `since` stays day-truncated to avoid linking trades.

### 5.6 A bridge for liquidity (lowest effort)

A Pontmore agent can also be a Mostro maker or taker, driven by `mostro-cli` or `mostro-mcp`. No protocol change. Agents reach Mostro's users today, and Pontmore learns from Mostro's flows in practice. The trade-off is that those trades use Mostro's trust model, not Pontmore's.

### 5.7 Standardizing as NIPs

Candidates where both projects (and others: lnp2pBot, Peer-style clients, RoboSats-like systems) benefit:

| NIP candidate | Basis |
|---|---|
| Reputation attestation | Mostro `38388`, extended with chain-backed figures |
| Chat with dispute disclosure | Mostro `chat.md` (`K_conv` / `K_sign` split, read-only disclosure) |
| Trade-key derivation | Mostro NIP-06 path, generalized beyond `38383` |
| NIP-69 extensions | `rating`/`since`, protocol marker, escrow and resolver tags |
| Service health and info | Mostro `38385` / `38389` patterns for escrow operators and resolvers |
| First-contact proof of work | Mostro `pow_first_contact` |

Pontmore's PIP process (versioned, vector-driven, implementation-neutral) is the natural place to draft these before proposing them as NIPs.

## 6. Specifications to adopt into Pontmore now

Ranked by value for the work needed:

1. **Signed chat and disclosure for disputes** (Mostro `chat.md`, `dispute_chat.md`) → Pontmore's private-channel profile. Fixes the unsigned-rumor evidence gap.
2. **Solver permission levels and an assist-only role** → PIP-02 assist marker; daemon-style enforcement in resolver software.
3. **Deadline guardian rule** ("paid trades escalate, unpaid trades refund") → `swap@1` requirement, enforced by every client.
4. **Settling it themselves during a dispute** (release or cooperative cancel closes the dispute) → PIP-02 change so these aren't frozen.
5. **Per-trade keys + private identity proof** → profile option binding fresh keys to roles, with optional proof of the identity key.
6. **First-contact proof of work + NIP-40 expiry** on private payloads.
7. **Reputation attestation format** (import first, export chain-backed figures).
8. **Payer-account history** (hashes of payment identities, private aggregate counts) → aligns with payment-reference nullifiers (escrow note §7.6); an important signal against M-Pesa triangulation.
9. **Bonds slashed only on a solver's explicit order** → `pontmore/bond@1` linked-coordination profile (escrow note §6.4).
10. **Operator health and maintenance events** → optional for operators of escrows and resolvers.

## 7. Phased roadmap

| Phase | Goal | Deliverables | Depends on Mostro? |
|---|---|---|---|
| 0. Align | Relationship and licensing | Contact the Mostro maintainers; confirm protocol-book licence; agree on shared NIP-69 tags | Yes (talks) |
| 1. Adopt | Close Pontmore's gaps with proven specifications | Signed chat profile; trade keys; PoW + expiry; guardian rule; settling during disputes; assist-only marker | No |
| 2. Interoperate | Users and reputation | NIP-69 tag alignment; `38388` import; liquidity-bridge agent via `mostro-mcp` | Light |
| 3. Resolvers | Custody-free dispute resolution | `pontmore/resolver@1`; RRP in clink/pontspark; Serbero-based assistant; push wake-ups | No (reuses MIT code) |
| 4. Shared escrow | One Cashu 2-of-3 specification | Joint spec + vectors with Mostro Track D; Pontmore policy template | Yes (collaboration) |
| 5. Operator escrow | Mostro nodes serve Pontmore | Gateway sidecar, then native mode if Mostro wants it | Yes (for native) |
| 6. Standardize | Shared NIPs | Reputation attestation, dispute chat, trade keys, NIP-69 extensions | Yes (joint) |

Phases 1 and 3 need nothing from Mostro, and deliver most of the value.

## 8. Risks and open questions

1. **Mostro's interest.** Phases 4–6 need Mostro maintainers to see value. Pontmore should come with working code and vectors, not only requests.
2. **Transport divergence.** Mostro v2 sends *signed* kind-14 messages from trade keys (a deliberate NIP-17 deviation); Pontmore uses NIP-59 gift wraps. Pick one per channel, or define both, before claiming chat interoperability.
3. **Identity models.** Mostro ties reputation to an identity key proven privately; Pontmore roots bind identities publicly. Per-trade keys in Pontmore need a way to build reputation that doesn't link trades publicly (private proofs, or attestations only).
4. **Licences.** Keep GPL and AGPL out of private apps; get a licence for the protocol book before reusing text.
5. **Operator escrows are still trusted.** Supporting Mostro nodes as escrows must not become the default. The descriptor and property checks have to make `trust(operator)` visible to users.
6. **RRP's limits apply** (selective abort, ~4h Spark horizon). Phase 3 resolvers inherit them until longer-lived escrows (Phase 4) are available.

## Sources

- Mostro: [mostro][mostro] (daemon), [protocol][mostro-protocol] (`order_event.md`, `chat.md`, `dispute_chat.md`, `key_management.md`, `reputation_attestation.md`, `other_events.md`), [mostro-core][mostro-core] (`src/order.rs` `Status`), [serbero][serbero], [mcp][mcp], and the [MostroP2P organization][org] (licences as reported by the GitHub API on 19 October 2026)
- Pontmore: [README][readme], [PIP-02][p02], [`swap@1`][swap]; research notes [Mostro][mostro-note], [Escrow policies][escrow-patterns], [RRP][rrp], [Implementation][impl]

[mostro-note]: ./mostro.md
[escrow-patterns]: ./escrow-policies-and-exchange-patterns.md
[rrp]: ./resolver-recoverable-preimage.md
[impl]: ./implementation.md
[readme]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/README.md
[p02]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/PIP-02-coordination-event-chains.md
[swap]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/profiles/swap-v1.md
[mostro]: https://github.com/MostroP2P/mostro
[mostro-protocol]: https://github.com/MostroP2P/protocol
[mostro-core]: https://github.com/MostroP2P/mostro-core
[serbero]: https://github.com/MostroP2P/serbero
[mcp]: https://github.com/MostroP2P/mcp
[org]: https://github.com/MostroP2P
