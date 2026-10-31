# Mostro: Lightning P2P Exchange on Nostr

_Research snapshot: 19 October 2026. Sources: `MostroP2P/mostro` at `f1f7a62` (15 October 2026) and `MostroP2P/protocol` at `1ee50e4` (15 October 2026). This is analysis, not an adopted Pontmore specification._

Related notes: [Building on Mostro][leverage] · [Escrow policies and exchange patterns][escrow-patterns] · [Resolver-recoverable preimages][rrp] · [Bisq][bisq] · [Peer][peer]

[leverage]: ./mostro-pontmore-leverage.md

## Executive finding

Mostro is the project closest to Pontmore. It runs bitcoin/fiat trades on Nostr, uses Lightning hold invoices, is aimed at regions with unstable currencies, and even uses the same NIP-69 offer kind (`38383`) that Pontmore's `swap@1` uses. It makes the opposite choice on the central design question:

> **A Mostro node operator holds the hold-invoice preimage.** Neither trader can complete or reverse the escrow alone. The operator does it, either on the seller's instruction (`release`) or on a solver's ruling (`admin-settle` / `admin-cancel`).

That one decision explains both Mostro's strength (disputes can be enforced and the escrow can't be stalled by either trader) and its main trust assumption (the operator could cheat, and is briefly custodial at payout). Everything else in Mostro is careful engineering around that core:
- trade keys rotated per trade, plus an optional reputation identity;
- permission levels for solvers, including an AI assistant that can't move funds;
- a deadline guardian that opens a dispute itself instead of letting the clock refund the seller;
- reputation that can be carried between instances;
- payer-account history against "triangulation" fraud;
- anti-abuse bonds;
- a Cashu 2-of-3 mode in progress that removes operator custody.

For Pontmore, Mostro is the reference for **disputes in operator-run escrow** and for many **operational details on Nostr**.

## 1. Architecture

| Component | Role |
|---|---|
| `mostrod` | Rust daemon. Holds the node's Nostr key and an LND connection. Runs the order book, escrow, disputes, reputation and scheduler |
| Mostro instance | One operator's `mostrod` + LND + relays. Anyone can run one; users choose an instance |
| Clients | Mostro Mobile, `mostro-cli`, admin tools such as Mostrix. They speak the [protocol book][protocol] |
| lnp2pBot | The Telegram predecessor whose demand motivated Mostro. Its reputation can now be imported (§5) |

**Events.** All are addressable (NIP-33/01) unless noted:

| Kind | Purpose |
|---|---|
| `38383` | Orders (NIP-69 P2P order book) |
| `38384` | Ratings |
| `38385` | Instance info: fees, limits, protocol version, PoW, reputation issuers, Serbero key |
| `38386` | Disputes (status: `initiated`, `in-progress`, and four final statuses) |
| `38387` | Client announcements, signed by client projects |
| `38388` | Reputation attestations. Never published; carried in encrypted messages |
| `38389` | Health (Lightning sync, buyer payouts, relays) |

**Transport.** Protocol v2 (the only one since v0.19.0) uses signed NIP-44 kind-`14` messages:
- authored by a **per-trade key**;
- an encrypted third element proves the identity key;
- a NIP-40 expiration tag on every message;
- **proof of work** on "first contact" from unknown keys, against spam.

v1 used NIP-59 gift wraps. Mostro dropped them so relays can rate-limit by sender and the node can filter spam before decrypting. Trade keys are single-use, which limits what the visible sender reveals.

## 2. Keys and privacy

- **Derivation (NIP-06):** `m/44'/1237'/38383'/0/i`. Index `0` is the **identity key**, and each order or take uses the next **trade key** (index ≥ 1).
- **Reputation mode:** the client proves the identity key inside the encrypted message. The node can then link a user's orders to their reputation, while counterparties see only the trade key plus a rating.
- **Full privacy mode:** the identity key is never sent, so nothing links trades together. The cost is no reputation, and ratings for such users are silently dropped.
- **Restore session:** one mnemonic restores everything, and `last-trade-index` lets a client find its next trade key after restoring.

The trade identity is separate from the long-term identity, and the user chooses privacy or reputation. Pontmore's swap roots currently bind long-lived agent and customer keys.

