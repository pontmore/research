# Bisq: Escrow, Disputes and Trust

_Research snapshot: 19 October 2026. Sources: the Bisq wiki and blog (fetched 19 October 2026), and `bisq-network/bisq-musig` at `a9a9770` (16 October 2026). This is analysis, not an adopted Pontmore specification._

Related notes: [Escrow policies and exchange patterns][escrow-patterns] · [Resolver-recoverable preimages][rrp]

## Executive finding

Bisq is the longest-running decentralized fiat/bitcoin exchange, and it runs **three trade protocols with three different trust models**:

| Protocol | Status | Escrow | Who pays first | What protects the first payer |
|---|---|---|---|---|
| **Bisq 1 multisig** | Live (Bisq 1 desktop) | On-chain 2-of-2 with deposits from **both** traders | Fiat buyer, after the deposit confirms | Seller's locked trade amount + deposit; mediation; arbitration paid out of DAO funds |
| **Bisq Easy** (Bisq 2) | Live since 2024 | **None** | Fiat buyer | Seller's **reputation** (costly BSQ burns and bonds); small trade limits |
| **Bisq MuSig** (Bisq 2) | In development | Taproot 2-of-2, key swap via adaptor signatures | Fiat buyer, after the deposit confirms | As Bisq 1, with fewer transactions and more privacy |

Five ideas from Bisq matter most for Pontmore:

1. **A neutral default.** In Bisq 1 and MuSig, if traders can't agree, the escrow goes to **neither of them**. It goes to a DAO-controlled sink (the "Burning Men"), and an arbitrator then reimburses the winner. Lightning hold invoices always refund the payer, so the clock decides the dispute; Bisq's default instead gives both sides a reason to accept mediation.
2. **Deposits from both sides, plus a published penalty table.** Outcomes are predictable, and a mediator can suggest a split that both traders sign. The mediator holds no key.
3. **Payment-rail risk controls.** Bisq limits how much a new account can *buy* on rails where payments can be reversed, until the account is signed through a trade with a trusted peer and has aged. This targets the same risk as Peer's reversal windows, using account history instead of collateral.
4. **Reputation earned with costly signals**, and risk limited by the size of the seller's offers. Bisq Easy has no escrow at all and still works for small trades, because a seller's reputation costs real money (burned or bonded BSQ) and limits how much they can offer.
5. **Operational lessons from a real exploit.** On 1 May 2026 a modified client sent a **negative fee**, which shrank the multisig output; 11.59 BTC was lost. The hardening that followed (validate every number a counterparty supplies, keep layer boundaries, reproducible builds, an emergency stop) applies directly to Pontmore implementations.

Bisq Easy is the closest existing analogue of the Pontmore agent model: an experienced seller onboards new buyers, the buyer pays fiat first, and trades are small and backed by reputation. Clink's `fiat_to_btc` flow is Bisq Easy with a Lightning hold invoice added.

## 1. Bisq 1 multisig protocol

### 1.1 Flow

1. The maker publishes an offer and the taker accepts it.
2. Both sign a **deposit transaction** into an on-chain 2-of-2 multisig:
   - the seller locks the trade amount plus a deposit;
   - the buyer locks a deposit.
3. Both also sign, but do not publish, a **delayed payout transaction (DPT)**. It sends the whole escrow to the Burning Men, and only becomes valid after **10 days** (altcoin trades) or **20 days** (fiat trades) from deposit confirmation.
4. Once the deposit confirms, the buyer pays fiat and clicks *Payment started*.
5. The seller confirms receipt. Both sign the payout transaction, which returns each deposit and pays the trade amount to the buyer.

**Deposits.** The maker sets the deposit at 15–50% of the trade amount, with a minimum of 0.001 BTC; the taker matches it. Bisq recommends a value based on the asset's recent volatility. Both deposits are refunded automatically when a trade completes without a dispute. Example: a 1 BTC sale with 25% deposits locks 1.5 BTC.

**Trade period.** Each payment method has a maximum trade period. Sellers may wait until the end of it before confirming. For trades with signed accounts, the wiki suggests waiting "as long as possible" to reduce chargeback risk.

