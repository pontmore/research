# Peer and Pontmore: Competition, Trust, and a Path to Adoption

_Research snapshot: 16 October 2026. This is comparative research and a proposed strategy, not an adopted roadmap, security audit, or claim of production readiness. Repository sources are pinned below; website documentation and analytics are dated observations. PeerBadge, discussed in `peerbadge.md`, is a separate project._

## Executive finding

Peer competes directly with Pontmore swap applications for customers, liquidity providers, and wallet integrations. The closest comparisons are **Peer versus Pontspark** at the product layer and **ZKP2P versus Pontmore** at the protocol layer. PeerLink supports Peer's integration-development effort; it is not the trading protocol itself.

Peer has the stronger demonstrated commercial position: an operating marketplace, payment-verification infrastructure, developer distribution, and measurable fulfilled volume. Pontmore's credible opening is a shared network through which independent Bitcoin desks, wallets, and escrow services can coordinate while retaining their identities and business policies. That is a design opportunity, not an established network effect. [Peer protocol][peer-protocol] [Pontmore README][pontmore-spec]

Pontmore would become compelling if a focused local market delivered dependable liquidity, enforceable customer protection, useful operator economics, and trades across independently operated clients and services. More generic coordination features alone would not establish that advantage.

## Evidence and scope

This comparison uses the current Pontmore specification, Pontspark mobile client, Rust reference implementation, website source, Peer documentation, and PeerLink/Peer Cash repositories. It assesses documented behavior rather than independently testing deployments or moving funds.

The Pontmore website timed out during this research. Its repository source was inspected instead; that does not establish what is deployed at `pontmore.xyz`. Cached GitHub views also exposed an older four-PIP layout, so the protocol was checked directly against current `main`: the active family is PIP-00, PIP-01, experimental PIP-02, and the experimental `pontmore/swap@1` profile. Former PIP-03 is not current. [Pontmore README][pontmore-spec] [Website source][website]

## What Peer and PeerLink are

**Peer** is the consumer marketplace built on the ZKP2P protocol. A seller deposits crypto liquidity into a smart contract; a buyer pays fiat directly through an existing payment platform; verified payment evidence authorizes release. Current production V3 contracts run on Base, with USDC central to the product's liquidity model. Supported buyer verification and Seller Autopilot use an AWS Nitro enclave to inspect payment data and produce signed attestations checked by the contracts. These are documented mechanisms, not independent assurance of their implementation or availability for every listed rail. [Peer protocol][peer-protocol] [Attestation service][peer-attestation]

The project began as ZKP2P in 2023, launched V1 in November 2023, and announced the Peer rebrand on 5 February 2026. Its history is therefore almost three years of a public product, with a much newer consumer brand. The migrated V2 article has an internally inconsistent publication year; this note uses its explicit November 2023 V1 statement, not its V2 date. [V1 history][peer-v2] [Rebrand][peer-rebrand]

**PeerLink** collects banking transcripts from account owners to help engineers develop integrations. Its current contribution flow replays read-only banking requests inside an enclave and retains request/response structure rather than raw transaction values. Accepted contributions earn a fixed $10 USDC on Base, subject to campaign capacity. A transcript is integration research: acceptance neither proves a particular payment nor automatically makes that bank available in Peer. [PeerLink README][peer-link]

## Comparison by layer

| Dimension | Peer / ZKP2P | Pontmore ecosystem | Competitive implication |
| --- | --- | --- | --- |
| Customer outcome | Fiat-to-crypto and crypto-to-fiat trading through familiar payment apps | Fiat/Bitcoin swaps through agents; broader coordination is the protocol ambition | Direct competition where the customer's desired outcome overlaps |
| Identity and discovery | Wallet/payment-platform identities, application services, and indexed liquidity | Nostr pubkeys, signed capability indexes, and expiring escrow descriptors | Pontmore makes portable participant identity and discovery explicit protocol objects |
| Economic state | Smart-contract deposits and intents plus signed payment attestations | Signed roots and linked actions reconstructed under a pinned profile | Pontmore standardizes coordination history; selected services still execute external effects |
| Settlement | Production V3 contracts on Base | Multiple descriptor mechanisms; Pontspark currently uses Spark HTLCs | Protocol flexibility must be distinguished from implemented cross-mechanism trading |
| Fiat evidence | Supported platform data inspected by the verification service | Swap profile records sender and receiver claims; evidence evaluation is outside the kernel | Peer currently has the stronger documented bridge from payment evidence to release |
| Integration | SDKs, APIs, affiliate economics, and agent tooling | Experimental Rust daemon and TypeScript mobile implementation | Openness and automation are shared properties, not exclusive Pontmore advantages |
| Operational maturity | Operating marketplace with externally reported volume | Experimental software; production connectors and interoperability evidence remain incomplete | Compare customer outcomes and deployment evidence, not repository counts |

