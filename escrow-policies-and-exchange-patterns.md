# Escrow Policies and Exchange Patterns for Pontmore

_Research snapshot: 19 October 2026. Pontmore protocol main: `d9a1eb3` (14 September 2026). Compared systems: Mostro `f1f7a62` (15 October 2026), Peer/ZKP2P contracts `0b22bfb` (16 October 2026). This is analysis, not an adopted Pontmore specification._

Related notes: [Resolver-recoverable preimages][rrp] · [PeerBadge trust layer][peerbadge]

## Executive finding

The dispute failures seen in the Pontmore mobile apps are not mainly app bugs. Clink and pontspark make the agent its own resolver. The lock's expiry, not the resolver, decides the outcome. The chain can record refunds that never happened. All three follow from how PIP-01 and PIP-02 model escrow: **an escrow is a pubkey that signs claims, and a resolution is a public record that someone may or may not honour.** Nothing in the protocol says who can actually move the funds, so nothing stops an implementation from binding a resolver who can't enforce anything, or a default outcome that settles every dispute before it starts.

The fix has to work for every channel Pontmore allows (on-chain Bitcoin, Lightning, Cashu, smart contracts, custodial services, and others), not just Lightning hold invoices. This note proposes three changes:

1. **Escrow policies.** A small, role-based language that states which coalition of parties can produce each outcome (settle, refund, split) and from what time. It is close to Bitcoin's Miniscript, but written over coordination roles instead of keys.
2. **Property checks.** A fixed set of checks that every client runs against the policy before `core/accept`: whether rulings can be enforced, that no single party can steal, that the default outcome and its time are declared, that the roles are independent, and that the actual lock matches the policy.
3. **Exchange patterns.** Rules that pick the safe pattern from what each leg of an exchange can do: whether it can be escrowed, whether payments on it can be reversed, and whether payment can be proven. The patterns are atomic swap, escrow plus one leg first, a reversal bond, proof-gated release, tranching, and collateral in a third asset.

Together these let PIP-01 describe what a mechanism *can* enforce. PIP-02 can then require that a coordination's resolver and default outcome are *backed* by the lock, while trust decisions stay with applications.

## 1. Where the current protocol leaves the gap