## 3. Trade flow and escrow (Lightning mode)

Example: a sell order, where the maker sells sats.

1. **Order.** The maker publishes the order: fixed amount or a **range**, fiat code and amount, payment methods, premium. It expires after `expiration_hours` (default 24h, max 15 days).
2. **Take.** A buyer takes it and gives a Lightning invoice or **Lightning address**.
3. **Lock.** Mostro creates a **hold invoice with its own random preimage** (`lightning/mod.rs:471`) and asks the seller to pay it. The order becomes `active`.
4. **Fiat.** The buyer pays fiat and sends `fiat-sent`.
5. **Release.** The seller sends `release`. Mostro settles the hold invoice, which brings the sats onto its own node, then **pays the buyer's invoice** minus the fee. Failed payouts are retried, and the buyer can supply a new invoice (`payment_failed`).
6. **Cancel.** Both parties must agree to cancel (*cooperative cancel*). Mostro then cancels the hold invoice and the seller is refunded.

**Waiting states** (invoice or payment pending) time out after `expiration_seconds` (900s default).

**Hold invoice horizon:** `hold_invoice_cltv_delta = 144` blocks (about 24h). LND cancels automatically `holdexpirydelta` (12) blocks before expiry.

**Custody, honestly stated.** The README says "non-custodial". In practice:
- the operator holds the preimage for the whole trade;
- the operator receives the sats on its own node at settlement, before paying the buyer.

Users trust the operator not to settle and keep the funds. The design limits *how long* the operator holds funds, not *whether* it is trusted.

## 4. Disputes

Detailed in the [escrow note §2][escrow-patterns] and the earlier Mostro dispute review. In summary:

| Element | Mechanism |
|---|---|
| Opening | Either party, in `active` or `fiat-sent`. A public kind-`38386` event with status `initiated` |
| Taking | A solver sends `admin-take-dispute`. Both parties receive the solver's key and switch to a **private chat with the solver** (separate ECDH key per party) |
| Permissions | Solvers are `read` (can assist and chat) or `read-write` (can also `admin-settle` / `admin-cancel`). A write solver can take over from a read solver; the node key can take over anything |
| Serbero | An AI dispute assistant configured by the operator. The daemon **refuses to start** if its key has write permission |
| Evidence | A party may give the solver the **read-only** key to the buyer–seller chat. Messages are signed by trade keys, so authorship can be checked. The chat spec includes rules that stop a party from hiding messages from the solver's copy or replaying old ones |
| Rulings | `admin-settle`: the buyer is paid. `admin-cancel`: the seller is refunded. Separate final statuses record whether a solver or the users decided |
| Users can still settle it themselves | During a dispute, the seller can still `release` and both can still cooperatively cancel. The dispute then closes automatically |
| Deadline guardian | Every 5 minutes. Before LND's automatic cancel: `active` orders are refunded on purpose; **`fiat-sent` orders are moved into a dispute instead of being refunded** |
| Bonds | Optional anti-abuse bond as a second hold invoice. Slashed **only on an explicit solver order** (`slash_seller` / `slash_buyer`, independent of the trade outcome) or on a clear timeout. Part goes to the counterparty; the node's share pays solvers |

## 5. Reputation

- **Ratings.** After a successful trade, each side rates the other from 1 to 5. Orders carry the maker's `total_reviews`, `total_rating` and `since` (date of first trade). The old `days` field is deprecated, because a day count computed when the event was published goes stale on relays.
- **Portability.** Kind `38388` **reputation attestations** are signed by an issuer (another Mostro instance or lnp2pBot):
  - the destination identity, an opaque subject id, number of reviews, average rating, the date of the first trade, and a 7-day expiry;
  - **never published**: they travel only in encrypted export and import messages;
  - only native figures are exported, so an import never travels twice;
  - each node advertises which issuers it trusts.
- **Payer-account history against triangulation** (design, behind a flag):
  - **The scam:** an attacker takes an order and has a third party, tricked outside Mostro, pay the seller. The seller then holds money from someone who later disputes it.
  - **Why simple checks fail:** a per-trade reference or a declared sender doesn't help, because the attacker passes them to the victim.
  - **The signal:** how many successful trades *this user* has completed *from this payment identity*, and with how many distinct and experienced counterparties. It is computed privately by the node from hashes of the payment details, and returned as aggregate counts.
  - It is a **risk signal, never an automatic block**, because an honest first-time user looks the same.

