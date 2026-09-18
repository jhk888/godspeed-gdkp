# Hybrid transition status

## Preserved code
The current code is retained at commit 996662eb303ded4fb210114ab256a030eb0401e4 and branch archive/before-hybrid-996662e.
preserved/pre-fork/index.html is a reference copy of the supplied pre-fork HTML with the embedded raid-leader credential redacted. It is not a production entry point.

## Live data
No database export has been taken. No runs, claims, balances, payment records, or permissions have been changed by this branch.
Do not restore an old database snapshot over ongoing payouts.
Before any live switch, obtain an authenticated export, test a copy in isolation, and preserve all run IDs, raider keys, owners, amounts, payout methods, timestamps, attachments, payment events, and audit records.

## Architecture constraint
Current database rules prohibit direct member bids and direct claim submissions for coin/mixed runs. The pre-fork HTML cannot serve those active runs on its own.
Keep the current backend and database for existing runs. Build the hybrid UI against that schema, with local form state and stable rendering. Never rename accented raider keys to evade validation.
functions/index.js includes a tested validator correction for existing encoded Unicode keys. This remains undeployed and requires authorized Firebase deployment.

## Deployment
The existing GitHub-to-Cloudflare pipeline can publish frontend changes. This session has no Firebase deployment or database-backup access.
A browser-based one-time setup of authenticated automated Firebase deployment would remove the need for PowerShell commands. No credentials should be committed or pasted into repository files.
Do not switch the production entry point until backup and active-payout compatibility are verified.