Sources: [Peer protocol][peer-protocol], [Peer Cash][peer-cash], [Pontmore README][pontmore-spec], [PIP-01][p01], [PIP-02][p02], [swap profile][swap], [Pontspark][pontspark], and [Rust implementation][rust].

## The decisive trust difference

### Payment verification versus signed coordination claims

Peer's current verification path turns authenticated payment-platform observations into an EIP-712 attestation. Its verifier checks that attestation before contract settlement. The trust dependencies include the approved signer, enclave measurement and software, AWS infrastructure, payment-platform data, and relevant contract administration. This is not an unconditional guarantee against payment reversals or platform failure. It is nevertheless a concrete mechanism for authorizing settlement from payment evidence. [Attestation service][peer-attestation]

Pontmore's kernel checks signatures, bound authorities, event linkage, deadlines, forks, and allowed economic transitions. It does not determine whether a receipt is authentic or whether fiat actually arrived. A valid `core/settle` is an authorized protocol statement; external settlement must also be established under the selected service's rules. This separation makes multiple trust models possible but does not make every implementation equally safe. [PIP-02][p02] [Swap profile][swap]

### Pontspark's current withholding risk

Pontspark documents a specific failure: a dishonest Bitcoin seller can receive fiat, withhold the HTLC preimage, and recover their Bitcoin at expiry. Its resolver is derived from the agent's keys, and a resolution does not itself move funds. The customer can therefore lose fiat despite a correctly implemented Bitcoin lock. [Pontspark swap flow][pontspark]

Adding a separately owned resolver key alone would not solve this. The selected custody mechanism must make the resolution enforceable, or a separate funded compensation mechanism must cover the loss. This is a product-level safety requirement, not a reason to place private evidence evaluation inside the PIP-02 kernel.

### Other current limits

Pontspark documents a foreground-only agent model, Spark compatibility requirements, and reputation based on a raw count of agent-signed settlement events. Those are not demonstrated continuous availability, cross-wallet interoperability, or independent performance evidence. Public coordination events also expose relationship and timing metadata even when payment details remain encrypted. [Pontspark limits][pontspark] [PIP-02 privacy boundary][p02]

The Rust implementation provides durable work, connector reconciliation, relay publication, and deterministic validation. It remains experimental; the included connector moves no value. Its capabilities should not be presented as a deployed economic integration. [Rust implementation][rust]

## Peer's distribution strategy and evidence of success

Peer combines a simple consumer proposition with incentives for marketplace supply and developer distribution:

- **Consumer positioning:** familiar payment apps, speed, low fees, and no extra identity checks. The rebrand explicitly moves the explanation toward people and away from cryptographic terminology. [Website][peer-site] [Rebrand][peer-rebrand]
- **Seller acquisition:** content about earning spreads, including a published individual claim of 152% APY. That claim is a marketing example, not a guaranteed or representative return. [Peer blog][peer-blog]
- **Partner distribution:** Peer Cash documents an integration share of 50 basis points on filled liquidity, capped by the configured Peer service fee. SDKs and agent integration guidance lower implementation friction. [Peer Cash][peer-cash]
- **Community and integration research:** founder interviews reach specialist audiences; PeerLink rewards account owners for useful integration transcripts. Whether either channel acquires retained traders is unproven by the material reviewed. [Founder interview][interview] [PeerLink][peer-link]

The DeFiLlama page inspected on 16 October 2026 reported approximately **$21.8 million cumulative fulfilled volume**, **$1.29 million over 30 days**, **$318,323 over seven days**, and **$56,205 TVL**. Its volume methodology sums fulfilled intents from the protocol's public indexer. These figures establish reported trading activity, not unique customers, organic demand, or retention. The indexer and adapter coverage were not independently reconciled against chain history for this note. [DeFiLlama][llama]

