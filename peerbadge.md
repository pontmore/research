# PeerBadge and Pontmore: Research on an Optional Trust Layer

_Research snapshot: 15 September 2026. PeerBadge main: `f458f4624adab8ee68f13eca715d4097ff24fb9b` (31 August 2026). Pontmore protocol main: `d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75` (14 September 2026). This is analysis, not an adopted Pontmore specification or a claim of production security._

## Executive finding

PeerBadge could help a Pontmore client answer a question that Pontmore deliberately leaves to applications: **why should I trust this Agent, escrow, or resolver for this particular role?** Pontmore already gives clients signed capability declarations, expiring escrow compatibility descriptors, and a reconstructible coordination chain. None proves that an Agent is reliable, a resolver is fair, or an escrow is solvent. PeerBadge proposes portable, signer-issued claims that a holder discloses selectively, with verifier-local trust policy rather than one network-wide reputation score. [Pontmore PIP-00][p00] [Pontmore PIP-01][p01] [Pontmore PIP-02][p02] [PeerBadge whitepaper][pb]

The best near-term use is **an optional, private pre-coordination credential check in a Pontmore application**, not a required PIP or a badge embedded in public Agent/coordination events. A verifier could ask an Agent, escrow candidate, or resolver candidate to present a suitably scoped badge before agreeing to a coordination. The verifier's decision would remain application policy. Once the root binds participant and authority pubkeys, a later badge presentation must not rewrite those bindings or authorize an otherwise invalid PIP-02 action.

PeerBadge itself is not ready to be a money-moving trust dependency. Its repository contains a whitepaper and diagram, not a normative cryptographic construction, interoperable wire format, test vectors, reference implementation, or audit. This is confirmed by its [repository README][pb-readme] and current file list. The integration described below is a **testable design hypothesis**, contingent on those missing artifacts.

## Scope and evidence method

This research compares current primary texts, not the older Pontmore forum introduction. On 14 September Pontmore simplified its core to three PIPs:

| Current component                  | Verified responsibility                                                                              | Credential implication                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [PIP-00][p00], kind `30360`        | Versioned capability index, not an offer, availability proof, or reputation statement                | A badge can inform a _local_ trust decision about a declared capability; it does not make the capability declaration true.            |
| [PIP-01][p01], kind `30361`        | Expiring escrow compatibility and optional OpenAPI/AsyncAPI service-schema pointer                   | A badge might help select an escrow publisher or service, but cannot prove solvency, custody safety, or service-schema correctness.   |
| [PIP-02][p02], kinds `7300`/`7301` | Immutable root, linked actions, bound roles/authorities, economic gates, disputes, fail-closed forks | Credential checks should happen before commitment; badges cannot substitute for root-bound action-signer authorization or move funds. |
| [`pontmore/swap@1`][swap]          | Experimental fiat/Bitcoin swap terms, actions, roles, recovery rules                                 | Example application context for a credential request; not the only Pontmore coordination profile.                                     |

The former PIP-03, older PIP-02 event kinds `7302`–`7304`, and addressable snapshots are **not** current version-2 core. PIP-02 says resolver selection, reputation, Sybil resistance, staking/bonding, and private evidence evaluation are outside Pontmore. That boundary is precisely where PeerBadge might help. [PIP-02][p02]

PeerBadge's [whitepaper][pb] specifies roles (signer, holder, verifier, delegated subject), claim-visible partially blind issuance, holder-controlled presentation, signer authority, badge-digest revocation, and local verifier policy. It explicitly states that the signature proves who issued a claim, **not** whether the claim is true. Its promised privacy is separation of issuance from later presentation; presentations of the same finished badge are linkable by design. These are design statements, not independently validated implementation results.

## The benefit, narrowly stated

### 1. Contextual credentials instead of a global reputation score

A Pontmore Agent can self-declare `pontmore/swap@1` support. An application still needs to assess whether that Agent should be used for a Kenyan mobile-money corridor or a particular settlement size. PeerBadge lets a known signer make a narrow claim—for example, `operator_training_completed@1` or `corridor_partner_verified@1`—and lets each verifier decide whether that signer and claim matter. This avoids making a scalar reputation score or mandatory trusted issuer part of PIP-00. [PIP-00][p00] [PeerBadge §§4, 6, 9][pb]