## 6. Operating an instance

- **Fees.** An operator fee (configurable, `fee = 0` in the template). A **development fee** of 30% of the operator fee goes to a Lightning address; it is paid by the operator, never added to the user's amount.
- **Health and maintenance.** A kind-`38389` health event (Lightning sync, payouts, relays). `maintenance_mode` refuses new escrow while open trades finish, so an operator can drain the node before migrating it to a different Lightning node.
- **Limits.** `max_order_amount`, `min_payment_amount`, and `max_routing_fee` (0.2%).
- **Cashu mode (in progress).** Escrow locked 2-of-3 (buyer, seller, Mostro key `P_M`) with a locktime refund to the seller. A ruling makes Mostro *sign for the winner*: Mostro never holds funds and its signature alone can move nothing. Bonds are not supported in Cashu mode.

## 7. Strengths

1. **Disputes can be enforced.** The operator holds the preimage, so a solver's ruling always takes effect, and neither trader can stall the escrow.
2. **The clock never decides a paid trade.** The guardian moves `fiat-sent` trades into a dispute before the lock expires.
3. **Privacy and reputation are a per-user choice:** single-use trade keys, an optional identity, and full privacy mode.
4. **Solver roles are enforced by the daemon.** Read and write permissions, an AI assistant that can't move funds, and takeover rules.
5. **Evidence that can be checked:** chat messages signed by trade keys, read-only disclosure to the solver, and rules against hiding or replaying messages.
6. **Reputation carries over** through signed, private, expiring attestations, with each node choosing which issuers to trust.
7. **Concrete fraud defenses:** payer-account history against triangulation, proof of work at first contact, and bonds slashed only on a solver's order.
8. **Operator tooling:** health events, maintenance mode, documented settings, and a public protocol book.
9. **Federated.** Many independent instances share the NIP-69 order book.

## 8. Weaknesses and trade-offs

1. **Trusted operator.** Lightning mode requires trusting the operator not to steal. The operator is briefly custodial at payout, and in practice the solver works for the operator.
2. **Lightning-only escrow** with a horizon of about 24h, until Cashu mode ships.
3. **One operator per trade.** Both traders must use the same instance, so liquidity and reputation are split between instances (portability helps).
4. **Operator liability.** Running hold invoices on LND, solvers, and payouts is a real operational and possibly regulatory burden.
5. **Fragmented reputation signals.** Ratings are simple 1–5 averages; triangulation history depends on each node and doesn't travel between nodes.

## 9. Compared with Pontmore

| Dimension | Mostro | Pontmore (`swap@1` + clink/pontspark) |
|---|---|---|
| Discovery | NIP-69 `38383` orders published by the node | NIP-69 `38383` offers published by the agent ([swap@1][swap]) |
| Who coordinates | The instance operator | Peers directly; public PIP-02 chain |
| Escrow | Hold invoice to the **operator's** LND; operator holds the preimage | Hold invoice **between the traders' wallets** (Spark); provider holds the preimage |
| Who resolves | Solver registered by the operator; daemon-enforced permissions | The agent's own resolver key |
| Can rulings be enforced? | Yes (operator settles or cancels) | No (§4.1 of the [escrow note][escrow-patterns]) |
| Default when fiat was sent | Automatic dispute before expiry | Payer refunded at expiry |
| Keys | Trade key per trade + optional identity | Long-lived identity keys on roots |
| Reputation | Ratings, portable attestations, payer history | None yet |
| Message transport | Signed NIP-44 kind 14 from trade keys, with PoW | NIP-59 gift wraps with unsigned rumors |

## 10. Lessons for Pontmore

### For the Pontmore protocol