Peer already reported more than $1 million monthly volume in November 2025. The latest rolling monthly snapshot is in the same order of magnitude. Two differently sourced observations do not establish a growth trend, but they do not substantiate a recent breakout either. [V3 announcement][peer-v3] [DeFiLlama][llama]

Do not treat DeFiLlama's roughly $25,399 monthly fees as company revenue: its methodology counts positive maker spreads and records zero protocol revenue. Peer's website separately advertises a service fee. This coverage discrepancy prevents a reliable profitability conclusion. Customer acquisition costs, repeat usage, trading concentration, and operating costs were not established. [DeFiLlama methodology][llama] [Peer fee disclosure][peer-site]

## A proposed strategy for Pontmore

The following priorities are recommendations, not adopted protocol requirements or validated market findings.

### 1. Prove one recurring customer outcome

Use BTC/KES through M-Pesa as an initial hypothesis if operator access and customer interviews support it. Select a recurring need, such as converting Bitcoin earnings into spendable local money. Recruit dependable, funded operators before advertising broad coverage.

Compare executable total cost, trade-size availability, completion time, and support against the alternatives those customers actually use. Test whether they prefer holding Bitcoin: a stablecoin seller's customer need is not automatically a Bitcoin wallet's customer need.

A payment-channel schema supplies fields and validation. It does not supply liquidity, payment verification, payout capability, or operator authorization. Adding registry entries must not be counted as launching markets. [Pontspark channel integration][pontspark]

### 2. Choose an enforceable customer-protection model

For that market, investigate authenticated payment evidence tied to release, independently enforceable arbitration, or funded operator guarantees. Specify the trust assumptions, funding, authority, and recovery behavior of the chosen design before claiming protection.

Test withholding after fiat payment, ambiguous provider outcomes, duplicate requests, crashes, partial payments, and refunds. A dispute status or support promise must not stand in for a mechanism that can deliver the economic remedy.

Keep provider execution and private evidence behind services and agents. Preserve the distinction between an observed payment, an authorized protocol action, and an externally completed transfer. [PIP-01][p01] [PIP-02][p02]

### 3. Make a desk profitable and practical to operate

Prioritize reliable availability, pricing and inventory management, reconciliation, durable recovery, and clear support tools. Measure net operator earnings after capital costs, payment costs, losses, and staff time. A technically open network with unavailable desks will lose customers to a more dependable service.

The Rust daemon is a starting point for continuous operations, not proof of a complete deployed desk. Build and validate the actual economic connectors and signing/custody boundaries. [Rust implementation][rust]

### 4. Demonstrate independence through interoperability

The strongest demonstration would combine a wallet, desk, and escrow service operated by separate parties. They should agree on the same protocol state and successfully handle settlement, refund, dispute, replay, fork, and recovery cases.

Shared conformance work is already identified in issue #26. As inspected, it remains open and describes thin swap-vector coverage and the need for a shared versioned source. Having Rust and TypeScript implementations is useful; independently reproducing compatible outcomes is the evidence that matters. [Conformance issue][vectors] [Swap profile][swap]

### 5. Distribute through operators, communities, and wallets

Recruit desks with existing customers, then make their inventory accessible through multiple clients. Reward completed useful integrations and repeat trading rather than declarations of support. Offer integrators documented recovery behavior and a credible commercial reason to participate.

The website source leads with general economic coordination. Retain that explanation for protocol builders, while giving customers a direct route to a concrete product promise. For example: “Exchange Bitcoin and M-Pesa with independent local desks.” Publish actual availability and execution results before promising universal coverage. [Website source][website]

### 6. Keep the protocol's scope disciplined

Use the swap market to discover which rules genuinely require interoperability. Keep reputation policy, commercial terms, provider integrations, and operational controls in their existing application/service boundaries unless independent implementations demonstrate a common protocol need. Additional profiles should follow a demonstrated use case. [Pontmore design boundary][pontmore-spec]

## Pilot scorecard and decision gates

Set numerical targets before the pilot using customer needs and measured alternatives. The table defines what to measure rather than inventing market benchmarks.