### 1.2 Disputes in three levels

| Level | Who | Binding? | Response times |
|---|---|---|---|
| Trader chat | The two traders, end-to-end encrypted | — | Replying is optional |
| **Mediation** | DAO-approved mediator with a 10,000 BSQ bond | **No.** The mediator holds no key and suggests a payout; both traders must sign it | Traders 48h; mediator up to 48h |
| **Arbitration** | Refund agent / arbitrator | Effectively yes, but paid outside the escrow | Traders 2 days; arbitrator up to 5 days |

- Mediation can be requested once the trade period ends.
- Arbitration opens only if a trader rejects the mediator's suggestion **and** someone publishes the DPT.
- Once the DPT is published, the escrow goes to the Burning Men. The arbitrator investigates and **pays the winner from their own wallet**, up to 0.5 BTC per trade.
- The arbitrator then asks the DAO for reimbursement in BSQ, which the DAO votes on, and burns or sells that BSQ.
- Claims above 0.5 BTC go directly to the DAO.

**Payout rules since 1 January 2023 ("Burning Men" reform).** In arbitration, the winner gets the trade amount plus their own deposit, and possibly part of the loser's deposit depending on the deposit percentage. The loser may lose only part of their deposit. Mediation therefore pays better than arbitration. That is deliberate: arbitration is the fallback nobody wants.

**Penalty table.** Bisq publishes maximum penalties as a percentage of the trade amount, mainly taken from the offender's deposit. Examples:
- fraud: 100%;
- chargeback after completion: 100%;
- no reply to the mediator within 48h: 25%;
- bitcoin-related words in the payment reference: 25%;
- paying from an account in a different name: 25%;
- late payment: 5–20%, depending on how late;
- cancelling without a valid reason: 20%;
- seller releasing late without a reason: 15%.

Penalties don't stack; normally the highest applicable one is used. Mediators usually leave the penalized trader at least 5%, so a suggestion is more attractive than arbitration.

### 1.3 Controls for reversible payment rails

**Account signing** applies only to fiat accounts with chargeback risk (SEPA, Zelle, Revolut, Interac and similar):
- An **unsigned** account can **buy** at most 0.002 BTC per trade. Selling is not restricted, because a seller who receives fiat can't charge it back.
- An account is **signed** by buying 0.0005–0.002 BTC from a seller whose account has been signed for more than 30 days.
- After signing, the buy limit rises to 50% of the maximum at day 30 and the full maximum at day 60.

**Payment-reference rules.** Never put the trade ID, "Bisq" or "bitcoin" in the payment reference; it stays blank or uses the account name. Violations are penalized, because banks flag those words.

### 1.4 Who keeps it running: the DAO

- **BSQ** is Bisq's bitcoin-based governance token. Contributors are paid in BSQ, and stakeholders vote on reimbursements and roles.
- **Bonded roles** (mediators, infrastructure operators) lock BSQ that the DAO can confiscate for negligence or misconduct.
- **Burning Men** are contributors who burn BSQ in advance. They receive DPT outputs and BTC trade fees in proportion to their burn share, which spreads custody of disputed funds across many parties instead of one donation address.
- **Signed filter.** Fee routing and other network parameters are set through a filter signed by a trusted contributor. Clients verify the signature. This is a central control point.

## 2. Bisq Easy (Bisq 2): no escrow, reputation instead

### 2.1 Flow

The seller shares payment details, the buyer sends a bitcoin address (on-chain or Lightning), the buyer pays fiat, and the seller releases the bitcoin. There is **no security deposit and no trade fee**; the seller pays the mining or routing fee.

- Every trade must be between **6 and 600 USD** equivalent.
- A seller's **maximum offer size grows with their reputation score**. Since v2.1.1 this cap replaced buyers' minimum-score filter as the main risk control.
- **Mediators** help complete or cancel trades and confirm payments. **Moderators** ban serious rule-breakers.
- Before payment details are exchanged, either side can cancel freely. After that, not following through is a breach that can lead to a ban.

### 2.2 Reputation

Scores add up across these sources:

