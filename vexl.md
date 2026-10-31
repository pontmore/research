# Vexl: Trust Through the Social Graph

_Research snapshot: 19 October 2026. Sources: `vexl-it/vexl` at `2b37c4e` (16 October 2026) and the vexl.it website (fetched 19 October 2026). This is analysis, not an adopted Pontmore specification._

Related notes: [Bisq][bisq] · [Mostro][mostro] · [Escrow policies and exchange patterns][escrow-patterns]

## Executive finding

Vexl answers the trust question very differently from Bisq and Mostro. **It has no escrow, no deposits, no arbitration and no ratings.** It doesn't touch money at all. Trust comes from **who can see an offer**:
- an offer reaches only people in the poster's phone contacts (first degree), or their contacts' contacts (second degree), or members of invite-only **clubs**;
- each viewer sees **how many friends they have in common** with the poster, including "verified" common friends who have both parties in their own contacts.

Trades then happen off-app (usually in person and in cash), with gradual, mutually agreed reveal of identity and contact details, and a structured **trade checklist** in the encrypted chat.

The design is excellent at **choosing counterparties, privacy between users, and UX for in-person trades**. It provides **nothing once a counterparty misbehaves**, apart from blocking and reporting. Its privacy also rests on a **central backend** that stores the hashed social graph and encrypted offers and messages, and on verifying users by **phone number**.

For Pontmore, Vexl is the reference for:
1. **Using the social graph to decide who sees an offer and to signal trust** before a trade starts.
2. **Community structures** (clubs) that match how agents' customers already organize (savings groups, community hubs, merchant circles).
3. **Gradual reveal, in-person UX and the trade checklist**: cash trades with agents are a core Pontmore case, and Pontmore has no structured way to agree terms in chat.

## 1. Architecture

Vexl is a pnpm/Turbo monorepo. The Expo mobile app talks to a set of **Vexl-operated backend services**:

| Service | Role |
|---|---|
| `user-service` | Phone verification by SMS (Twilio or Prelude), login challenge, authentication |
| `contact-service` | Stores the hashed contact graph; answers first- and second-degree and common-friend queries; manages **clubs** |
| `offer-service` | Stores encrypted offers and per-recipient private parts; "notes"; reports |
| `chat-service` | Inbox-based encrypted messaging; message expiry between configured minimum and maximum days |
| `notification-service` | Push notifications (with encrypted FCM payloads) |
| `location-service`, `btc-exchange-rate-service`, `content-service`, `feedback-service`, `metrics-service` | Supporting services |
| `backoffice-app`, `dashboard-app`, `web-app` | Operator tooling |

**Operator.** The Vexl Foundation and Vexl s.r.o. (Prague). The app is free, and the site says Vexl "never handles your money or tracks your purchases". The code is open source (GPL-3.0), and the site cites an independent security audit.

## 2. The social graph and its privacy

### 2.1 Hashing contacts

1. The client normalizes each contact to E.164 and computes `HMAC(hmacPassword, number)`. `hmacPassword` is an **app-wide constant** shipped in the app (`apps/mobile/src/utils/environment.ts`).
2. The server re-hashes with a **secret salt**: `PBKDF2(clientHash, salt, 100 iterations)`, producing a `ServerHash:` (`contact-service/src/utils/serverHashContact.ts`).
3. Edges `(hashFrom → hashTo)` are stored server-side. Clients only ever receive **server-to-client hashes** (`PBKDF2(serverHash, "forClient:"+salt, 1)`). A client can match those only against numbers it already has.

**What this protects, and what it doesn't.** Other users can't learn anyone's contact list; they only see counts and hashes of common friends they can already match. **The server can**: it holds the salt, phone numbers have little entropy, and both hashing steps are cheap, so the operator can enumerate numbers and rebuild the full graph. The privacy promise therefore depends on trusting the operator to protect its salt and database. This is our reading of the code, not a claim Vexl makes.

### 2.2 Connection levels and trust signals

- **First degree:** people whose numbers you imported and who use Vexl.
- **Second degree:** their imported contacts who use Vexl.
- **Common friends:** contacts the viewer and the poster share.
- **Verified friends:** common friends who have *both* parties in their own contacts, so the friend knows both sides (`createFindCommonFriendsByOwnerHashAndPublicKeysPaginated.ts`).
- **Clubs:** invite-only communities with admins and moderators, invite links, a **member limit**, a **validity date**, a **report limit**, deactivation, and their own key pairs. Offers can be shared with a club as well as with personal connections.