1. **Operator-run escrow is one valid pattern** (pattern A in the [escrow note][escrow-patterns]). Pontmore should support it explicitly, as `core/escrow` = operator with a declared `trust(operator)`, instead of only the peer-to-peer hold invoice. A Mostro-style operator profile would interoperate with existing users.
2. **Rotate keys per trade.** Bind a fresh key to each coordination's participant role and prove the long-lived identity privately, as Mostro's identity proof does. This gives Pontmore a full privacy mode and limits linkability on the public chain.
3. **Copy the evidence rules directly:**
   - inner chat events signed by trade keys;
   - read-only conversation key disclosure;
   - rules that stop a party from hiding messages from the solver or replaying old ones.

   This fixes the unsigned-rumor gap in clink/pontspark.
4. **Let parties settle mid-dispute.** A dispute shouldn't block a release or a cooperative cancel. Mostro closes the dispute automatically. PIP-02 currently freezes all ordinary progress (§7.3 of the escrow note).
5. **Make the guardian a protocol rule.** "Paid trades escalate to a dispute, unpaid trades refund" should be a profile requirement that every client enforces, not one daemon's behaviour.
6. **Portable reputation with the same shape.** Mostro's `38388` attestation (private, expiring, native figures only, trust list per destination) is a ready-made format. Pontmore could adopt it or align with it so reputation moves between Mostro, lnp2pBot and Pontmore agents.
7. **Payer-account history for mobile money.** Triangulation is a real risk for M-Pesa and similar rails. Pontmore agents can keep a private history keyed on a hash of each payer's identity (phone number, account), aligned with the payment-reference nullifiers proposed in the [escrow note §7.6][escrow-patterns]. It is a signal, never a block.
8. **Proof of work at first contact, and expiration tags** on coordination payloads, to keep relays and agents clear of spam.
9. **NIP-69 interoperability.** Both projects publish `38383`. Agreeing on shared tags (`rating`, `since`, payment methods) puts Pontmore agents in the same aggregators as Mostro orders.

### For operators of Pontmore escrows and resolvers

1. **Separate solver permissions in code.** Assistants (human or AI) should be able to read and chat without being able to settle. Mostro enforces this in the daemon, not the UI.
2. **Record who decided each outcome.** Separate final statuses for a solver's ruling and a users' resolution make operator decisions auditable.
3. **Offer an explicit custody reduction.** Mostro's Cashu 2-of-3 track shows how an operator can keep its arbitration role while giving up custody.
4. **Health events and maintenance mode:** publish liveness, and drain open escrow before changing infrastructure.
5. **Bonds slashed only on a solver's order**, with part going to the wronged party and part paying for disputes, give agents and customers accountability without automatic penalties.

## 11. Open questions

1. How are solvers chosen and paid in practice across instances? (Only the code and protocol are documented.)
2. Will Cashu mode ship with bonds, given that bonds and Cashu are currently mutually exclusive?
3. Could Pontmore coordinations reuse Mostro instances as `core/escrow` operators, so Mostro nodes serve as Pontmore escrows?

## Sources

- Daemon: [MostroP2P/mostro][mostro]: `src/escrow.rs`, `src/lightning/mod.rs`, `src/app/dispute.rs`, `admin_take_dispute.rs`, `admin_settle.rs`, `admin_cancel.rs`, `serbero.rs`, `src/scheduler.rs`, `settings.tpl.toml`; docs `SOLVER_PERMISSION_LEVELS.md`, `ADMIN_RPC_AND_DISPUTES.md`, `DISPUTE_AUTO_CLOSE_ON_USER_RESOLUTION.md`, `ANTI_ABUSE_BOND.md`, `PAYER_HISTORY_ANTI_TRIANGULATION.md`, `DEV_FEE.md`, `cashu/05-track-d-dispute.md`
- Protocol book: [MostroP2P/protocol][protocol]: `overview.md`, `key_management.md`, `order_event.md`, `other_events.md`, `dispute.md`, `dispute_chat.md`, `chat.md`, `user_rating.md`, `reputation_attestation.md`, `reputation_transfer.md`, `cancel.md`
- [mostro.network protocol documentation][mostro-docs]

[escrow-patterns]: ./escrow-policies-and-exchange-patterns.md
[rrp]: ./resolver-recoverable-preimage.md
[bisq]: ./bisq.md
[peer]: ./peer.md
[swap]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/profiles/swap-v1.md
[mostro]: https://github.com/MostroP2P/mostro
[protocol]: https://github.com/MostroP2P/protocol
[mostro-docs]: https://mostro.network/protocol/
