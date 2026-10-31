# Can Bitcoin Escrow Work Without a Trusted Middleman?

*Peer-to-peer Bitcoin and mobile-money trades need more than an agreement. They need a way for the money to follow that agreement when a dispute arises.*

Imagine two people arranging a Bitcoin trade over chat. One will send money through a bank or mobile-money service; the other will send Bitcoin over Lightning. They agree on the amount and payment method, but what happens if one says the payment was made and the other says it was not?

A signed message can show what each person claimed. It cannot prove that a mobile-money transfer arrived. And a Bitcoin escrow can hold funds, but the way it releases them may give one side more power than the other.

That is the escrow problem Pontmore is exploring.

## A lock does not automatically make a fair escrow

Pontmore is an open protocol for discovering agents and coordinating economic activity through signed, verifiable event histories. Its rules can establish who agreed to what and who is authorized to make a protocol decision. The coordination history alone cannot make a wallet or payment channel carry out that decision.

Consider a Lightning hold-invoice trade. The Bitcoin recipient creates an invoice; the Bitcoin provider pays it, locking the sats while the fiat transfer happens. The provider knows the payment secret, called a *preimage*. If the provider receives the fiat but withholds that secret, the recipient may be unable to claim the Bitcoin. When the invoice expires, the sats can return to the provider. A resolver’s signed ruling does not, by itself, change what the Lightning invoice allows.

This risk is not unique to Africa, but the payment leg may involve familiar rails such as M-Pesa, MTM MoMo or a local bank transfer. Those payments happen outside Bitcoin. A wallet can ask a person to show evidence, yet someone still has to decide what that evidence means.

There are two separate goals here:

- **No third-party custodian:** no platform or operator can unilaterally spend the escrowed funds.
- **No third-party adjudicator:** no outside person or service decides which trader is right.

A design can meet the first goal and still rely on the second. Removing both is harder because the fiat payment is not a fact the Bitcoin network can observe.

## What existing peer-to-peer exchanges do

Existing projects show several ways to make the trade safer, each with a trust trade-off.

[Bisq](https://docs.bisq.network/trading-rules) uses a 2-of-2 multisignature escrow, so neither trader gives a third party a key to the trade funds. It also has mediation and arbitration processes, plus a time-locked fallback. The funds are not under an arbitrator’s unilateral control, but dispute handling still involves people and the Bisq DAO.

[Hodl Hodl](https://hodlhodl.com/help) uses a 2-of-3 Bitcoin multisignature escrow. The buyer and seller hold keys, and the platform holds the third. This gives the traders a path to cooperate while preserving a recovery path that trusts the platform as one of the signers.

[Mostro](https://github.com/MostroP2P/mostro) coordinates Lightning hold-invoice trades and operator-run dispute resolution. It demonstrates a practical Lightning approach, while relying on the operator to manage settlement and disputes.

These are useful designs to study. They do not provide the same guarantees, and none should be described as eliminating every trusted role.

## Could cryptography give a resolver power without custody?

Pontmore’s research draft on [resolver-recoverable preimages](https://github.com/pontmore/research/blob/main/resolver-recoverable-preimage.md) explores one option. Before a trade, the Bitcoin provider commits to several possible payment hashes. The recipient randomly chooses one and checks that the provider correctly opened the others. If a dispute occurs, a bound resolver can use its secret to recover a share of the selected preimage and privately help the recipient settle the invoice.

The resolver does not hold the funds. But the resolver still decides when to release the information, so this is **non-custodial arbitration**, not a trade with no third-party adjudicator. The draft also identifies a selective-abort risk: a dishonest provider can abandon a round after seeing the recipient’s choice and try again. RRP is research, not an adopted Pontmore standard or a production-ready client feature.

## The Clink experiment

[Clink](https://github.com/pontmore/clink) is an experimental wallet with Pontmore peer-to-peer swaps built in. You can [find Clink on Zapstore](https://zapstore.dev/apps/com.dev.clink.me), download it, and try the flow with a small amount. Clink moves real money, and both the wallet and its Pontmore swap experience are experimental. Treat it as a test, use only an amount you can afford to lose, and do not assume a dispute or timeout will protect you as it would in a mature escrow system.

Testing the app is also a chance to examine the design for yourself. Who can settle the Lightning lock? Who can recover the Bitcoin if the other person disappears? What does a resolver's decision actually make happen? Please independently identify the escrow gap and think through possible fixes, including designs that avoid both a custodian and an adjudicator. Share your analysis, attacks, wallet experiments, or proposal in the [Pontmore discussion](https://github.com/pontmore/protocol/discussions/29).

## The open challenge

Can two people exchange Bitcoin for off-chain fiat so that neither can take both sides of the trade, no custodian controls the funds, and no outside party decides a dispute? The design must also handle a silent or offline peer, give the Bitcoin lock enough time for recovery, and let both traders verify the rules before fiat is sent.

If those goals cannot all be met, what is the smallest necessary trade-off? Is it a resolver, a collateral bond, a threshold of independent signers, a payment attestation, or a different escrow mechanism? Which parts can be proved cryptographically, and which still depend on evidence or human judgment?

Pontmore has opened a [public research discussion](https://github.com/pontmore/protocol/discussions/29) for protocol designs, wallet experiments, threat models, test vectors, proofs, and even impossibility results. The related [escrow policy research](https://github.com/pontmore/research/blob/main/escrow-policies-and-exchange-patterns.md) compares mechanisms and makes their trust assumptions explicit.

A useful answer should say not only how funds are locked, but who can make each outcome happen, what happens when someone disappears, and what evidence proves the funds actually moved. That is the difference between recording an agreement and building an escrow that can honor it.