| Source | Points | Notes |
|---|---|---|
| Burned BSQ | 100 per BSQ, rising to 200 over the first year | Permanent; minimum 5.46 BSQ |
| Bonded BSQ | 10 per BSQ, rising to 20 over the first year | Only while bonded (lock of about a year); the DAO can confiscate it |
| Bisq 1 account age | 4 per day, up to 2,000 days | Imported with a proof signed by the Bisq 2 profile |
| Bisq 1 signed account | 10 per day, up to 2,000 days | Account must be at least 61 days old |

- An oracle publishes burns and bonds once they confirm on-chain.
- Users see stars (0–5), ranked relative to other *active* users.
- A ban erases a profile's entire reputation for good.

Reputation has to be bought, permanently or with locked capital, and losing it is expensive. That is what allows trades without escrow.

## 3. Bisq MuSig (Bisq 2, in development)

The goals are to cut a trade from four on-chain transactions to **one**, remove visible scripts, and **handle unresponsive traders automatically**. The source is `concept/SingleTxOverview.md` in `bisq-musig`.

- **Deposit.** One taproot transaction with two outputs, each locked to a MuSig2 aggregate key: `P'` holds the seller's trade amount and deposit, `Q'` holds the buyer's deposit.
- **Normal completion without a transaction.** When the fiat arrives, the seller sends her key share `p_a`. The buyer now controls `P'` outright, and the funds can stay where they are. Ownership moves by **swapping keys, not by broadcasting**.
- **Atomic swap of keys.** A pre-signed `SwapTx`, built with an **adaptor signature**, protects the seller if the buyer goes silent. If she broadcasts it to recover her deposit, she reveals `p_a`, so the buyer can still claim the trade funds.
- **When something goes wrong:**
  - Either trader can broadcast a `WarningTx`.
  - The counterparty can then send everything to the Burning Men with a `RedirectTx` and take the case to arbitration.
  - If the counterparty does nothing, the trader who broadcast the `WarningTx` gets everything with a `ClaimTx` after a longer timelock.
  - A `WarningTx` broadcast *after* the keys were swapped is punished: the honest side takes all the funds (`PunishTx`).