The distinction matters: `operator_training_completed` may support onboarding, but does not imply live liquidity; `escrow_operator_reviewed` may support operator selection, but does not prove current reserves or that the accepted service will correctly execute a refund. A credential must name a specific meaning, freshness window, issuer policy, and intended use.

### 2. Portable trust without operator-owned Agent identity

Pontmore's public Agent identity is its Nostr pubkey, not an application account. PeerBadge's separate durable holder and delegated subject keys could let an organization keep a credential-bearing key offline while authorizing an operational Pontmore pubkey to present a claim. This aligns with Pontmore's portability goal—provided the delegation is actually constrained and revocable. [Pontmore README][pont-readme] [PeerBadge §§2, 5][pb]

There is a tension: PeerBadge proves something about a **holder**, whereas a Pontmore coordination names **specific Nostr pubkeys**. A verifier must not silently treat a holder credential as a claim about every key the holder can sign for. The delegated subject should be the exact Agent, escrow, or resolver pubkey, and the badge's claim must permit that kind of delegation. Otherwise reputation can be rented to unrelated Agents.

### 3. Private presentation at the right point in the workflow

Pontmore's public events expose participant and authority pubkeys and minimum coordination facts. Publishing a badge, its digest, or a stable holder identifier in PIP-00 or PIP-02 would create another public correlation handle. A private credential request and presentation _before_ `core/accept` can give a verifier useful information without making every observer see issuer–holder links. PIP-02 permits Gift Wrap or another profile-defined private channel for supplementary payloads, but private messages cannot override the public chain. [PIP-02][p02] [NIP-59][nip59]

PeerBadge presentation is still linkable to parties who see the same badge. Gift Wrap hides most message metadata from relays, not from the recipient/verifier, and does not make the badge unlinkable. NIP-59 itself is an envelope, **not** a PeerBadge messaging protocol; an application must define request, response, replay protection, and delivery rules. [PeerBadge §8][pb] [NIP-59][nip59]

### 4. Better issuer accountability for resolver and escrow selection

PIP-02 binds `core/escrow` and optionally `core/resolver` to exact root pubkeys and validates them against the accepted service/profile. It does not prescribe whether those authorities deserve trust. PeerBadge could let an application require credentials from independently chosen signers before accepting a root with those authorities. A local policy could require separate issuer sets for operational competence and financial assurance, avoiding one badge that supposedly covers every risk. [PIP-02][p02]

This is **selection support**, not adjudication. An issuer badge does not make a resolver's private evidence assessment objective, a custody backend solvent, or an escrow's signed `core/settle` action equivalent to independently observed payment finality.

## Proposed integration boundary

The smallest useful prototype requires **no Pontmore PIP change**:

1. An application discovers a Pontmore Agent through PIP-00 and validates its capability identifier and referenced resources.
2. It obtains an authenticated, versioned private credential-request channel from the Agent's application/service layer. PIP-00 currently contains only `version` and `capabilities`; it does not define a credential advertisement or generic endpoint. An application must not pretend otherwise.
3. The verifier requests specified badge claims for an exact role, corridor, amount tier, and candidate pubkey. It includes a fresh challenge and intended audience.
4. The Agent/holder presents a badge and, if needed, a holder-signed authorization for the **exact** Pontmore pubkey. That pubkey proves possession against the challenge.
5. The verifier checks issuer authority, claim/schema version, cryptographic proof, delegation constraints, revocation freshness, and local policy.
6. Only then does the verifier select an escrow descriptor and create or accept a PIP-02 root binding exact participant/authority keys and descriptor revision. Ordinary PIP-02 validation remains unchanged.

For an existing proposed root, the request should bind its event ID. For pre-proposal discovery, it can bind a session nonce and subsequently require that the accepted root uses the same pubkeys and role/terms scope. A badge check is never a PIP-02 transition or public evidence event.

### Candidate private request shape — research sketch, not PeerBadge syntax

