# Godspeed Coin Phase 1, Build 46

This package extends the full Godspeed GDKP HTML from Build 45. It has not been deployed. Install and validate the Firebase backend before uploading `index.html`; the new Discord sign-in route depends on that backend.

## Included

- `index.html`: entire site, with Account GS balance, tickets, deposits, withdrawals, ledger, and payable wins. Settlement includes treasury, pending receipts, unmatched deposits, mode, named compensation, coin collection, payout credits and cut adjustments.
- `functions/core.js`: atomic accounting engine. Six-decimal USDC units; cents for distributed cuts. Ledger entries are the source of truth; `gsBalance` is a derived cache.
- `functions/index.js`: Firebase callable API, Discord OAuth bridge, scheduled USDC scan.
- `functions/usdcWatch.js`: Ethereum USDC receipt verification and confirmed Transfer-log scan. No wallet signing or fund sending is implemented.
- `database.rules.json`: deny-by-default integration rules for the supplied HTML. Compare with your deployed rules and test before production deployment. These rules require verified Firebase sign-in.
- `tests/core.test.js`: accounting tests, including an in-memory end-to-end deposit, auction collection, cut credit and withdrawal workflow.
- `client.js`, `build.cjs`, `rules.cjs`: editable extension source and build helpers.

## Decisions

1. Use house float first, then mint only the uncovered deposit remainder. The RL may explicitly choose mint against a verified, unused receipt. There is no unbacked mint command.
2. Depositors see the house receiving address. Only the RL can change it or access treasury queues.
3. Ethereum USDC has no text memo in its Transfer event. Deposit requests use a unique six-decimal amount as the tag. The displayed amount is credited in full. A short reference code is also shown for people.
4. A deposit sent from an exchange is supported through its exact amount and receipt. No assumption is made that the sending address uniquely identifies a person. Ambiguous or unmatched events remain in the RL queue.
5. The taper is a cap on named compensation: `min(named total, 20% × first 2,000 GS + 15% × remainder)`. The UI publishes the line percentages and cap.
6. GS purchases move funds into a run escrow account. Cuts redistribute escrow. Bonuses use funded house GS and affect only the selected raider; distribution balance may be negative while all redeemable GS remain backed.
7. Gold pay-in requires enough funded house GS to back that contribution to the pot. Gold payouts consume escrow lots at their stamped rates. The RL reviews a gold quote and confirms delivery. A changed quote prevents recording the payout against stale rates.
8. House float sales leave the reserve unchanged. The new USDC is the house's float-sale proceeds. Keep the displayed reserve available for outstanding GS and pending withdrawals. Network gas is paid separately by the house; withdrawals are 1:1.

## Paths

| Path | Contents / writer |
| --- | --- |
| `accounts/{discordId}/gsBalance` | Cached GS total; server only |
| `accounts/{discordId}/usdReserved` | Reserve on house account; server only |
| `accounts/{discordId}/ledger/{operation}` | `unit: GS`, type, `gsDelta`, timestamps, references; server only |
| `accounts/{discordId}/tickets/{ticket}` | `id, usd, gs, remainingUsd, rateUsdPer1000, runId, createdAt, expiresAt, source`; server only |
| `accounts/_run_{runId}` | Internal escrow account using the same ledger and ticket schema |
| `gs/config` | House ID/address, enable flag, Ethereum network, confirmation count |
| `gs/deposits/{id}` | Owner, exact tagged amount, stamped rate, run, status, matched event |
| `gs/withdrawals/{id}` | Reserved amount, destination, original lots, state, payment receipt |
| `gs/chainEvents/{chain_hash_log}` | Permanent deposit replay protection |
| `gs/withdrawEvents/{chain_hash_log}` | Permanent outgoing receipt replay protection |
| `gs/ops/{requestId}` | Idempotent operation result and input |
| `gs/unmatched/{event}` | Transfers awaiting assignment |
| `gs/watchBlock` | Last scanned confirmed block |
| `gs/audit/{operation}` and `audit/{runId}/{operation}` | Server audit records |
| `runs/{runId}/settlement/settlementMode` | `coin` or `mixed`; absence means legacy behavior |
| `runs/{runId}/settlement/gsPayments/{auctionId}` | Payable collection/reversal records |
| `runs/{runId}/settlement/gsLocked` | Locked fee math and original cut snapshot |
| `runs/{runId}/settlement/gsAdjustments/{operation}` | Later funded adjustments |
| `runs/{runId}/settlement/raiders/{key}` | Existing fields plus `gsOwner, gsCut, gsCredited, gsPayoutMethod` |

Old gold ledger entries are excluded from GS balance calculations. GS entries do not include the legacy `amount` field, preventing them from being summed as old gold credits. No existing balances or archives are automatically converted.

## Deployment sequence

Use a staging Firebase project first. Production deployment and real transfers have not been performed by this package.

1. Back up RTDB and current rules. Keep the existing images, manifest and other static assets beside the HTML.
2. Use Node 22 and Firebase CLI. Enable Firebase Authentication, the required Cloud Functions services and billing for scheduled functions. In Firebase Auth, authorize your site domain.
3. In your Discord application's OAuth configuration, add `https://us-central1-YOUR_PROJECT.cloudfunctions.net/gsDiscordAuth` as a redirect URI.
4. From this directory, choose your Firebase project. Set the secrets through Firebase's secret manager:

   ```sh
   firebase use YOUR_PROJECT
   firebase functions:secrets:set GS_ETHEREUM_RPC
   firebase functions:secrets:set GS_DISCORD_SECRET
   npm ci --prefix functions
   npm test --prefix functions
   ```