| Clause | Consequence |
|---|---|
| PIP-02 §Coordination Root: "A root MUST bind exactly one `core/escrow` pubkey." | Non-custodial locks (HTLCs, multisig, contracts) have no natural escrow authority. The mobile apps invented one by deriving an "escrow key" from the agent's seed (`lib/keys.ts`, account 1), which makes the agent the authority over its own trades. |
| PIP-02 §Disputes: "A resolution never moves funds. Final settlement and refund still require the bound escrow authority's corresponding action." | A ruling only takes effect if an escrow authority chooses to act on it. With a hashlock, the only party who can act on a settle ruling is the provider, the side the ruling went against. |
| PIP-02 §Disputes: "…default timeout winners are outside Pontmore." | The default is not policy, it is set by how the lock works. A hold invoice always refunds the payer at expiry. Leaving this unstated hid that every disputed Lightning swap is decided by the clock about an hour after `fiat_confirm_by`. |
| PIP-01 §Escrow Types: `lightning_hold_invoice`, `custodial_escrow`, `cashu_escrow` | A type name says nothing about who controls each outcome, how long the lock lasts, whether outcomes can be split, or how they can be observed. |
| PIP-02 §Kernel Invariants: "no action after a terminal outcome" | There is no place to handle post-settlement risk such as payment reversals, which is the main dispute problem Peer solves. |
| PIP-02 resolution effects: `resume`, `authorize_settlement`, `authorize_refund`, `cancel` | All-or-nothing. `incorrect_fiat_amount` needs a partial outcome, which only some escrows can provide. |
| `core/secure`, `core/settle`, `core/refund` are signed claims | Most locks produce facts anyone can check (a txid, a revealed preimage, a contract event, a mint's spent state). Recording a signer's claim instead of evidence let the apps publish `core/refund` for a payment that had actually been released. |

PIP-01 §Selection Rules already says clients "MUST NOT infer … resolver trustworthiness … from a signed descriptor." That is correct, but incomplete. Trustworthiness is an application judgement. *Enforceability* is a mechanical fact the protocol can and should verify.

## 2. A taxonomy of escrow mechanisms

The mechanisms differ along one axis: **who can produce each outcome.**

| Pattern | Settle | Refund | Resolver's power | Default | Horizon | Split | Outcome observability | Examples |
|---|---|---|---|---|---|---|---|---|
| **A. Custodial / service** | Operator, on instruction | Operator, on instruction | Instructs the operator | Service-defined | Any | Yes | Signed receipts from the service | Mostro Lightning mode, exchanges, `custodial_escrow` |
| **B. Hashlock** | Fixed beneficiary + secret | Timeout (and beneficiary cancel) | Only by recovering the secret ([RRP][rrp]) | Payer refunded | Lightning: hours to a day; on-chain/EVM/Cashu: long | No (use tranches) | On-chain: public; Lightning: proof-of-payment preimage | Hold invoices, BIP-199 HTLCs, Liquid/EVM HTLCs, Cashu NUT-14, Ark VHTLC, submarine swaps |
| **C. Threshold signature** | Any `t`-of-`n` | Any `t`-of-`n`; timelocked fallback | Its key is one of the `n` | Timelocked fallback | Long | Yes (outputs are chosen when signing) | Public ledger, or the mint's spent state | On-chain 2-of-3, MuSig2/FROST, Liquid, Cashu P2PK `n_sigs`, Safe, Ark tapscript |
| **D. Contract / verifier-gated** | Coded: proof, arbiter call, or a party | Coded: timeout, arbiter | Whatever the contract grants | Coded | Any | Yes | Public contract events | Peer (attested payment proofs), oracle escrows, zk-verifier contracts |
| **E. Mutual deposits (MAD)** | Both parties | Both parties | None, or a fallback party | Stalemate (both lose or are stuck) | Long | Yes | Public ledger | 2-of-2 with deposits from both sides; Bisq's MuSig trade protocol is a variant with a DAO fallback |
| **F. Collateral overlay** | — (a second lock on a bond) | Bond released after the risk window | Slashes the bond on a ruling or proof | Bond released | Must outlast the risk window | Yes | Depends on the bond's own pattern | Peer `StakeVaultV2`, Mostro anti-abuse bond |
| **G. No escrow** | First mover trusts the other side | — | Reputation only | — | — | — | — | Reputation-only trades |

The important distinction:
- **Hashlocks are tied to specific outcomes.** The lock fixes the beneficiary in advance, so revealing the secret settles to that party and nothing else. They cannot split.
- **Signature escrows are not.** A coalition that can sign can produce any outcome, including a split, because the outputs are chosen when signing.
- **Contracts produce whatever their code allows.**
- **Custodial escrows produce anything, on trust.**

The resolution effects that make sense therefore depend on the mechanism. The protocol must learn this from the descriptor, not from the type name.

## 3. Escrow policy language

### 3.1 Model

A policy maps each **outcome** to a condition over **cooperating roles** and **time**:

```text
policy    = { outcome: cond, ... }
outcome   = settle | refund | split
cond      = role                      the role cooperates (signs, reveals, instructs)
          | all(cond, ...)            every condition holds
          | any(cond, ...)            some condition holds
          | thresh(k, cond, ...)      at least k conditions hold
          | after(T)                  validation time ≥ T (a named deadline bound in the root)
          | trust(role)               the role is assumed honest; listed explicitly as a trust assumption
role      = provider | recipient | resolver[i] | operator | oracle[i] | <profile role>
```

- `settle` pays the escrowed asset to its intended recipient.
- `refund` returns it to the provider.
- `split` is any other division.

These are the economic outcomes of one escrowed leg. The provider and recipient are derived per leg (see §6).

Each atom carries a **realization**: the mechanism by which the role "cooperates" in that particular escrow. Realizations matter for verification (§4.5), not for the property checks. Examples:

| Realization | Meaning |
|---|---|
| `provider[secret:H]` | Reveals the preimage of `H` |
| `resolver[i][rrp:t-of-n]` | Releases its share of the recoverable preimage |
| `recipient[claim]` | Settles a hold invoice or HTLC it holds |
| `recipient[cancel]` | Cancels a hold invoice it holds |
| `role[sig:schnorr]`, `role[sig:ecdsa]` | Signs a transaction or witness |
| `oracle[i][attest:fiat_paid@1]` | Signs an attestation of a named claim |
| `operator[instruct]` | Executes an instruction (always paired with `trust(operator)`) |

### 3.2 Semantics

For a coalition `C` of cooperating roles and a time `t`, `Sat(cond, C, t)` holds when:
- `role` is in `C`;
- `after(T)` holds when `t ≥ T`;
- `trust(r)` holds when `r ∈ C`, and it is also recorded as an assumption;
- `all`, `any` and `thresh` combine their parts as usual.

An outcome is *reachable* by `C` at `t` when `Sat(policy[outcome], C, t)` holds.

Policies are small, typically 3–7 roles with 1–3 named times. A client can therefore enumerate every coalition and every time region (between consecutive named times) exhaustively. No solver is needed.

### 3.3 Example policies

**B1. Lightning hold invoice, provider-chosen hash (current pontmore apps):**
```text
settle: all(recipient[claim], provider[secret:H])
refund: any(recipient[cancel], after(T_lock))
```

**B2. Lightning hold invoice with a resolver-recoverable preimage ([RRP][rrp]):**
```text
settle: all(recipient[claim], any(provider[secret:H], thresh(t, resolver[1..n][rrp])))
refund: any(recipient[cancel], after(T_lock))
```

**C1. On-chain taproot 2-of-3.** Key path: MuSig2(provider, recipient). Leaves: (provider, resolver), (recipient, resolver), (provider after `T`).
```text
settle | refund | split:  any(all(provider, recipient),
                              all(provider, resolver),
                              all(recipient, resolver))
refund (fallback):         all(provider, after(T_lock))
```

**C2. Cashu NUT-11 P2PK 2-of-3 with a locktime refund:**
```text
settle | refund | split:  thresh(2, provider, recipient, resolver), all(trust(mint))
refund (fallback):         all(provider, after(T_lock), trust(mint))
```

NUT-11 may keep the multisig path spendable after the locktime. If it does, both outcomes are reachable after `T_lock`. The checks flag this as a **race** (§4.3).

**D1. Peer-style verifier-gated contract:**
```text
settle: any(provider, all(recipient, thresh(k, oracle[1..m][attest:fiat_paid])))
refund: all(provider, after(T_lock))
assumptions: trust(governance)   # owner can replace the verifier and witness set
```

**A1. Custodial, Mostro Lightning mode:**
```text
settle: all(trust(operator), any(provider, resolver))
refund: all(trust(operator), any(all(provider, recipient), resolver, after(T_lock)))
```

**F1. Reversal bond (a separate coordination, §6.4):**
```text
slash (to provider):     all(before(T_risk), any(thresh(k, oracle[attest:reversed]), thresh(t, resolver)))
release (to bond owner): all(bond_owner, after(T_risk))
```

(`before(T)` is shorthand for the time region `t < T`.)

## 4. Properties every client checks before acceptance

The participants in one escrowed leg are `P` (provider), `Rc` (recipient) and the resolver set `Q` with threshold `t`. "Quorum" means any `t` of the resolvers. `T_res` is the resolution deadline: the latest time a ruling must be enforceable. `T_def` is the declared default time.

### 4.1 Enforceability: a ruling can be carried out

For each resolution effect the profile allows:

| Effect | Required |
|---|---|
| `authorize_settlement` | `settle` reachable by `{Rc} ∪ quorum` for all `t < T_res` |
| `authorize_refund` | `refund` reachable by `{P} ∪ quorum` for all `t < T_res`, **or** by `{P}` or `∅` at `T_def` (a delayed refund; the client marks it as delayed) |
| `split` | `split` reachable by `{P or Rc} ∪ quorum` for all `t < T_res` |
| `cancel` after funds are locked | Treated as `authorize_refund` |

If an effect fails this check, the profile MUST NOT allow it for this coordination.

**B1 fails `authorize_settlement`**: only `P` can reveal `H`. That is the formal version of the mobile apps' main defect. B2, C1 and C2 pass. D1 passes only when its oracle set is bound as the resolver set, since the contract recognizes no other arbiter. A1 passes only under `trust(operator)`.

### 4.2 No unilateral theft

- `settle` is not reachable by `{Rc}` alone at any time.
- `refund` is not reachable by `{P}` alone before `T_def`, except through the declared normal or recovery path. A normal release by `P` to `Rc` is a settle and is always allowed.
- No outcome is reachable by a resolver quorum alone **with the quorum as beneficiary**. Resolvers are never beneficiaries of the escrowed leg.

### 4.3 Declared default

- At `t ≥ T_def`, exactly one outcome is reachable by its beneficiary alone (or by `∅`). It MUST equal the root's declared default (§7.2).
- If both outcomes are reachable after `T_def` by different single parties (a race, as in the C2 note above), the client MUST require `T_res < T_def` with a margin, and SHOULD treat the remaining race as a risk to show the user.
- The deadline inequality:

  ```text
  T_def ≥ T_res ≥ last_profile_deadline + dispute_window + settle_margin
  ```

  `settle_margin` covers wallet settlement time and automatic-cancel margins, for example LND's `holdexpirydelta`.

### 4.4 Role independence and selection

- Participant, operator, oracle and resolver pubkeys are pairwise distinct.
- Resolver and oracle keys are not among the keys either participant has announced (identity, escrow, offer keys).
- The party who bears the escrow risk on a leg (the one whose non-escrowed leg moves first) chooses or approves the resolver set. A resolver fixed unilaterally by the counterparty's offer is not acceptable by default.

Independence between *entities* cannot be proven. These checks rule out the mechanical shortcuts and leave the rest to reputation (see [PeerBadge][peerbadge]).

### 4.5 The instance matches the policy

The lock instance's parameters MUST be determined by data bound in the root (keys, hashes or commitments, times, amounts), so that any party can recompute them. Verification depends on the realization:

| Realization | Verify |
|---|---|
| On-chain script/address | Recompute the address from the root-bound keys and `T_lock`; check the funding outpoint, amount and confirmations |
| Lightning hold invoice | Payment hash, amount, and that HTLC expiry ≥ `T_def`, on the incoming HTLC |
| RRP preimage | Cut-and-choose openings ([RRP §Verify][rrp]) |
| Cashu P2PK/HTLC | Mint DLEQ (NUT-12), unspent state (NUT-07), and a parsed secret matching the policy |
| Contract | Code hash or verified deployment, parameters, the deposit event |
| Custodial | Signed service receipt under the descriptor's service schema; trust is recorded, not verified |

The recipient-side lock check in the mobile apps (`verifyIncomingLock`) is one case of this rule.

### 4.6 Collusion surface (informational)

For each outcome, the client lists the **minimal coalitions** that can reach it. For B2 these are `{Rc, quorum}` for settle and `{P}` at `T_def` for refund. For A1 every coalition includes `trust(operator)`. The list is shown to users and resolvers. It is the honest statement of "who you are trusting".

### 4.7 Mapping the mobile-app defects

| Defect found in clink/pontspark | Property violated |
|---|---|
| Agent's own seed derives the resolver and escrow keys | 4.4 |
| Resolver cannot release a hold invoice | 4.1 (B1) |
| Disputes run out the ~4h Spark hold | 4.3 deadline inequality |
| `core/refund` recorded for a released payment | §7.3 outcome evidence |
| Dispute freezes a recipient that holds a valid preimage | §7.3: outcomes are observed facts, not kernel-gated permissions |

## 5. Leg properties

An exchange has one or more **legs**. Each leg moves an asset over a channel from a sender to a receiver. The patterns depend on three properties of each leg's channel:

| Property | Values | Source |
|---|---|---|
| **Escrowability** | The set of patterns from §2 the channel supports, each with a horizon | Escrow descriptor plus channel registry |
| **Reversibility** | Irreversible, or reversible for a window `W_rev` | Channel registry |
| **Provability** | `none`, `ledger` (public chain), `pop` (proof-of-payment secret), `attestable` (zkTLS, bank API, TEE), `receipt` (custodial) | Channel registry |

Examples:
- **On-chain BTC:** escrowable with B, C, E (long horizon); irreversible after confirmation; `ledger`.
- **Lightning:** escrowable with B, horizon of hours, about 4h on Spark; irreversible; `pop`.
- **USDC on an L2:** B, C, D, E; irreversible, but the issuer can freeze it; `ledger`.
- **PayPal / Venmo:** not escrowable; reversible for up to 180 days; `attestable`.
- **M-Pesa:** not escrowable; reversal requests exist; provability is weak (usually SMS or app receipts).
- **Bank transfer:** not escrowable; reversibility depends on the rail; `attestable` where online banking supports it.
- **Cash or goods in person:** not escrowable; irreversible; `none`.

## 6. Exchange patterns

### 6.1 Selection table

| Leg combination | Pattern | Resolver needed | Notes |
|---|---|---|---|
| Both escrowable with a shared hashlock | **Atomic swap**: one hash on both legs; timeouts `T_1 < T_2` (the secret holder's own leg times out last) | No; only liveness | **Free option**: the secret holder can wait and complete only if the price has moved in their favour. Mitigate with short timeouts, a premium paid up front, or collateral (Han, Lin & Yu, *On the optionality and fairness of atomic swaps*, AFT 2019). |
| Both escrowable, no shared hashlock | **Two locks under one policy**: C or D on both legs, with the cross-leg condition enforced by a resolver or a contract | Yes | Or route one leg through a submarine swap so both share a hash |
| One escrowable, one not | **Escrow plus one leg first**: secure the escrowable leg, then the other leg moves, then release | Yes, and it must pass 4.1 | The pontmore swap@1 case. The escrow protects whoever moves the non-escrowed leg. |
| Plus the non-escrowed leg is reversible | **Add a reversal bond** (§6.4) posted by the party who can reverse, for `W_rev` | Yes, or an oracle | Peer's dispute model. Without a bond: per-rail limits or tranches. |
| Plus the non-escrowed leg is attestable | **Proof-gated release**: an oracle acts as an automatic resolver; humans handle what is left | Partly automatic | Removes most `fiat_not_received` disputes. Oracle trust is recorded as `trust(oracle)` or a k-of-m set. |
| Neither leg escrowable | **Collateral in a third asset, plus tranches and reputation** | Yes, for the collateral | Exposure ≤ collateral + one tranche |
| Escrow horizon shorter than the needed dispute window | **Tranching**, or move the long-lived part (the bond) to a long-horizon pattern | — | For example, trade on Lightning, bond on-chain or in Cashu |

### 6.2 Rules that apply in every pattern

1. **Order of moves.** A leg that cannot be escrowed moves only after every escrowable leg is secured *and verified* (§4.5). The existing `core/secure` gate generalizes this way.
2. **The horizon bounds the deadlines.** `T_def` is limited by the shortest-horizon escrow in the exchange. The dispute window is whatever fits; if it doesn't fit, change the pattern.
3. **Who moves first.** The party who moves an unescrowed leg first is the one at risk, and the one who must approve the resolver (4.4).
4. **Split outcomes need a splittable escrow.** On hashlocks, partial outcomes are expressed as tranches.
5. **Paid extensions.** The party who needs more time pays the party whose capital is locked, with a cap (Peer `IntentGuardian`: priced per hour, 5-day cap). For hashlocks, an extension means creating a new lock, which needs the provider's cooperation; the fee gives the provider a reason to cooperate.

### 6.3 Tranching

Split the exchange into `N` sequential tranches of decreasing risk. Each tranche is its own escrowed leg and each is released before the next starts. Exposure is bounded by one tranche plus any outstanding collateral. On Lightning, tranches are cheap and fast, which makes them the natural answer for both "split" outcomes and short horizons. The cost is more round trips and more fiat transfers, which has a UX cost on rails with per-transfer fees.

### 6.4 Linked coordinations for post-settlement risk

The kernel's "no action after a terminal outcome" rule should stay. Post-settlement risk goes in a **separate coordination** linked to its parent:
- **Root.** A `pontmore/bond@1` root commits to the parent coordination ID, the bond amount, `W_rev` (from the channel registry, snapshotted when the root is created), the slashing conditions, and the bond's own escrow descriptor.
- **Escrow.** The bond uses its own pattern (C, D, or A) on a channel whose horizon covers `W_rev`. This can be a different channel from the trade.
- **Slashing.** A slash needs a ruling or a reversal attestation that refers to the parent's committed payment reference, with a nullifier so the same claim can't be used twice (Peer `DisputeVerifier` binds the reversal to the payment's nullifier).
- **Release.** After `T_risk` the bond owner can release it. Peer keeps disputes valid until the release actually executes. Pontmore should do the same: a slash is valid until a release has been recorded.

Peer's **deferred payout** (lock the recipient's own payout when it has no stake) maps to tranche-holding on Lightning. That is, the provider withholds the last tranche until `W_rev` passes, which means the recipient trusts the provider for that amount. This is acceptable only when the provider is a repeat party with a reputation to lose.

## 7. Proposed protocol changes

These are sketches for later PIP drafts, not normative text.

### 7.1 PIP-01: descriptors declare what the mechanism can do

Keep `escrow_type`. Add a `capabilities` object:

```json
{
  "version": 2,
  "escrow_type": "lightning_hold_invoice",
  "networks": ["lightning"],
  "capabilities": {
    "policies": ["pontmore/policy/hashlock@1", "pontmore/policy/hashlock-rrp@1"],
    "horizon": { "min": 1800, "max": 14400 },
    "split": false,
    "observability": "pop",
    "instance_verification": ["bolt11-hold@1", "rrp-cut-and-choose@1"],
    "operator": false
  },
  "expires_at": 1780000000
}
```

`policies` name role-level templates registered alongside profiles. Each template fixes the policy shape from §3 and its realizations. Templates are specifications, not downloaded code, in keeping with PIP-02's "profiles are specifications" rule.

### 7.2 PIP-02 root: bind the policy, the instance and the defaults

- `commitments.lock`: commits to the instance parameters (keys, hash or commitment, `T_lock`, amount, outpoint or contract address when known) and the template ID.
- `terms.resolution`:
  ```json
  { "threshold": 1, "dispute_window": 7200, "default": "refund", "default_at": 1780014400 }
  ```
- Resolver set: repeated `p` tags with marker `core/resolver` and a fourth element giving the index, replacing "exactly one". The threshold comes from `terms.resolution`.
- Optional assist-only resolvers (Mostro's `read` solvers) under a separate marker, for example `core/assistant`. They are never counted towards the threshold.

### 7.3 PIP-02 kernel: outcomes are observed facts

- `core/escrow` becomes optional for templates with `"operator": false`. The lock *is* the escrow.
- For such templates, `core/secure`, `core/settle` and `core/refund` MAY be published by either participant. They MUST carry outcome evidence that can be checked under the template's `observability`:

  | Observability | Evidence |
  |---|---|
  | `ledger` | txid / outpoint / contract event |
  | `pop` | Preimage commitment, with the preimage revealed in private |
  | `receipt` | Service-signed receipt |
  | Mint | Spent-state evidence |

- Implementations that can observe the ledger verify the evidence. Implementations that cannot, treat it as a claim from that signer, and a competing outcome claim is a fork (existing fork rules apply).
- A participant holding a valid settle realization (a preimage, a signed transaction) can complete the outcome in the world even while the chain is disputed. The chain then records what happened. The kernel freezes *authorizations*, not *observations*.

### 7.4 PIP-02 kernel invariants: new rules

- The accepted coordination MUST pass §4.1–4.5 for its template and terms. A failing check rejects the coordination.
- Resolution effects MUST be among those that §4.1 found enforceable.
- `split` is added as an effect, allowed only when the template has `"split": true`.
- The text "default timeout winners are outside Pontmore" becomes: **default outcomes MUST be declared and verified; choosing them remains application policy.**

### 7.5 Profiles: from swap to exchange

Generalize `pontmore/swap@1` into an exchange profile with typed legs:

```json
{
  "legs": [
    { "id": "btc", "asset": "BTC", "amount": "60000", "unit": "sat", "channel": "lightning@1",
      "sender": "swap/agent", "receiver": "swap/customer", "escrow": "lock" },
    { "id": "fiat", "asset": "KES", "amount": "1000", "channel": "mpesa_phone_ke_kes@2",
      "sender": "swap/customer", "receiver": "swap/agent", "escrow": null }
  ],
  "order": ["btc:secure", "fiat:send", "fiat:confirm", "btc:release"]
}
```

- Provider and recipient are derived per escrowed leg.
- Dispute classes are tied to the provability of each leg (`fiat:not_received` applies to the fiat leg; `attestable` lets an oracle settle it).
- swap@1's two directions become two orderings of the same legs.

### 7.6 Payment-channel registry

Each versioned channel declares:
- reversibility and `W_rev`;
- provability methods;
- supported escrow templates;
- typical settlement time;
- **a payment-reference normalization rule**, so that receivers keep a per-receiver nullifier set. The same fiat transaction can then never back two coordinations (Peer's payment nullifiers). Agents reject `fiat_confirmed` for a reference they have already used, and resolvers check uniqueness as part of the evidence.

### 7.7 Resolvers as a capability

A PIP-00 capability `pontmore/resolver@1` declares:
- key material per realization: signing key, RRP key, contract permissions, or instruction channel;
- a policy URI that `core/resolve_dispute.policy` must equal;
- a response-time promise (checked against `dispute_window`);
- a fee;
- the dispute classes it rules on automatically, and the proof types it accepts;
- supported thresholds and templates.

### 7.8 Evidence

- Private payloads MUST be signed. Today's unsigned NIP-59 rumors can't be attributed to their sender.
- Evidence types gain `attestation` (issuer, claim, signature), with issuer trust left to client policy.
- Payment-reference commitments are made at claim time (`swap/fiat_sent`) and act as nullifiers.

## 8. Worked check: Lightning hold invoice, with and without RRP

Setup: Spark hold invoice, `T_lock = fiat_confirm_by + 1h`, `dispute_window = 2h`, one resolver.

| Check | B1 (today) | B2 (RRP, t = 1) |
|---|---|---|
| 4.1 `authorize_settlement` | **Fails**: `{Rc, resolver}` cannot reveal `H` | Passes until `T_lock` |
| 4.1 `authorize_refund` | Delayed (only at `T_lock`) | Delayed, or immediate if `Rc` cancels |
| 4.2 | Passes | Passes |
| 4.3 default | refund at `T_lock`; **the inequality fails** (1h < 2h window) | refund at `T_lock`; the inequality needs deadlines shortened ([RRP §Timing][rrp]) |
| 4.4 | **Fails** (agent-derived resolver) | Requires an independent, customer-approved resolver |
| 4.5 | Invoice check | Invoice check + cut-and-choose |
| 4.6 settle coalitions | `{P, Rc}` | `{P, Rc}`, `{resolver, Rc}` |

On-chain 2-of-3 (C1) with `T_lock` = 7 days passes everything with a long dispute window. In exchange it is slower and costs fees: the classic trade-off, now stated in terms the protocol can check.

## 9. What stays out of the protocol

- Whether a resolver, mint, operator or oracle is trustworthy.
- Reputation scores, Sybil resistance, and how evidence is judged.
- Which default an application prefers. The protocol only requires that it is declared, consistent with the lock, and satisfies the deadline inequality.

## 10. Open questions

1. Can the policy templates be expressed with a small fixed set, or do they need the full grammar in descriptors? (Recommendation: a fixed registry of templates, with the grammar used only in specs.)
2. How should clients that cannot observe a ledger (Nostr-only validators) treat outcome evidence? As claims with fork semantics, or should profiles require a quorum of observers?
3. Should `split` be a kernel effect or profile-defined, given that hashlocks can never support it?
4. Should the linked-coordination parent reference be a new tag marker (`["e", parent, "", "parent"]`) or a commitment only?
5. How should a resolver set be bound under PIP-02's "exactly one `core/resolver`" rule without breaking version-2 compatibility? (Likely a PIP-02 content version 3.)
6. Free-option mitigation for atomic-swap profiles: premiums, collateral, or a short asymmetric `T_1`.

## References

- [Pontmore PIP-01][p01], [PIP-02][p02], [`pontmore/swap@1`][swap] (`d9a1eb3`)
- [Resolver-recoverable preimages (this repo)][rrp]
- [PeerBadge trust layer (this repo)][peerbadge]
- Mostro: [daemon][mostro] (`src/app/dispute.rs`, `admin_settle.rs`, `scheduler.rs` deadline guardian, `docs/SOLVER_PERMISSION_LEVELS.md`, `docs/cashu/05-track-d-dispute.md`, `docs/ANTI_ABUSE_BOND.md`), [protocol][mostro-protocol] (`dispute.md`, `dispute_chat.md`, `chat.md`)
- Peer (ZKP2P): [contracts][peer] (`DisputeProtectionPolicyV2.sol`, `StakeVaultV2.sol`, `DisputeVerifier.sol`, `IntentGuardian.sol`, `MultiAttestationVerifier.sol`, `docs/superpowers/specs/2026-08-27-rail-aware-default-dispute-protection-design.md`)
- [Miniscript][miniscript], [BIP-199 HTLC][bip199], Cashu [NUT-11][nut11] / [NUT-14][nut14], [NIP-59][nip59]
- R. Han, H. Lin, J. Yu, *On the optionality and fairness of Atomic Swaps*, AFT 2019

[rrp]: ./resolver-recoverable-preimage.md
[peerbadge]: ./peerbadge.md
[p01]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/PIP-01-escrow-descriptor.md
[p02]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/PIP-02-coordination-event-chains.md
[swap]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/profiles/swap-v1.md
[mostro]: https://github.com/MostroP2P/mostro
[mostro-protocol]: https://github.com/MostroP2P/protocol
[peer]: https://github.com/zkp2p/zkp2p-contracts
[miniscript]: https://bitcoin.sipa.be/miniscript/
[bip199]: https://github.com/bitcoin/bips/blob/master/bip-0199.mediawiki
[nut11]: https://github.com/cashubtc/nuts/blob/main/11.md
[nut14]: https://github.com/cashubtc/nuts/blob/main/14.md
[nip59]: https://github.com/nostr-protocol/nips/blob/master/59.md