```json
{
  "protocol": "pontmore-credential-request@0",
  "verifier_pubkey": "<nostr-pubkey>",
  "subject_pubkey": "<candidate-agent-or-authority-pubkey>",
  "role": "swap/agent",
  "claims": ["corridor_partner_verified@1"],
  "scope": {
    "profile": "pontmore/swap@1",
    "fiat_currency": "KES",
    "payment_channel": "mpesa-ke-kes@1",
    "maximum_amount_tier": "tier_2"
  },
  "audience": "<verifier-or-service-id>",
  "challenge": "<fresh-random-value>",
  "expires_at": 1780000000,
  "coordination_root_id": "<optional-existing-root-event-id>"
}
```

The actual request/presentation format must be specified independently. A verifier must reject a presentation for the wrong audience, subject, role, profile, challenge, amount scope, or expiry. It must also reject an authorization that outlives or exceeds the issuer-signed badge claim. If an issuer intentionally makes the badge non-delegable, a subject-key presentation is invalid regardless of the holder's signature.

### When a future PIP-00 extension might be justified

Only after **at least two independent clients** need credential discovery before contacting an Agent should Pontmore consider a _namespaced, versioned capability-profile hint_ for supported credential protocols. Even then it should advertise only a protocol/version and safe retrieval method—not badges, badge digests, issuer endorsements, or a generic reputation score. PIP-00's current rule allows profile-specific discovery facts only where independent clients need them before invocation. A generic `credential_protocols` top-level field would be a new normative change, not something already present. [PIP-00][p00]

Credential handling should not be inserted into PIP-01's escrow descriptor, whose service pointer is intentionally minimal, or into PIP-02's linked action kernel. [PIP-01][p01] [PIP-02][p02]

## Threat model and failure analysis

| Threat or failure                               | Why it matters for Pontmore                                                                                                         | Necessary control or limit                                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Badge rental / many-subject delegation**      | One reputable holder can authorize many unrelated Agent npubs without surrendering its key.                                         | Issuer-signed delegation permissions; subject type, maximum count, audience, role, operations, expiry, depth, no redelegation, and holder revocation. For person-specific claims, make badges non-delegable. |
| **Claim truth and issuer capture**              | A valid badge may be falsely issued or a signer key compromised.                                                                    | Verifier-local issuer policy, issuer-key lifecycle, independent corroboration where stakes warrant it; never equate signature validity with fact validity.                                                   |
| **Duplicate issuance under blinded identities** | Issuer cannot use the unseen holder key alone to enforce one badge per person or entity.                                            | Define an issuance entitlement/uniqueness mechanism outside the blind-signature primitive, or explicitly accept multiplicity. Evaluate privacy trade-offs.                                                   |
| **Linkable presentations**                      | Reuse of one badge lets verifiers correlate the Agent across transactions; a public badge digest links to public root participants. | Private, audience-bound presentation; avoid badge/digest in PIP-00/PIP-02; consider single-use/unlinkable credentials only when actually specified and reviewed.                                             |
| **Claim fingerprinting**                        | A narrow claim can identify its holder despite cryptographic blinding.                                                              | Coarse, standardized claim schemas, issuer anonymity-set measurements, avoid per-holder timestamps/details.                                                                                                  |
| **Revocation blind spot**                       | PeerBadge signer cannot compute a private finished badge's digest until it sees it.                                                 | Short claim lifetime and defined issuer-key retirement; do not promise individual revocation of unseen badges.                                                                                               |
| **Revocation availability / rollback**          | PeerBadge fails closed when lists cannot be fetched; stale or conflicting lists can create false acceptance or broad outage.        | Signed epochs, freshness limits, anti-rollback/equivocation checks, independent mirrors, explicit unavailable state. These are proposed controls, not specified PeerBadge features.                          |
| **Captured presentation replay**                | A verifier or intermediary can reuse a stable badge and delegation in another session.                                              | Challenge-bound proof, exact audience and candidate pubkey, expiry, nonce replay cache, root/session binding.                                                                                                |
| **Operational-key compromise**                  | An attacker controlling the Agent key might present an existing delegated badge or publish otherwise valid actions.                 | Short-lived subject authorization, holder-initiated revocation, key rotation policy, and continued PIP-02 root-bound signer checks. Credential revocation cannot retroactively change an active root.        |
| **Issuer/domain discovery substitution**        | A verifier may load an attacker's signer authority or revocation endpoint.                                                          | Pin issuer identity keys through local trust policy; signed authority chain and safe endpoint fetching.                                                                                                      |
| **Gift Wrap metadata leakage**                  | Encrypted payloads still have recipient-routing and relay/timing metadata; NIP-44 lacks forward secrecy.                            | Minimize routing/timing correlation, use recipient relays with AUTH where appropriate, limit retained sensitive payloads. [NIP-44][nip44] [NIP-59][nip59]                                                    |
| **Credential check becomes economic gate**      | A local trust failure could be misread as a PIP-02 authorization or settlement condition.                                           | Keep credential selection separate from deterministic chain validation; escrow effects still require valid root-bound actions and durable external-effect reconciliation.                                    |

