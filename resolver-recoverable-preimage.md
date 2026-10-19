# Resolver-Recoverable Preimages for Hash-Locked Escrow

Draft, 16 October 2026. Status: research, not a PIP.

Reference implementation and test vectors: [`rrp/rrp.mjs`](rrp/rrp.mjs),
[`rrp/vectors.json`](rrp/vectors.json). `node rrp/rrp.mjs` regenerates them. It needs `@noble/curves` 2.x and
`@noble/hashes` 2.x: set `NOBLE_DIR` to a directory containing both. The default is a sibling `pontspark` checkout.

## Summary

A Lightning hold invoice is a 2-party escrow. Only the holder of the preimage can
complete it, and when nobody does, the payer is refunded. A dispute resolver who can
neither produce the preimage nor stop the refund cannot enforce anything. That is the
current Pontmore design, where the agent is its own resolver and the outcome is
decided by whoever holds the preimage and by the lock's expiry.

This draft specifies **resolver-recoverable preimages (RRP)**. The party that locks
the funds (the *provider*) chooses the payment hash so that a resolver bound to the
coordination can recompute the preimage from public data and its own secret key,
without being contacted when the swap is set up. Before paying fiat, the counterparty
(the *recipient*) checks this with a cut-and-choose test, so no zero-knowledge proof
is needed. A t-of-n panel of resolvers is supported through Shamir sharing.