5. Set function parameters in `functions/.env.YOUR_PROJECT` (no secrets in this file):

   ```text
   GS_DISCORD_CLIENT_ID=YOUR_DISCORD_APPLICATION_ID
   GS_SITE_URL=https://godspeedgdkp.bid/
   GS_RL_DISCORD_ID=670939357686923265
   ```

6. Review `database.rules.json` against all paths used by the existing deployment. Remove any ancestor `.write: true` rule; a deeper deny cannot override a parent grant. Verify that direct writes to GS ledger entries, tickets, cached balances, reserve, operations and settlement payment/credit records fail for both ordinary users and RL browser clients. The Admin SDK is the only GS writer.
7. Deploy the backend and reviewed rules before changing the website:

   ```sh
   firebase deploy --only functions,database
   ```

8. If using a different Firebase project, change the public `firebaseConfig` in `index.html`. All RPC credentials and Discord secrets remain server-side. The function endpoint is derived from that project ID.
9. Upload `index.html` to the existing static host. Everyone must sign in through the new verified Discord flow. Existing browser-only Discord sessions cannot authorize GS operations.
10. As RL, open Account or Settlement and verify Discord. Open Settlement → Godspeed Coin → Wallet Settings to configure the house receiving address. Deposits stay disabled until configured. Ethereum mainnet USDC is the only watcher implemented here.
11. Start a new run. New runs default to coin; Apply & Lock sets its ticket rate, fee lines, cap and withdrawal-window fee. Modes can only change on an empty, non-archived run. A populated legacy run remains legacy.

## Operational workflow

Deposit: Account → Deposit → send the displayed exact Ethereum USDC amount. The scanner credits after at least 12 confirmations. Fallback: submit hash, then RL Mark Received supplies hash and Transfer log index. The same receipt verification runs in both paths.

Unmatched: RL Match Deposit accepts `DiscordID hash logIndex`. Append `mint` to bypass float; the amount still comes only from the verified USDC log. A consumed event can never credit again.

Bidding: coin bids use server-verified Discord identity and an atomic minimum-bid check. GS is debited when the sold item is collected, not for a preview or losing bid. Winners can pay in Account; the RL can collect in Settlement. Unfunded winners stay payable.

Payouts: import attendance and set mutators using existing controls. Collect all sold items, then Start Payouts. The server locks the snapshot and credits the named house compensation. Credit GS per raider moves that fixed cut into their account. The RL's own wins use the same debit path. A mixed-run raider can choose gold; the RL records delivery after checking the stamped-lot quote.

Withdrawals: Account → Withdraw reserves the amount immediately. The RL sends USDC outside the site, then records hash and log index. The server verifies source, recipient, amount, token, network and confirmations. Cancel returns the exact reserved lots. The site never holds a private wallet key.

Expiry: the 48-hour window begins when a ticket's originating run locks. An RL may apply the published 0%, 5% or 10% haircut once to unused expired lots. Pending withdrawals are excluded. Transfers preserve original ticket metadata, including deadlines; review expired float before redistribution.

Archive: GS collections, credits and adjustments use the explicit selected run key. Deposits and new bids target a current run. Funded GS runs cannot be deleted; archive them to retain references. An item collection can be reversed before cuts lock, then retracted/restarted. Locked or distributed transactions require correction, not deletion.

## Validation and remaining integration work

Passed: eleven accounting tests covering reserve invariants, FIFO stamps, partial float, mint override, duplicate receipts, double collection, insufficient balances, bans, refund, withdrawal reservation/cancellation, archive isolation, funded bonus, gold-rate protection, haircut once, and bid identity/minimum.

Passed: complete HTML JavaScript syntax check, JSON rules parse, server module load and dependency installation.

Not performed: authenticated desktop/mobile browser flow, Firebase rule-emulator integration tests, Discord callback in your project, live watcher run, real deposits/withdrawals, production deployment. Treat this as a deployment candidate requiring those checks, not a production-verified payment service.

Scope limits: the automatic watcher handles Ethereum only; outgoing transfers are manual. Existing gold archive UI remains in the full HTML. Coin bids use whole-GS auction inputs inherited from the auction parser; deposits/withdrawals support six decimals. Post-credit negative cut adjustments are rejected if they would reduce the cut below already-credited GS; a voluntary return/reconciliation is needed. Phase 1 does not include arbitrary member-to-member transfers. Run settings lock on the first item to avoid reinterpretation of bids. The root RTDB transaction is intentional for atomic accounts/escrow/run writes at this scale; as history grows, migrate the GS ledger to a smaller transactional store before increasing usage.

## Required staging checks

Use two Discord accounts plus RL. Confirm deposit → won-item debit → fee credit → raider credit → reserved withdrawal → payment receipt. Repeat each confirmation and ensure totals do not change twice. Attempt a browser write to balance and verify rejection. Test banned accounts, two purchases spending the same balance, and a competing bid. Archive the run, credit its remaining cut, and verify the current run is unchanged. Check the original auction queue, presence, drag ordering, dispute image submission, saved character names, archive Display/Resume/Copy/Delete on legacy runs, and settlement setup unlock at desktop and portrait widths before production use.

References: Firebase callable functions https://firebase.google.com/docs/functions/callable and Circle's USDC address list https://developers.circle.com/stablecoins/usdc-contract-addresses .