### Revocation and active coordination are different timelines

The verifier should check credential validity **at the decision time** and record its local decision for audit. Later badge revocation may justify pausing future dealings or opening an application-defined dispute, but it does not invalidate an already signed PIP-02 root, change its bound pubkeys, or manufacture `core/refund`. PIP-02's fork/dispute/economic rules remain authoritative for that coordination. [PIP-02][p02]

PeerBadge likewise does not currently define a cryptographically sound way to revoke a _delegation_ independently of the badge. This is particularly important when a Pontmore Agent key is compromised but the organization's credential should survive. [PeerBadge §§5, 7][pb]

## Claim taxonomy: what would actually help?

The first claim schemas should be few, coarse, and grounded in known issuer procedures:

| Candidate claim                 | Appropriate issuer and evidence                                                          | Helps decide                                         | Does **not** prove                       |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------- |
| `operator_training_completed@1` | Training program with attendance/exam records                                            | Basic operational competence                         | Float, honesty, current availability     |
| `corridor_partner_verified@1`   | Counterparty that directly checked local rail integration and identity                   | Whether to initiate a specific corridor conversation | Regulatory license, settlement finality  |
| `settlement_history_tier@1`     | Counterparty with co-signed, immutable interaction receipts or auditable private records | Experience at a coarse size tier                     | Current capacity or future performance   |
| `escrow_operator_reviewed@1`    | Independent technical/security reviewer with dated scope                                 | Whether to further evaluate one operator             | Solvency, current code, correct payout   |
| `resolver_process_reviewed@1`   | Dispute-process auditor with dated procedure scope                                       | Whether the resolver's process merits consideration  | Correctness of any particular resolution |

These are examples, **not** PeerBadge schemas or Pontmore fields. Each requires a versioned definition: issuer eligibility, allowed holder/subject roles, evidence policy, validity period, privacy granularity, revocation expectations, and whether delegation is permitted. A self-issued badge should not satisfy a third-party-attestation requirement.

There is a useful stronger path for settlement-history claims: an issuer and subject can reference an immutable Pontmore coordination root and validated final action, while privately retaining evidence of the external payment. The public chain establishes who made protocol claims and which actions were accepted; it does **not** independently establish that fiat arrived or funds were safe. A claim should say precisely what the issuer observed. [PIP-02][p02] [`pontmore/swap@1`][swap]

## What PeerBadge must specify before adoption

The [whitepaper][pb] is a design proposal, not an interoperable credential specification. For production-risk evaluation, it needs at least:

1. A named, analysed partially blind signature construction with exact algorithms, groups, transcript, encodings, domain separation, rejection rules, and test vectors. “Partially blind signature” alone is not a safe implementation instruction. An established blind-signature standard such as [RFC 9474][rfc9474] is useful as a comparison for specification rigor, but it is **not** automatically PeerBadge-compatible and does not supply PeerBadge's claim-visible construction.
2. A holder proof-of-possession protocol and challenge-bound presentation format.
3. Canonical badge, claim-schema, signer-authority, subject-authorization, and revocation formats with version negotiation.
4. Issuer-signed delegation policy, including a non-delegable mode and independently revocable operational subjects.
5. Issuer identity/signing-key rotation, authority continuity, compromise response, list epochs/freshness, and rollback/equivocation handling.
6. A clear statement of whether and how duplicate issuance is constrained without deanonymizing holders.
7. Transport and retrieval security, plus privacy analysis for rare claims, public publication, colluding verifiers, compromised keys, and timing correlation.
8. Two independent implementations exchanging issuance/presentation/revocation data; adversarial and cross-language vectors; independent cryptographic/security review.