### 2.3 Encrypted offers sent to a chosen audience

`createNewOfferForMyContacts`:
1. Generate a **symmetric key** and encrypt the offer's public part with it.
2. Fetch the first-degree, second-degree and club recipients, according to the poster's intended connection level (`FIRST` or `ALL`) and chosen clubs.
3. For each recipient, build a **private part**: the symmetric key, the recipient's friend level (first, second, club), and its common and verified friends. Encrypt it to that recipient's public key.
4. Upload the encrypted public part and every private part. The server delivers each private part only to its recipient.
5. Update private parts on a schedule as the poster's network changes (`planPrivatePartsUpdate`).

**What an offer contains:** buy or sell; amount range; fee or premium; `ONLINE` or `IN_PERSON` with locations; payment methods (`CASH`, `REVOLUT`, `BANK`); `LIGHTNING` or `ON_CHAIN`; spoken languages. A `listingType` (`BITCOIN`, `PRODUCT`, `OTHER`) shows Vexl has grown into a general marketplace.

## 3. Chat, reveal and trade checklist

**Messaging needs approval.** A viewer sends `REQUEST_MESSAGING` about an offer. The poster approves or declines before any chat opens. Either side can block or delete.

**Gradual, mutual reveal:**
- `REQUEST_REVEAL` / `APPROVE_REVEAL`: share real identity (name, photo).
- `REQUEST_CONTACT_REVEAL` / `APPROVE_CONTACT_REVEAL`: share a phone number.

Each trade starts with a **fresh anonymous profile**, so different counterparties see different personas.

**Trade checklist** (`tradeChecklist.ts`). Structured items each side proposes and accepts:

| Item | Content |
|---|---|
| Amount | Amount, BTC or sats, price type (`live`, `custom`, `frozen`, `your`) |
| Network | Lightning or on-chain, and address details |
| Date and time | Offered options, then the one picked |
| Meeting location | Place for in-person trades |
| Identity reveal / contact reveal | Status of each reveal |

The checklist turns an informal chat into an **agreement both sides accept**, without escrow.

**Retention.** Messages expire on the server within configured limits, and a local-only reminder prompts users to clean up inactive chats.

## 4. Strengths

1. **Trust before the trade.** Counterparties come from your own network, and common or verified friends give concrete social proof right where you decide.
2. **Spam and scam resistance from the graph itself.** Offers don't reach strangers, so a scammer needs phone contacts within two hops of each victim.
3. **Privacy between users.** Anonymous profiles per trade, reveal only by mutual consent, end-to-end encrypted chat, offers encrypted to each recipient.
4. **Clubs extend trust beyond personal contacts** in a controlled way: invites, member limits, expiry, moderation, reports.
5. **UX built for in-person cash trades:** meeting location, time options, the checklist and price freezing.
6. **Very simple for users.** No wallet inside the app, no escrow steps, no fees.
7. **General marketplace.** The same mechanism carries products and services.

## 5. Weaknesses and trade-offs

1. **No recourse.** No escrow, deposit, arbitration or ratings. A cheated user can only block and report. Losses rely on social consequences.
2. **Central operator.** All services are run by Vexl. The server holds the hashed social graph, which it can reverse (§2.1), plus encrypted offers and messages and push tokens. It can be pressured, fail or be censored.
3. **Phone-number identity.** SMS verification ties accounts to telecom identity, which conflicts with Vexl's no-KYC positioning where SIM registration is mandatory (as in Kenya).
4. **Reach is limited by the graph.** Liquidity depends on how dense your contacts are, which makes it hard to serve strangers or new arrivals.
5. **Nothing records what happened.** Trades leave no shared, verifiable trace, so reputation can't build up or travel.

## 6. Compared with Pontmore and the others

| Dimension | Vexl | Mostro | Bisq Easy | Pontmore |
|---|---|---|---|---|
| Discovery | Offers encrypted to the social graph and clubs | Public NIP-69 order book | Public offers on a Tor P2P network | Public NIP-69 offers by agents |
| Counterparty trust | Common and verified friends | Ratings, portable attestations | Costly reputation (BSQ) | None yet |
| Escrow | None | Operator-held hold invoice | None | Peer-to-peer hold invoice |
| Disputes | None (block, report) | Solvers | Mediators, moderators | Agent self-resolves (to be fixed) |
| Identity | Phone number + fresh profile per trade | Nostr identity + trade keys | Multiple Bisq 2 identities | Long-lived Nostr keys |
| Infrastructure | Central Vexl servers | Instance operator | Tor P2P | Nostr relays |
| In-person / cash | First-class | Payment-method string | Payment method | `cash` channel in the registry |