- **Watchtowers.** After the swap, the honest side must notice a late `WarningTx` in time. The team's working answer is to run checks from the app (desktop autostart or mobile) and warn users to move their funds out within the claim timelock. They judge the attack too risky to be worth attempting, since the attacker loses their deposit if caught.
- **Mediation.** A mediated custom payout flow is being added (bisq2 PR #4987). Under 2-of-2, mediation still means both traders sign.

## 4. Network, identity and apps

- **No central servers.** Bisq 2 runs over Tor hidden services, with experimental I2P support, and uses proof of work against DoS.
- **Identities.** Users can keep one global identity or use a new one for each trade or chat room.
- **Mobile:**
  - *Bisq Easy Mobile*: a full Android node.
  - *Bisq Connect*: a thin Android/iOS client that remotely controls a Bisq 2 node (your own, one on Umbrel or StartOS, or a trusted person's). The pairing token gives full control of that node's trades.

## 5. The May 2026 incident

- **What happened.** On 1 May 2026 a modified Bisq 1 client, acting as taker, sent a **negative miner fee**. The maker didn't check the value and computed a reduced multisig output, so the difference went to the attacker's change. 10 users lost 11.59104 BTC. Bisq 2 and Bisq Easy were not affected.
- **How trading was stopped.** Through version enforcement: a mandatory version that didn't exist yet.
- **Reimbursement.** Volunteers ("Refund Angels") advanced 10.985 BTC before any terms were agreed. The DAO approved the plan on 25 May and victims were paid on 5 June. Refund Angels are repaid from a growing share of the Burning Men's fees.
- **Hardening in release 1.10.0:**
  - broader validation of trade messages, deposit and payout transactions, and contract data;
  - verification of dependency signatures;
  - groundwork for reproducible builds;
  - temporary limits: 0.125 BTC maximum trade, 25% price-deviation cap, XMR auto-confirmation disabled, no dispute attachments.
- **Lessons the team drew:**
  - the bug was likely found with AI help, so years of public review don't make code "battle-tested";
  - manual steps between protocol layers limited the damage, and MuSig's automation removes some of those steps;
  - defense in depth matters.

## 6. Strengths

1. **Escrow is backed by mechanism, not a trusted party** (Bisq 1, MuSig). Funds sit in a 2-of-2 that neither trader can move alone, and the default is neutral.
2. **Disputes almost never reach arbitration.** Deposits, the penalty table and the worse arbitration payout make agreeing in mediation the rational choice.
3. **Risk is managed by payment rail.** Account signing and aging solves chargeback fraud without KYC.
4. **Reputation is expensive to build and expensive to lose**, and offer size is capped by reputation, so new sellers can't take large exposures.
5. **No central servers.** Tor/I2P, multiple identities, and no trading server to seize.
6. **Proven in practice.** Years of operation, documented processes, and timed response obligations for every role.
7. **Protocol improves in steps.** MuSig keeps the Bisq 1 trust model while fixing its cost and privacy.

## 7. Weaknesses and trade-offs

1. **Slow and capital-heavy.** On-chain confirmations, 15–50% deposits from both sides, and 10–20 day timelocks. Hard to use for small, fast mobile-money trades.
2. **Arbitration needs off-chain capital and governance.** Refund agents pay winners first and wait for a DAO vote, carrying volatility and refusal risk. The 2026 incident showed the DAO keeps no reserves for losses at scale.
3. **Real central points remain.** The signed filter, version enforcement, the bonded-role registry and the reputation oracle are trusted parts.
4. **Bisq Easy protects only small amounts.** The 600 USD cap reflects that.
5. **Desktop first.** Bisq Connect depends on a node that is always on, and MuSig needs watchtowers.
6. **Complex.** Many pre-signed transactions per trade, and validation gaps are exactly where the 2026 exploit happened.

## 8. Compared with Pontmore today

| Dimension | Bisq 1 / MuSig | Bisq Easy | Pontmore (`swap@1` + clink/pontspark) |
|---|---|---|---|
| Escrow | On-chain 2-of-2 | None | Lightning hold invoice (Spark) |
| Collateral | Both sides, 15–50% | None | None |
| Default if no one acts | Funds go to a neutral sink, then arbitration | — | Payer refunded when the lock expires (about 4h) |
| Who resolves | Mediator suggests; arbitrator pays from outside the escrow | Mediator assists; moderator bans | The agent itself (§1 of the [escrow note][escrow-patterns]) |
| Reversal risk | Account signing and aging | Reputation, small limits | Card rails excluded; nothing else |
| Reputation | Account age and signing | Burned/bonded BSQ, imported age | None yet ([PeerBadge note][peerbadge]) |
| Speed | Hours to days | Minutes | Minutes |
| Infrastructure | Tor P2P, DAO | Tor P2P, DAO | Nostr relays, Spark |

## 9. Lessons for Pontmore

### For the Pontmore protocol

1. **Allow a neutral sink as a declared default.** Where the lock lasts long enough, an escrow policy's default can be "redirect to a resolver pool" instead of "refund the payer". In the [policy language][escrow-patterns] this is `default: redirect(pool)`, with the property checks extended so that the pool can't be a party to the trade. It needs a long-lived pattern (on-chain, Cashu P2PK, a contract). Lightning hold invoices can't do this, which is one more reason long-lived escrows matter.
2. **Mediate first, with a 2-of-2 escrow.** Bisq shows that a resolver with **no key**, whose suggestion both traders sign, settles most disputes when deposits and penalties make agreement rational. Pontmore can add `core/propose_resolution` (a mediator's suggestion) and treat a payout signed by both parties as the outcome. A resolver key is then only needed for the fallback.
3. **Publish penalty tables as part of the policy.** The `policy` URI of a `core/resolve_dispute` should point to a published table like Bisq's. Rulings become predictable, and a split effect (escrow note §7.4) gets a defined meaning.
4. **Add risk fields to the payment-channel registry.** The shared payment-channel registry should record reversal risk, plus **buy-side limits for new or unsigned payout accounts** and the rules for when those limits grow. The asymmetry (limit buying, not selling) is the key detail.
5. **Make every number a counterparty sends part of the protocol's validation.** Fees, amounts and timelocks need range checks, tested with shared vectors. The negative-fee exploit was exactly this gap. PIP-02's kernel invariants should require it explicitly.
6. **Separate assisting from deciding.** Mediators, moderators and arbitrators have different powers, response times and bonds. Mostro arrived at the same split independently (read and read-write solvers).

### For Pontmore agents and apps

1. **Pontmore agents are Bisq Easy sellers.** The same tools apply:
   - reputation backed by something costly (an agent bond in sats, or an attested trade history);
   - **offer size capped by reputation tier**;
   - small default limits for new agents.
2. **Use bonds to make agents and resolvers accountable.** A confiscatable bond matches Bisq's bonded roles.
3. **Give disputes timers and outcomes:**
   - fixed response times (48h for traders and mediators, longer for escalation);
   - a published penalty table;
   - mediation that pays better than escalation.
4. **Account aging for mobile money.** Apply limit growth by account age to customers paying with M-Pesa, Airtel and similar rails, at least where reversals are possible. New payer accounts start small.
5. **Plan how losses are funded.** Bisq's refund agents and Refund Angels show what happens without a reserve. Any operator-run escrow or resolver pool should keep an explicit reserve or insurance fund, funded from fees, instead of relying on goodwill after the fact.
6. **An emergency stop as an operator choice.** Version enforcement or a signed kill switch let Bisq stop an exploit within hours. For decentralized Pontmore apps this should be an option each operator chooses, not a central switch.

## 10. Open questions

1. Is MuSig's warning, redirect and claim design final? `ProtocolUpdate2.md` proposes removing the redirect delay and returning the claim to a script.
2. Can a neutral-sink default work for fast trades without the 10–20 day timelocks? For example, Cashu P2PK with a short locktime and a resolver-pool refund key.

## Sources

- Bisq wiki: [Dispute resolution][w-dispute], [Arbitration][w-arb], [Trading rules][w-rules], [Table of penalties][w-pen], [Security deposit][w-dep], [Account signing][w-sign], [Bisq Easy][w-easy], [Reputation][w-rep], [Trade protocols][w-proto], [Bisq 2][w-bisq2], [Bisq 2 mobile applications][w-mobile]
- Bisq blog: [Security incident post-mortem][b-pm], [Where Bisq stands after the security incident][b-after], [Trade protocols][b-proto], [Bisq Easy on mobile][b-mobile]
- Code: [bisq-network/bisq-musig][musig] (`concept/SingleTxOverview.md`, `ProtocolUpdate2.md`, `watchtower/OverviewWatchTowers.md`), [bisq2 PR #4987 (MuSig mediated custom payout)][pr4987], [bisq-mobile releases][mobile-rel]

[escrow-patterns]: ./escrow-policies-and-exchange-patterns.md
[rrp]: ./resolver-recoverable-preimage.md
[peerbadge]: ./peerbadge.md
[w-dispute]: https://bisq.wiki/Dispute_resolution
[w-arb]: https://bisq.wiki/Arbitration
[w-rules]: https://bisq.wiki/Trading_rules
[w-pen]: https://bisq.wiki/Table_of_penalties
[w-dep]: https://bisq.wiki/Security_deposit
[w-sign]: https://bisq.wiki/Account_signing
[w-easy]: https://bisq.wiki/Bisq_Easy
[w-rep]: https://bisq.wiki/Reputation
[w-proto]: https://bisq.wiki/Trade_Protocols
[w-bisq2]: https://bisq.wiki/Bisq2
[w-mobile]: https://bisq.wiki/Bisq_2_mobile_applications
[b-pm]: https://bisq.network/blog/security-incident-post-mortem/
[b-after]: https://bisq.network/blog/where-bisq-stands-after-security-incident/
[b-proto]: https://bisq.network/blog/trade-protocols/
[b-mobile]: https://bisq.network/blog/mobile-apps-completed/
[musig]: https://github.com/bisq-network/bisq-musig
[pr4987]: https://github.com/bisq-network/bisq2/pull/4987
[mobile-rel]: https://github.com/bisq-network/bisq-mobile/releases