A local illustrative PeerBadge proof of concept, if encountered, must not be treated as normative or audited cryptography. The upstream `obi/peerbadge` repository currently makes no implementation-conformance claim. [PeerBadge README][pb-readme]

## A bounded Pontmore experiment

An application-level experiment can be informative without altering Pontmore:

1. Pick one low-stakes issuer, one coarse claim, one holder, one Pontmore Agent subject key, and one independent verifier.
2. Use a temporary, explicitly non-production credential format to test **workflow**, not cryptographic security: issuance, private challenge, presentation, local policy, delegation rejection, and revocation outage.
3. Discover `pontmore/swap@1` through the current PIP-00 capability index; validate a current PIP-01 descriptor and its schema; check the credential before creating/accepting a PIP-02 root.
4. Exchange the credential only privately; confirm no badge, digest, issuer–holder edge, or private payment payload enters public Agent, descriptor, root, or action content.
5. Demonstrate that a revoked/expired badge prevents a _new local acceptance_ but does not mutate existing chain history.
6. Run adversarial cases: wrong subject, wrong role, wrong audience, reused nonce, unrelated root, delegated badge when issuer disallowed delegation, one holder authorizing many Agents, issuer-key compromise, revocation-list outage/rollback, and badge fingerprinting.
7. Publish negative results and the minimum interoperability requirements before proposing any Pontmore text.

Success would mean the credential check improves **counterparty selection** while leaving Pontmore event validity and economic safety deterministic and unchanged. It would not demonstrate that PeerBadge cryptography is safe.

## Decision

**Benefit:** PeerBadge's local, contextual, portable claims could give Pontmore applications a better way to assess Agents, escrows, and resolvers without creating a central reputation authority or putting commercial trust relationships on public relays.

**Constraint:** Keep it optional, private, and outside the three-PIP core initially. Bind any delegated credential to the exact Pontmore pubkey, intended role, audience, operation, expiry, and root/session. Treat badges as issuer assertions, not proof of external payment facts.

**Adoption gate:** Do not make PeerBadge mandatory—or a security gate for real-value swaps—until its construction, delegation, revocation, wire format, interoperability, and security have been specified and independently tested.

## Primary sources

- [PeerBadge whitepaper at reviewed commit][pb]
- [PeerBadge README at reviewed commit][pb-readme]
- [Pontmore protocol README at reviewed commit][pont-readme]
- [Pontmore PIP-00 at reviewed commit][p00]
- [Pontmore PIP-01 at reviewed commit][p01]
- [Pontmore PIP-02 at reviewed commit][p02]
- [Pontmore swap profile at reviewed commit][swap]
- [NIP-44: encrypted payloads][nip44]
- [NIP-59: Gift Wrap][nip59]
- [RFC 9474: RSA Blind Signatures, comparison for specification rigor][rfc9474]

[pb]: https://github.com/obi/peerbadge/blob/f458f4624adab8ee68f13eca715d4097ff24fb9b/WHITEPAPER.md
[pb-readme]: https://github.com/obi/peerbadge/blob/f458f4624adab8ee68f13eca715d4097ff24fb9b/README.md
[pont-readme]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/README.md
[p00]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/PIP-00-agent-definition.md
[p01]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/PIP-01-escrow-descriptor.md
[p02]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/PIP-02-coordination-event-chains.md
[swap]: https://github.com/pontmore/protocol/blob/d9a1eb3e8a24e2101f5a4024df1ce85a8d934f75/profiles/swap-v1.md
[nip44]: https://github.com/nostr-protocol/nips/blob/master/44.md
[nip59]: https://github.com/nostr-protocol/nips/blob/master/59.md
[rfc9474]: https://www.rfc-editor.org/rfc/rfc9474.html