RRP is a layer for *escrowing the preimage* and is independent of the lock. It works
with any lock whose claim condition is "reveal a SHA-256 preimage" and whose default
is a refund to the payer: Lightning hold invoices on any implementation that accepts
a payment hash chosen by someone else, and also on-chain, Liquid, Ark and Cashu
HTLCs, and submarine swaps. See [Generality](#generality-beyond-spark).

## Problem statement

| Party | Pontmore swap@1 role | Lock role |
|---|---|---|
| Provider | Bitcoin provider (= fiat receiver) | Pays the hold invoice; chooses `H`; holds `P` |
| Recipient | Bitcoin recipient (= fiat sender) | Creates the hold invoice for `H`; settles with `P` |
| Resolver | `core/resolver` | Decides disputes |

The recipient pays fiat before receiving bitcoin and is the only party at risk inside
the escrow. A provider who has been paid in fiat can withhold `P` until the lock
expires and keep both the fiat and the sats. A useful resolver therefore needs to be
able to:

1. give `P` to the recipient when the recipient is right (forced settlement);
2. withhold `P` when the provider is right, so the recipient cancels the invoice or
   the lock expires (refund);
3. do this without being online, or even aware, when the swap is set up;
4. let the recipient verify, *before paying fiat*, that the resolver really can
   do (1).

Goals: no service run by Pontmore, no change to Lightning, no new wallet capability
beyond creating a hold invoice for a given hash, and speed comparable to today.

Non-goals: protecting against fiat chargebacks after settlement, judging evidence,
and removing arbiter trust (a resolver colluding with one party can always decide
against the other).

## Notation

- secp256k1, generator `G`, group order `n`. Scalars are integers mod `n`.
- `ser32(x)`: 32-byte big-endian scalar. `ser33(X)`: 33-byte compressed point.
- `lift_x(x)`: BIP340 even-y lift of an x-only key.
- `TaggedHash(tag, m) = SHA256(SHA256(tag) ‖ SHA256(tag) ‖ m)` (BIP340).
- `u16(i)`, `u8(m)`: big-endian integers.
- `root_id`: 32-byte id of the PIP-02 coordination root. Any 32-byte coordination
  identifier works outside Pontmore.
- `k`: number of cut-and-choose candidates. `N`: number of resolvers. `t`: threshold
  (`1 ≤ t ≤ N`).

## Resolver keys

Each resolver `m ∈ {1..N}` has an x-only public key `X_m`. Its curve point is
`R_m = lift_x(X_m)`. Its secret `r_m` is the BIP340 secret normalized so that
`r_m·G = R_m`, meaning it is negated if the raw secret produces an odd y.

The key MAY be the resolver's Nostr signing key. Using it for both Schnorr signatures
and ECDH is the same reuse NIP-44 already depends on. Resolvers SHOULD instead
publish a dedicated escrow key, because a leaked key exposes every swap in flight.

## Construction

### 1. Commit (provider)

For each candidate `i ∈ {0..k-1}`, the provider:

```
e_i      ←$ [1, n-1]                     fresh ephemeral scalar
E_i      = e_i·G
P_i      ←$ [1, n-1]                     the preimage, as a scalar
f_i(x)   = P_i + a_{i,1}·x + … + a_{i,t-1}·x^{t-1}   (a_{i,·} ←$ Z_n)
H_i      = SHA256(ser32(P_i))            the payment hash
for each resolver m:
  S_{i,m} = e_i·R_m                       ECDH
  K_{i,m} = int(TaggedHash("pontmore/rrp/mask",
              ser33(S_{i,m}) ‖ ser33(E_i) ‖ root_id ‖ u16(i) ‖ u8(m))) mod n
  c_{i,m} = f_i(m) + K_{i,m} mod n        masked share
```

The provider sends the **signed** commitment `{(E_i, H_i, [c_{i,1..N}])}` for
`i = 0..k-1`, with `k`, `t` and the ordered resolver keys.

Requirements:
- every `H_i` MUST be distinct;
- `e_i`, `P_i` and the coefficients MUST come from a CSPRNG;
- no value may be reused across candidates or coordinations.

For `t = N = 1` this reduces to `c_i = P_i + K_i mod n`: one masked preimage per
candidate.

### 2. Challenge (recipient)

After receiving the commitment, the recipient picks `j ←$ [0, k-1]` from a CSPRNG and
sends it. The recipient MUST NOT reveal `j` before the commitment is received, and
MUST NOT reuse a challenge.

Where the lock is a hold invoice created by the recipient, the challenge travels with
that invoice, which MUST be for `H_j`.

### 3. Open (provider)

The provider reveals `e_i` for every `i ≠ j`. Opening releases those `P_i`, which is
safe because those hashes are never locked.

### 4. Verify (recipient)

For each opened `i`, the recipient checks:

1. `1 ≤ e_i < n` and `e_i·G = E_i`;
2. `s_{i,m} = c_{i,m} − K_{i,m} mod n` for all `m`, with `K` recomputed from
   `S_{i,m} = e_i·R_m`;
3. all `N` points `(m, s_{i,m})` lie on a single polynomial of degree at most
   `t − 1`: interpolate from the first `t` and evaluate the rest;
4. `P_i = f_i(0) ≠ 0` and `SHA256(ser32(P_i)) = H_i`.

It also checks that `H_j` differs from every opened `H_i`. Then it checks the lock
itself as today: amount, payment hash `H_j`, and expiry after the resolution
deadline.

**The recipient MUST complete verification before sending fiat.** Any failure aborts
the swap. The signed commitment together with the failing opening is a fraud proof
that anyone can check.

### 5. Normal path

Unchanged. The provider confirms the fiat and releases `P_j` to the recipient, who
settles.

### 6. Dispute path (resolver)

Given the swap's signed commitment (either party can supply it) and `j`, resolver `m`
computes:

```
S = r_m·E_j
s = c_{j,m} − K(S, E_j, root_id, j, m) mod n
```

along with a DLEQ proof that `log_G(R_m) = log_{E_j}(S)`.

- **The recipient is right:** each of `t` resolvers sends `(m, s, S, dleq)`
  *privately* to the recipient. The recipient checks each DLEQ, interpolates `P_j`,
  checks `SHA256(ser32(P_j)) = H_j`, and settles.
- **The provider is right:** resolvers send nothing. An honest recipient cancels the
  invoice and the funds return at once. Otherwise they return when the lock expires.
- **The provider cheated on candidate `j`** (probability ≤ 1/k): reconstruction
  fails. Resolvers publish `S` and the DLEQ for their shares. Together with the
  provider-signed commitment, this proves publicly that the provider cheated, and the
  DLEQs show which resolvers were honest. Funds still return to the provider; see
  [Limits](#limits).

`P` MUST NOT be published before the recipient settles. A routing node that learns
`P` can claim its incoming HTLC without forwarding.

### DLEQ

This is the Chaum–Pedersen proof that `A = x·G` and `S = x·E` share the same `x`:

```
k  = int(TaggedHash("pontmore/rrp/dleq-nonce", ser32(x) ‖ ser33(E) ‖ aux)) mod n
R1 = k·G,  R2 = k·E
c  = int(TaggedHash("pontmore/rrp/dleq",
       ser33(A) ‖ ser33(E) ‖ ser33(S) ‖ ser33(R1) ‖ ser33(R2))) mod n
z  = k + c·x mod n                         proof = (ser32(c), ser32(z))
```

To verify, compute `R1 = z·G − c·A` and `R2 = z·E − c·S`, recompute `c`, and compare.
`aux` is `root_id`. Implementations MAY add fresh randomness to `aux`.

## Security

| Adversary | Outcome |
|---|---|
| Recipient alone | Cannot settle: `P_j` requires `e_j` or `t` resolver secrets. Opened values are for unused hashes. |
| Provider alone | Cannot block a settlement ruling, unless it cheated on the one unopened candidate (≤ 1/k per attempt, see below). Can still win by default if no ruling arrives before expiry. |
| Resolver(s) alone (< t, or any number without the recipient) | Cannot take the funds, since only the invoice holder can settle. Fewer than `t` learn nothing about `P_j` (Shamir). |
| `t` resolvers + recipient | Can take the provider's funds. This is the arbiter trust every design with an arbiter carries; choose `t`/`N` to spread it. |
| `t` resolvers + provider | Can withhold a ruling, so the provider keeps fiat and sats. Same trust as above. |
| Stolen resolver key | Exposes only swaps whose locks are still live (hours on Lightning), and only to an attacker colluding with their recipients. |

**Cut-and-choose soundness.** A provider that corrupts one candidate escapes
detection only if `j` hits it: probability `1/k`. Corrupting more candidates only
raises detection.

**Selective abort.** The provider sees `j` before opening. A cheater whose corrupted
index was not chosen can walk away instead of opening, which leaves no fraud proof,
and try again. A determined attacker therefore succeeds after about `k` abandoned
attempts. Mitigations:
- clients MUST record "committed, challenged, never opened" as a fault against the
  provider key;
- agents SHOULD apply exposure limits to new keys;
- `k` SHOULD scale with the amount.

Removing aborts entirely needs a non-interactive proof (see
[Future work](#future-work)).

**Binding.** The mask covers `S`, `E_i`, `root_id`, `i` and `m`. Values cannot be
replayed across coordinations, candidates or resolvers. Commitments MUST be signed by
the provider's key bound in the root, so that fraud proofs can be attributed.

**Privacy.** A commitment reveals nothing to anyone without `e_i` or `r_m`.
Resolvers learn about a swap only when a party brings them a dispute.

## Timing

RRP makes a ruling enforceable only while the lock is live. The protocol MUST
guarantee:

```
lock_expiry ≥ fiat_confirm_by + Δ_resolve + Δ_settle + Δ_safety
```

- `Δ_resolve` is the resolver's promised response time.
- `Δ_settle` is the time the recipient's wallet needs to settle once it has `P`.
- `Δ_safety` covers clock skew and auto-cancel margins, such as LND's
  `holdexpirydelta` (12 blocks by default).

Clients enforce this without a service:

- **Auto-escalation.** If `fiat_sent` is recorded and `fiat_confirmed` is missing at
  `fiat_confirm_by`, the recipient's app opens a dispute. Running out the clock is
  then never a silent win for the provider.
- **Hard expiry.** Disputes carry the lock's expiry, and the resolver's app sorts by
  it.
- **Missed deadlines are recorded.** A disputed lock that expires without a ruling
  stays on the public chain and counts against the resolver.

The lock primitive's hold horizon sets the size of the dispute window. That is the
main way RRP differs from escrows that can stay locked for days (Cashu P2PK, Ark,
on-chain multisig).

## Generality beyond Spark

RRP touches only how the hash is chosen. It needs three things from the lock:

| Requirement | Why |
|---|---|
| **L1** Claim by revealing a SHA-256 preimage | Resolvers recover a preimage, nothing else |
| **L2** The claimer can lock to a hash chosen by someone else | The provider must choose `H` |
| **L3** Timeout refund to the payer | Default when nobody reveals `P` |
| L4 (optional) The claimer can cancel early | Fast refund after a provider-wins ruling |

The payer's wallet needs nothing special: it pays a BOLT11 invoice (or funds an
HTLC) and keeps `e_j` to compute `P_j` later. Only the **recipient's** side needs
L2.

### Lightning hold invoices

| Implementation | L2: invoice for a given hash | Settle / cancel |
|---|---|---|
| LND | `invoicesrpc.AddHoldInvoice(hash)` | `SettleInvoice(preimage)` / `CancelInvoice(hash)` |
| Core Lightning | Hold-invoice plugins (for example Boltz `hold`); not built in | Plugin RPCs |
| LDK | `create_inbound_payment_for_hash` | `claim_funds(preimage)` / `fail_htlc_backwards` |
| Breez Spark (Pontmore today) | Hold invoice with a supplied payment hash | Claim with preimage; held for about 4h |
| Nostr Wallet Connect | Hold-invoice methods, where the wallet service supports them | `settle_hold_invoice` / `cancel_hold_invoice` |
| Typical consumer wallets (Phoenix and similar) | Usually not available | — |

So yes: **RRP applies to any Lightning hold-invoice escrow in which the recipient's
node or wallet accepts an externally chosen payment hash.** Nothing in the
construction is specific to Spark.

The parts that differ between implementations are operational:

- **Hold horizon.**
  - Spark holds about 4h.
  - On LND or CLN it is bounded by the invoice `cltv_expiry`, by the sender's route
    CLTV limit, and by the payee's auto-cancel margin.
    - Mostro, for example, runs with 144 blocks and escalates 24 blocks before
      expiry.
    - Days are possible in principle, but long holds tie up liquidity and HTLC slots
      along the route, and peers treat this as jamming.
    - A direct channel between the parties avoids the routing cost.
- **Who verifies the lock.** The recipient must still check the incoming HTLC's
  amount and CLTV, which RRP does not cover. Today this is Pontmore's
  `verifyIncomingLock`.
- **MPP.** This is unaffected. All parts share `H_j`, and holding and settling work
  as for any hold invoice.

### Other SHA-256 hashlocks

The same commitment protects any HTLC-style lock:

| Lock | Notes |
|---|---|
| On-chain HTLC (BIP-199-style) | Unlimited dispute window; slow and costs fees |
| Liquid HTLC | About 1–2 minutes; federation trust |
| Submarine swaps (for example Boltz) | `H` crosses chains unchanged; RRP covers the whole swap |
| Ark VHTLC | Off-chain, can exit unilaterally; needs an Ark server |
| Cashu NUT-14 HTLC | Custodial mint; RRP adds a resolver without P2PK multisig |
| Spark HTLCs | Currently refused by Spark operators |

An implementation can define one RRP commitment format and many lock bindings. The
PIP-01 descriptor would name the lock type and the RRP version separately.

### Operator-run escrows

Systems whose operator holds the preimage, such as a Mostro node's own hold invoice,
do not need RRP, because the operator already acts as the resolver. RRP is for
designs where the two traders' wallets hold the lock and no operator does.

## Pontmore integration sketch

This is not yet normative. It assumes swap payloads become **signed**. Today they
are unsigned NIP-59 rumors (`protocol/payloads.ts`), which can serve neither as
evidence nor as fraud proofs.

1. **Escrow descriptor (PIP-01).** Add `preimage_escrow: "pontmore/rrp@1"` with
   `k_min` and the supported `(t, N)` to the `spark_hold_invoice` descriptor, or to
   any hold-invoice descriptor.
2. **Root binding (PIP-02 / swap@1).**
   - v1 uses `t = N = 1`, with the resolver being the root's single `core/resolver`.
     It MUST differ from every key the agent announces, and the customer chooses or
     approves it.
   - A panel needs a profile change. PIP-02 binds exactly one `core/resolver`. The
     options are to bind the panel keys under a new marker, or to commit to them in
     `private_terms`.
3. **Payloads (kind 7310).**

   | Payload | Sender | Change |
   |---|---|---|
   | `accept` (fiat_to_btc) / `request` (btc_to_fiat) | Provider | `payment_hash` → `rrp: {v: 1, k, t, resolvers: [X_m], candidates: [{E, H, c: [..]}]}` |
   | `invoice` | Recipient | add `rrp_challenge: j`; the invoice hash MUST equal `H_j` |
   | `locked` | Provider | add `rrp_openings: {i: e_i}`; `payment_hash = H_j` |
   | `rrp_share` (new) | Resolver → winner | `{m, share, S, dleq}` |

   This adds **no round trips**. All three steps ride on existing messages.
4. **Recipient gate.**
   - `verifyIncomingLock` runs step 4 before the app allows `fiat_sent`
     (fiat_to_btc), or before the agent's escrow key publishes `core/secure`
     (btc_to_fiat).
   - Failed openings are stored as fraud proofs.
5. **Resolution.**
   - `core/resolve_dispute` keeps its public effect, and its `evidence` commits to
     the material the resolver relied on.
   - `authorize_settlement` is followed by private `rrp_share` messages to the
     recipient.
   - `authorize_refund` is followed by the recipient's app cancelling the invoice.
6. **Engine.**
   - A recipient that holds a valid `P_j` always settles, disputed or not.
   - `core/settle` and `core/refund` record what was seen on the lock, never what
     the clock implies.
7. **Timing (Spark, ~4h horizon).** Example values:
   - pay within 30–45 minutes;
   - confirm within 30 minutes of `fiat_sent`;
   - `Δ_resolve` ≥ 2h;
   - `Δ_settle` + `Δ_safety` ≈ 20–30 minutes.
8. **Parameters.**
   - `k = 64` by default. For `N = 1` a commitment is about 6.2 KB raw (about
     12 KB as hex JSON), plus 2 KB raw per extra resolver. The openings add about
     2 KB.
   - Raise `k` for large amounts and for providers without history.

## Limits

- **Expiry is the deadline.** An undecided dispute is a provider win when the lock
  expires. RRP makes a ruling *enforceable*, not *timeless*.
- **Selective abort** gives a determined cheater with throwaway identities a 1/k
  chance per attempt. It can be made unlikely but not impossible without a
  non-interactive proof.
- **Arbiter trust remains** (`t` resolvers + one party). Panels spread it but do not
  remove it.
- **Late fraud proofs do not recover funds.** A provider caught at dispute time is
  exposed publicly, but the recipient's fiat is not returned. Bonds or exposure
  limits must cover that remainder.
- **Fiat chargebacks** are outside any hashlock escrow.

## Future work

- **Non-interactive verification.** A SNARK proving
  `H = SHA256(Dec(c, e·R))` for a committed `E`. This removes selective abort and
  the `k`-fold overhead, and is within reach of mobile provers for one SHA-256 block
  plus one curve multiplication.
- **PTLCs.** With point locks, the lock point `T = P·G` would allow verifiable
  encryption of `P` straight to the resolver, with no hash-specific trick.
- **Longer horizons.** Agent-to-customer direct channels, or RRP over Ark/Liquid
  HTLCs for larger swaps.
- **Resolver profiles.** A PIP-00-style definition (key, fee, response-time promise,
  policy URI, supported `(t, N)`) and client checks that resolvers are independent of
  agents.

## Test vectors

[`rrp/vectors.json`](rrp/vectors.json) contains:

- `single-resolver`: `k = 4`, `t = N = 1`, challenge `j = 2`.
- `panel-2-of-3`: `k = 4`, `t = 2`, `N = 3`, challenge `j = 1`.

Each vector lists the resolver secrets and x-only keys, the commitment, the challenge,
the openings, and the resolution: shares with `S` and DLEQ, the recovered preimage,
and the payment hash. Negative cases cover:

- wrong `H`
- wrong masked share
- wrong `e`
- a panel share that is off the polynomial

The vectors are derived deterministically from a fixed seed, for testing only. Real
implementations MUST use a CSPRNG.
