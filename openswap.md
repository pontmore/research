# OpenSwap and Pontmore: Shared Ideas and What to Adopt

_Research snapshot: 31 October 2026. OpenSwap sources: [`citadel-foss/openswap`][os] `08f9194` (22 October 2026), [`citadel-foss/OpenSwap-Protocol-Specification`][os-spec] `c747759` (27 September 2026), and [openswap.live][site]. The site is a client-rendered page whose text points back to the repository, so the code and spec are the evidence. Pontmore sources: protocol `main` `edcf137`; the NIP-69 offer text comes from the unmerged [offers PR #28][pm-offers]. This is a strategy analysis, not an adopted roadmap._

Builds on: [Mostro leverage][mostro-leverage] · [Escrow policies and exchange patterns][escrow-patterns] · [OpenPleb interop][openpleb]

## Executive finding

OpenSwap is a production-grade implementation of the Maxwell–Belcher **coinswap** protocol: a decentralized marketplace where *makers* sell bitcoin-for-bitcoin swaps (on-chain, Taproot/MuSig2, and Lightning submarine swaps) to *takers* who want privacy. Pontmore is a Nostr-native protocol for **bitcoin/fiat** coordinations between agents and customers.

Both projects try to build a **marketplace with no operator**: anyone can be a maker or agent, discovery runs over public infrastructure, advertisements are signed, and funds stay self-custodied. They differ in one basic way:

| | OpenSwap | Pontmore |
|---|---|---|
| What is exchanged | BTC ↔ BTC (and BTC ↔ Lightning) | BTC ↔ fiat (M-Pesa, bank, etc.) |
| Can the exchange be atomic? | **Yes.** Both legs are Bitcoin script | **No.** The fiat leg is outside Bitcoin |
| Who settles disputes | Nobody needs to. Timelocks refund every abort | Escrow + resolver roles (PIP-02) |
| Source of truth | Bitcoin chain + each party's local wallet state | Participant-signed Nostr event chain |
| Why trust a counterparty | **Fidelity bond**: provably costly, on-chain | Nothing yet. PIP-02 puts Sybil resistance, reputation and bonding out of scope |
| Nostr's role | Discovery cache only, signed with a throwaway key | Identity, discovery, and coordination state |
| Transport | Tor only. The taker relays all maker messages | Public relays + NIP-59 gift wraps |
| Primary goal | Fungibility and privacy | Access to bitcoin through local fiat rails |

Because its trades are atomic, OpenSwap does not need resolvers. So the dispute machinery Pontmore needs is not here. What OpenSwap does have is a mature answer to a problem Pontmore has deferred: **how a client chooses a counterparty it has never met, in a market nobody runs.** Its answer is fidelity bonds, plus a careful client-side record of which makers are unavailable and which are banned.

**Recommendations, in priority order:**

1. **Define an optional `pontmore/fidelity@1` attestation** that binds a time-locked Bitcoin UTXO to an agent's (or resolver's or escrow's) Nostr identity. It is verifiable from the chain alone and gives a Sybil cost that does not depend on any reputation operator (§2).
2. **Adopt OpenSwap's split between faults that can be recovered from and faults that are proven** as the reference client policy for choosing agents. Bans come only from what can be proven with signatures and arithmetic, which Pontmore's signed chains provide (§3).
3. **Write OpenSwap's forward-compatibility rules into the profile registry:** names are append-only, `@N+1` must be a superset of `@N`, lists have bounds, and old wire and storage fixtures stay in CI (§4).
4. **Treat a relay subscription as a lossy watch, not proof of absence.** OpenSwap's recent watchtower fixes show what happens otherwise. Pontmore deadlines (`fiat_confirm_by`, dispute windows) carry the same risk (§5).
5. **Borrow smaller patterns:** a per-profile "where can each role refuse, and what does it cost" table; quotes that price locked capital × time exactly; and local, opt-in screening of funding sources (§6).
6. **Interoperate at the edges:** an OpenSwap maker can rebalance an agent's on-chain and Lightning liquidity without a custodial swap service, and can break the chain-analysis link between an agent's trades and their cold storage (§7).

## 1. How OpenSwap works

**Roles.** *Makers* run `makerd` (Tor + Bitcoin Core or Electrum) in an "install-fund-forget" mode, earning fees for liquidity. *Takers* pay every fee, need no bond, and hold all the protocol complexity: "smart client, dumb server". A taker routes a swap through several makers and relays every message between them, so no maker sees the whole route ([README][os-readme], [introduction][os-intro]).

**Contracts.** v1 uses a 2-of-2 funding output plus an HTLC contract transaction. v2 uses one Taproot output with MuSig2 key-path cooperation and script-path hashlock and timelock branches ([v2 spec][os-spec]). Every abort ends with each party taking its own coins back by timelock. The [security spec][os-security] lists abort and malice cases. Each one costs the misbehaving party fees and time, and never someone else's principal.

**Lightning.** `ln-swap-in`, `ln-swap-out`, and `ln-swap-routed` (on-chain → maker 1 → Lightning → maker 2 → on-chain, with no Lightning node needed by the taker). Lightning support is compiled out by default and runs through an `ldk-server` sidecar ([lightning.md][os-ln]).

**Marketplace.** Each maker creates a CLTV fidelity bond whose transaction carries an `OP_RETURN` of `{onion}#{locktime}`. The chain itself is the canonical maker registry. For a fast bootstrap, makers also publish the bond outpoint to Nostr: kinds `37790`–`37794` (one per Bitcoin network), `d=fidelity:<txid:vout>`, a 24-hour NIP-40 expiration, signed by a **freshly generated key** each time ([`maker/nostr.rs`][os-nostr]). After the bootstrap, the taker follows new blocks and stops relying on relays ([architecture][os-arch]).

**Fidelity bonds** ([spec][os-fidelity], [`wallet/fidelity.rs`][os-fidelity-rs]):

- The script is `<pubkey> OP_CHECKSIGVERIFY <locktime> OP_CLTV`, locked for 12,960–25,920 blocks (about 3–6 months).
- A certificate `fidelity-bond-cert|outpoint|pubkey|lock_time|amount|onion|tweakable_point` is signed by the bond key.
- The bond key must derive from the maker's identity key at `m/175'/2/<index>`, so one maker cannot claim another's bond.
- Bond value is `(locked × (e^(r·t) − 1))^1.3`. The exponent is superlinear, so one large bond is worth more than many small ones. That makes splitting into Sybils expensive.

**Fees** ([fee-policy.md][os-fees]): a flat part, an amount part, and a time part (per block of refund locktime). Miner fees use fixed transaction sizes that both sides compute identically. "If the agreed numbers cannot produce an exact price, the swap stops. Neither side estimates." The general spec's defaults (1,000 sats, 2.5%, 0.1%) are stale. The code uses 500 sats, 0.0025%, and 0.0001%/block (`src/maker/api.rs:357`).

## 2. Fidelity bonds for Pontmore agents

### 2.1 The gap

PIP-00 and PIP-01 say clearly that a signed advertisement "proves authorship, not availability, performance, solvency, reputation, price, or trustworthiness". PIP-02 leaves "resolver selection, reputation, Sybil resistance, staking, bonding" outside Pontmore. That boundary is right for the core. But it leaves every client open to an agent who can generate npubs for free: create 50 agents with good prices, take fiat, disappear, and repeat. Offers under PR #28 make this cheaper still, because a NIP-69 aggregator will list every one of them.

The options in earlier notes all depend on someone else. Mostro and lnp2pBot reputation imports depend on their operators. SeD or PeerBadge attestations depend on the attesters. A per-trade `pontmore/bond@1` ([escrow note §6.4][escrow-patterns]) depends on a resolver to slash it. A fidelity bond is the one signal a client can check **against the Bitcoin chain alone**.

### 2.2 Sketch: `pontmore/fidelity@1`

An optional capability profile, referenced from the PIP-00 agent definition:

- **Bond output.** OpenSwap's script, unchanged (P2WSH CLTV, or a Taproot equivalent later). Reusing the script lets one UTXO back both an OpenSwap maker and a Pontmore agent run by the same operator, *if both certificates are published*. Whether that sharing is wanted is an open question (§8).
- **Binding is two-way, and needs no BIP32.** Pontmore identities are Nostr keys, not wallet xpubs. The bond key signs `pontmore-fidelity@1|<outpoint>|<npub hex>|<lock_time>|<amount>`, and the Nostr identity signs the event that carries it. Both signatures are needed: the first stops someone claiming a bond they do not control, and the second stops a bond owner pinning their bond on someone else's identity.
- **One bond, one identity.** If a client sees one outpoint certified for two different pubkeys, it MUST treat the bond as backing neither. This replaces OpenSwap's derivation-path check.
- **Value is local policy.** Publish the inputs (amount, `conf_height`, `lock_time`). Do not publish a score. The bond-value formula, the interest rate, and the minimum accepted value belong to the client, just as PIP-01 bans mutable pricing formulas.
- **Optional `OP_RETURN` anchor** for the npub (32 bytes fits). This gives a client a way to list agents that relays cannot censor. Most mobile clients will never scan the chain, so this is a backstop, not the main path.

### 2.3 Limits to state in the profile

- **A bond is a Sybil cost, not collateral.** It cannot be slashed, and it does not repay a customer who was defrauded on the fiat leg. An agent with a large bond can still scam once. The bond only makes discarding the identity afterwards expensive. Pair it with `pontmore/bond@1` (slashable, per trade) and with reputation. Do not replace them.
- **It costs capital that small agents lack.** An M-Pesa agent holding 0.005 BTC of float cannot lock 3–6 months of it. A client should use bond value as one way to rank agents, and must not require a bond to appear in a listing. Bonds fit **resolvers and escrow operators** better: they are fewer, better capitalized, and more attractive to Sybil attackers. Clients should require a bond there first.
- **Linking privacy.** A bond is a public UTXO linked to the identity for months. Operators should fund it from coins they are willing to link, which is one more reason to offer coinswap through OpenSwap (§7).

## 3. Choosing counterparties: unavailable vs. banned

OpenSwap's taker keeps an *offerbook* with typed states ([`taker/offers.rs`][os-offers]):

- `Unavailable{reason, since, attempts}`: a fault that cannot be pinned on the maker, such as `NoOfferResponse` ("an unreachable maker and an unreachable taker look the same"), `BondUnconfirmed`, `BondExpired`, `BondReorged`, or `UnpriceableOffer`. A later good offer clears it.
- `Banned{reason}`: kept until the user removes it, and **only for proven faults**: `ProvenViolation` ("by arithmetic or by a failed signature check"), `InvalidFidelityProof`, or `FundingWithheld` (backend confirmed every promised transaction is absent).
- `BackendDown` errors are the taker's own problem "and must not count against them". An error nobody anticipated "proves nothing".
- Both enums are frozen: new variants are never added.

Pontmore's signed chains make this kind of record easy to keep. Each fault class maps to something a client can verify:

| Pontmore observation | Class | Evidence |
|---|---|---|
| Two valid actions by the same role signer on one predecessor (fork) | **Banned** | Both signed actions, kept per PIP-02 |
| Offer quote that fails the PR #28 binding rules (wrong price arithmetic, escrow/resolver mismatch) | **Banned** | The signed offer + root |
| `core/secure` signed while the lock does not exist | **Banned**, if the escrow type can prove absence (e.g. a hold-invoice lookup) | Signed action + backend proof |
| Bond certified for two identities (§2.2) | **Banned** for both | Two certificates |
| No `core/accept` before `expires_at`; descriptor expired; superseded offer declined | Unavailable | — |
| Relay timeout, unreachable, decryption failure | **Not counted** (our side) | — |
| Customer reports fiat not received | **Neither.** That is a dispute for the resolver, not a fact the client can prove | — |

Recommendation: publish this table as non-normative client guidance next to `swap@1`. It keeps clients from treating local unreachability as misbehavior, and it gives future reputation attestations a clear rule: **only proven classes may be attested as faults.**

## 4. Forward compatibility as a written rule

OpenSwap has just made "one last breaking release" (`08f9194`, PR #1137). [`protocol/features.rs`][os-features] now carries the rules every later release must keep:

- Feature names are **append-only**. A name, its meaning, its reader, and its recovery are never removed.
- `x-v(N+1)` keeps every guarantee of `x-vN`. Anything that does not is a **new family**. Requiring `x-vN` means "version N or higher".
- An incompatible encryption or KDF change adds a new format name and **keeps the old reader**.
- Peer lists have bounds (128 names, 64 bytes each).
- The Nostr kinds moved (`37778`–`37782` → `37790`–`37794`) so that old clients stop finding makers they cannot talk to, and the content is frozen except for appended fields.
- `src/compat_fixtures/` (wire, storage, offerbook) and `tests/TESTS.golden` pin old encodings in CI.

Pontmore already versions profiles (`pontmore/swap@1`) and pins exact versions in roots. What it lacks is the rule for what `@2` may change. Proposal for the profile registry README:

1. `<profile>@N+1` MUST accept every chain that `@N` accepts and keep every `@N` safety guarantee. Otherwise it is a new profile name.
2. Action, role, and dispute-class identifiers are never reused with a new meaning.
3. Capability and channel lists in PIP-00 and offers SHOULD have bounds stated in the profile (count and length). A relay or agent should reject an oversize list instead of truncating it.
4. Each profile's conformance vectors are kept forever and run against every later version.

## 5. Relay subscriptions are lossy watches

OpenSwap's two most recent fixes both concern its watchtower assuming it had seen everything:

- `87a1e54` (#1152): recover spends after a ZMQ notification was lost.
- `5245d8e` (#1172): Electrum watches stopped answering "unspent" while they may have missed a spend. A failed fetch is now `Unfetched`, and any transport failure re-arms every subscription.

In Pontmore the same mistake would decide money. A client that sees no `core/open_dispute` before `fiat_confirm_by`, or an agent that sees no `swap/fiat_sent` before `fiat_pay_by`, may act on a deadline (settle, refund, or default) when the event exists and was only missed: a relay dropped the subscription, the client was offline, or a gift wrap arrived late. Rules for implementations (and a candidate PIP-02 note):

- Before acting on a deadline because an event is absent, run a fresh query with `since` set before the deadline, against more than one relay, and wait for EOSE.
- Track "armed" state for each subscription. Any reconnect re-arms and back-fills from the last confirmed `created_at` with an overlap.
- Report "unknown" rather than "absent" when no relay answered. This is OpenSwap's `Unfetched`.
- Add restart tests modeled on `tests/integration/restart/` (taker restart, reboot, watchtower liveness): kill the agent or client at each `swap@1` state and require correct recovery from relays plus local keys.

## 6. Smaller patterns worth borrowing

**Refusal-cost tables.** [blocklist.md][os-blocklist] tabulates, for every swap type and role, *where* a party can still refuse and *what refusing costs* ("reserved UTXOs released" vs "timelock recovery" vs "Lightning payment stays held until it expires"). It ends with "the taker always commits first, so this asymmetry follows from the protocol." Each Pontmore profile should carry the same table: for each state, the role that can walk away and what it loses. This is the escrow note's "who moves first" rule (§6.2) made checkable.

**Exact, capital-time-priced quotes.** OpenSwap prices a time part (amount × locktime) because a failed swap locks the maker's coins until the timelock. A Pontmore agent selling BTC has the same exposure: the hold invoice stays locked until `fiat_confirm_by` or the dispute window ends. PIP-01 already requires signed exact quotes and forbids formulas in descriptors. The lesson is for the *quote content*: name the lock horizon the price assumes, so a longer `fiat_confirm_by` gets a new quote. OpenSwap also uses fixed sizes on both sides so that "your quoted price and the built transaction can never drift apart". Wherever a Pontmore escrow schema charges routing or on-chain fees, it should use the same deterministic sizing.

**Opt-in screening of funding sources.** Disabled by default, it uses a local list and checks only the direct inputs (single hop, not taint analysis). A refusal "does not name the list or the entry". Agents in regulated corridors may need an equivalent. In Pontmore this is an agent-side policy over private payer-account data, close to Mostro's payer-account history ([Mostro leverage][mostro-leverage]). It belongs in apps, not PIPs. OpenSwap's design shows the safe defaults: off, local, and silent about which entry matched.

**Nostr as an untrusted cache.** OpenSwap signs its relay announcements with a throwaway key because it gives the Nostr key no authority: all authority comes from the bond on the chain. Pontmore cannot do this for identity, since its npub *is* the identity. It can do it for discovery mirrors, with any party allowed to republish an agent's signed definition or offer. The rule becomes "verify the inner signature, ignore the outer one".

## 7. Interoperation

1. **Liquidity rebalancing without a custodian.** Pontmore agents need Lightning or Spark liquidity on one side and often accumulate on-chain coins on the other. `ln-swap-in` and `ln-swap-out` against bonded makers replace a custodial swap service such as Boltz. OpenSwap's introduction calls Boltz-style services centralized. This is a tooling integration for agent apps (clink/pontspark), with no protocol change.
2. **Privacy for agents.** An agent's coins are linked to fiat-rail identities by its trades. A routed coinswap before cold storage breaks the chain-analysis link. Recommend it in agent operations docs.
3. **Shared bonded identities.** If §2 reuses OpenSwap's bond script, an operator can run a maker and a Pontmore agent or escrow from one bond, and clients from either ecosystem can verify it. Decide this on purpose (§8).
4. **Discovery.** An OpenSwap maker could publish a PIP-00 definition with an `openswap/maker@…` capability pointing at its bond outpoint. This has little value for Pontmore unless Pontmore clients start offering BTC↔BTC swaps.

## 8. What not to adopt, and open questions

**Do not adopt:**

- **Taker-relayed, stateless coordination.** It works because an abort refunds automatically. A fiat leg needs a shared, verifiable record for the resolver, which is PIP-02's reason to exist.
- **Tor-only transport.** OpenSwap allows 300-second Tor connect timeouts. That is unworkable for mobile users on African networks. Keep Tor as an option.
- **Mandatory bonds, or one global bond-value formula.** Either one would shut out exactly the small agents Pontmore targets.

**Open questions:**

1. Should a fidelity bond be allowed to back an OpenSwap maker and a Pontmore identity at the same time? Sharing raises the bond's usefulness and lowers its Sybil cost per role.
2. Should resolvers in `swap@1` roots be *required* to carry a bond above a profile-declared floor, or should that stay client policy?
3. Can a Lightning-native alternative to on-chain fidelity bonds give similar guarantees (for example, long-lived channel capacity proofs), so that agents who only hold Lightning balances can take part?
4. Does the PIP-02 fork rule produce enough proven faults to make the §3 "banned" class useful in practice, or does most fraud stay in the unprovable fiat leg?

## Sources

- OpenSwap: [repository][os] (`README.md`, `docs/lightning.md`, `docs/fee-policy.md`, `docs/blocklist.md`, `src/maker/nostr.rs`, `src/taker/offers.rs`, `src/protocol/features.rs`, `src/wallet/fidelity.rs`, commits `08f9194`, `5245d8e`, `87a1e54`), [protocol specification][os-spec] (`general specs/*`, `v2 protocol/*`), [website][site]
- Pontmore: [README][pm-readme], [PIP-00][p00], [PIP-01][p01], [PIP-02][p02], [`swap@1`][swap], [offers PR #28][pm-offers]; research notes [Mostro leverage][mostro-leverage], [Escrow policies][escrow-patterns], [OpenPleb interop][openpleb]
- Background: [Belcher's coinswap design][belcher], [JoinMarket fidelity bonds][jm-fb]

[mostro-leverage]: ./mostro-pontmore-leverage.md
[escrow-patterns]: ./escrow-policies-and-exchange-patterns.md
[openpleb]: ./openpleb-pontmore-interop.md
[site]: https://openswap.live/
[os]: https://github.com/citadel-foss/openswap/tree/08f91945b3c85528a843bc386084e2c4501b7f4c
[os-readme]: https://github.com/citadel-foss/openswap/blob/08f91945b3c85528a843bc386084e2c4501b7f4c/README.md
[os-ln]: https://github.com/citadel-foss/openswap/blob/08f91945b3c85528a843bc386084e2c4501b7f4c/docs/lightning.md
[os-fees]: https://github.com/citadel-foss/openswap/blob/08f91945b3c85528a843bc386084e2c4501b7f4c/docs/fee-policy.md
[os-blocklist]: https://github.com/citadel-foss/openswap/blob/08f91945b3c85528a843bc386084e2c4501b7f4c/docs/blocklist.md
[os-nostr]: https://github.com/citadel-foss/openswap/blob/08f91945b3c85528a843bc386084e2c4501b7f4c/src/maker/nostr.rs
[os-offers]: https://github.com/citadel-foss/openswap/blob/08f91945b3c85528a843bc386084e2c4501b7f4c/src/taker/offers.rs
[os-features]: https://github.com/citadel-foss/openswap/blob/08f91945b3c85528a843bc386084e2c4501b7f4c/src/protocol/features.rs
[os-fidelity-rs]: https://github.com/citadel-foss/openswap/blob/08f91945b3c85528a843bc386084e2c4501b7f4c/src/wallet/fidelity.rs
[os-spec]: https://github.com/citadel-foss/OpenSwap-Protocol-Specification/tree/c747759d35a78f8d432b7830190021320d6313b2
[os-intro]: https://github.com/citadel-foss/OpenSwap-Protocol-Specification/blob/c747759d35a78f8d432b7830190021320d6313b2/general%20specs/introduction.md
[os-arch]: https://github.com/citadel-foss/OpenSwap-Protocol-Specification/blob/c747759d35a78f8d432b7830190021320d6313b2/general%20specs/architecture.md
[os-fidelity]: https://github.com/citadel-foss/OpenSwap-Protocol-Specification/blob/c747759d35a78f8d432b7830190021320d6313b2/general%20specs/fidelity.md
[os-security]: https://github.com/citadel-foss/OpenSwap-Protocol-Specification/blob/c747759d35a78f8d432b7830190021320d6313b2/general%20specs/security.md
[pm-readme]: https://github.com/pontmore/protocol/blob/edcf1370e7e646574021709cc9b186d96377280a/README.md
[p00]: https://github.com/pontmore/protocol/blob/edcf1370e7e646574021709cc9b186d96377280a/PIP-00-agent-definition.md
[p01]: https://github.com/pontmore/protocol/blob/edcf1370e7e646574021709cc9b186d96377280a/PIP-01-escrow-descriptor.md
[p02]: https://github.com/pontmore/protocol/blob/edcf1370e7e646574021709cc9b186d96377280a/PIP-02-coordination-event-chains.md
[swap]: https://github.com/pontmore/protocol/blob/edcf1370e7e646574021709cc9b186d96377280a/profiles/swap-v1.md
[pm-offers]: https://github.com/pontmore/protocol/pull/28
[belcher]: https://gist.github.com/chris-belcher/9144bd57a91c194e332fb5ca371d0964
[jm-fb]: https://github.com/JoinMarket-Org/joinmarket-clientserver/blob/master/docs/fidelity-bonds.md