| Question | Evidence | Decision enabled |
| --- | --- | --- |
| Can customers trade when needed? | Funded executable quotes by amount, time, direction, and payment channel; completion rate | Whether to recruit more supply or expand demand |
| Is the outcome competitive? | Total cost; median and p95 time from acceptance to actual receipt | Whether the product offers a reason to switch |
| Are customers protected? | Losses, disputes, remedy completion, recovery time, and compensation funding | Whether to increase limits or keep the pilot constrained |
| Do customers return? | Repeat usage by cohort among customers with recurring needs; incentive dependence | Whether demand persists beyond launch activity |
| Do operators benefit? | Net contribution after capital, payment, support, and loss costs | Whether supply can remain without subsidy |
| Is protocol independence real? | Shared vectors and completed cross-client/service trades, including recovery | Whether to claim interoperability |
| Is the system resilient? | Restart, relay outage, duplicate delivery, and ambiguous-operation recovery results | Whether continuous operation is ready |

Do not expand to another market merely because another schema exists. Expand when the first market has repeat demand, sustainable supply, and demonstrated recovery. Do not market general interoperability until separate implementations and operators reproduce it.

## Competition and possible composition

Peer is a competitor, but a future Pontmore agent could potentially use Peer as one external execution route while maintaining Pontmore-facing identity and coordination. This is an integration hypothesis, not existing compatibility. It would require explicit asset conversion, liquidity, payment-method availability, authority mapping, idempotency, and reconciliation; a USDC trade is not automatically a Bitcoin swap outcome. No change to Pontmore's canonical state or user authorization should be inferred from a successful external API call. [Peer Cash][peer-cash] [Pontmore implementation boundary][rust]

Pontmore's defensible advantage would be an operating ecosystem of trusted desks, useful local liquidity, enforceable recovery, and compatible independent clients. The open specifications make that possible. Customer and operator outcomes must make it desirable.

## Source snapshot

Repository links below pin the revisions inspected. Documentation, issue state, and analytics can change; this note makes no live-deployment or economic-safety certification.

- Pontmore protocol: `edcf1370e7e646574021709cc9b186d96377280a`.
- Pontspark: `e958770724f7dd3d9d556f7dcf841eab57fcf135`.
- Rust reference implementation: `a7719710531aaae97685c2baddd2436b42478393`.
- Pontmore website source: `8c80ac33edaef6cee6472f35041aff4d5c9f148b`.
- PeerLink: `f0ca7f778c2a9edb6aae0569186a2461b200e7d2`.
- Peer Cash: `5077c53a019e4dc971fb6b185c42d33656248f74`.

[pontmore-spec]: https://github.com/pontmore/protocol/blob/edcf1370e7e646574021709cc9b186d96377280a/README.md
[p01]: https://github.com/pontmore/protocol/blob/edcf1370e7e646574021709cc9b186d96377280a/PIP-01-escrow-descriptor.md
[p02]: https://github.com/pontmore/protocol/blob/edcf1370e7e646574021709cc9b186d96377280a/PIP-02-coordination-event-chains.md
[swap]: https://github.com/pontmore/protocol/blob/edcf1370e7e646574021709cc9b186d96377280a/profiles/swap-v1.md
[pontspark]: https://github.com/pontmore/pontspark/blob/e958770724f7dd3d9d556f7dcf841eab57fcf135/README.md
[rust]: https://github.com/pontmore/pontmore/blob/a7719710531aaae97685c2baddd2436b42478393/README.md
[website]: https://github.com/pontmore/website/blob/8c80ac33edaef6cee6472f35041aff4d5c9f148b/app/page.tsx
[vectors]: https://github.com/pontmore/protocol/issues/26
[peer-site]: https://peer.xyz/
[peer-protocol]: https://docs.peer.xyz/protocol/zkp2p-protocol
[peer-attestation]: https://docs.peer.xyz/protocol/v3/v3-attestation-service
[peer-v2]: https://docs.peer.xyz/blog/intro-zkp2p-v2
[peer-v3]: https://docs.peer.xyz/blog/intro-zkp2p-v3
[peer-rebrand]: https://docs.peer.xyz/blog/zkp2p-is-now-peer
[peer-blog]: https://docs.peer.xyz/blog
[peer-link]: https://github.com/zkp2p/peer-link/blob/f0ca7f778c2a9edb6aae0569186a2461b200e7d2/README.md
[peer-cash]: https://github.com/zkp2p/peer-cash/blob/5077c53a019e4dc971fb6b185c42d33656248f74/README.md
[interview]: https://zeroknowledge.fm/podcast/409/
[llama]: https://defillama.com/protocol/peer