## 7. Lessons for Pontmore

### For the Pontmore protocol

1. **Private offers with a chosen audience.** Alongside public NIP-69 offers, Pontmore could support offers encrypted to a set of keys: an agent's known customers, a community's members. Vexl's pattern carries over directly: a symmetric key, plus a per-recipient wrapped key carrying context. On Nostr this could be one gift wrap per recipient, or a group key for a community. Agents get discretion, and customers get offers from people they know.
2. **Show social proof at the moment of decision.** "N common contacts, M who know you both" is a strong, cheap signal. With Nostr follow lists and mutual follows, Pontmore clients can compute something similar **without a central server**, which avoids Vexl's main weakness. It complements costly reputation (Bisq) and portable ratings (Mostro); it doesn't replace them.
3. **A trade checklist inside the coordination.** Structured, accepted items (amount, price type including *frozen*, network, time, place, reveal status) are a natural private payload for a Pontmore coordination. Committing the agreed checklist bytes (`commitments.private_terms`) makes the agreement **usable as evidence** for a resolver, which is exactly what Vexl lacks.
4. **Gradual reveal as protocol messages.** Messages to request, approve or decline identity and contact reveal, with fresh per-trade personas, fit Mostro-style per-trade keys and let cash trades share only what is needed.
5. **Communities as a first-class scope.** Vexl's clubs (invites, member limits, expiry, report thresholds, moderators) model communities well. A Pontmore "community" capability could scope offers, resolvers and reputation to a group, for example a resolver panel drawn from the community's moderators.

### For Pontmore agents and apps

1. **Communities are clubs.** Savings groups, community hubs and merchant networks already are trusted groups. Club-scoped offers and agent directories, with invites, caps and moderation, let a community's members find known local agents.
2. **Let customers see the agent's ties to them.** Showing a customer that an agent is known to people they know raises conversion and cuts fraud, without KYC.
3. **In-person cash UX.** Meeting location, time slots, a frozen price and a checklist suit agents doing cash in and out. Agent apps can adopt the checklist pattern and record it as the agreed terms for disputes.
4. **Don't copy the central social graph.** Vexl shows the cost: phone-number hashes can be reversed by whoever holds the server salt. If an app uses contacts, it should match them on the device or with privacy-preserving set intersection, and be open about what any server can learn.
5. **The social graph is not enough on its own.** Vexl shows that social trust removes many bad counterparties but offers no recourse. Escrow and disputes remain necessary; social signals decide *who to trade with*, and escrow handles *what happens if it goes wrong*.

## 8. Open questions

1. Has the Vexl security audit looked at the contact-hashing threat model from the server's side? The audit report wasn't reviewed here.
2. Could Nostr follow graphs (NIP-02) give enough density in Pontmore's markets (Kenya mobile money) to stand in for phone contacts? If not, how do privacy-preserving contact matching options compare?
3. What is the right Nostr pattern for community-scoped offers: NIP-29 relay groups, per-member gift wraps, or a shared community key?

## Sources

- Code: [vexl-it/vexl][vexl]:
  - `apps/contact-service` (`utils/serverHashContact.ts`, `routes/contacts/importContacts.ts`, `db/ContactDbService/queries/createFindCommonFriendsByOwnerHashAndPublicKeysPaginated.ts`, `routes/clubs/*`)
  - `apps/offer-service/src/routes`
  - `apps/chat-service`
  - `apps/user-service/src/configs.ts`
  - `apps/mobile/src/state/contacts/utils.ts`, `apps/mobile/src/utils/environment.ts`
  - `packages/resources-utils/src/offers` (`createNewOfferForMyContacts.ts`, `utils/fetchContactsForOffer.ts`, `utils/constructPrivatePayloads.ts`)
  - `packages/domain/src/general` (`offers.ts`, `messaging.ts`, `tradeChecklist.ts`, `clubs.ts`)
- Website: [vexl.it][vexl-site]

[bisq]: ./bisq.md
[mostro]: ./mostro.md
[escrow-patterns]: ./escrow-policies-and-exchange-patterns.md
[vexl]: https://github.com/vexl-it/vexl
[vexl-site]: https://vexl.it
