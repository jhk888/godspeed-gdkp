# Website publishing

Source: app/source/base.html and app/client.js.
Build: node app/build.cjs
Published assets: app/public
Worker: godspeed-gdkp
Domain: godspeedgdkp.bid

## One-time connection
1. Upload the contents of github-upload to the root of jhk888/godspeed-gdkp on main, replacing matching files. Keep the app folder intact. Do not upload the ZIP itself.
2. In Cloudflare, Workers & Pages > godspeed-gdkp > Settings > Builds > Connect, choose that repository and main.
3. Root directory: repository root. Build command: node app/build.cjs
4. Deploy command: npx wrangler@4 deploy --keep-vars
5. Save and deploy. Check the website header says Build 48 and verify the queue selector.

Cloudflare documentation: https://developers.cloudflare.com/workers/ci-cd/builds/

## Future updates
Commit reviewed website changes to main. Cloudflare builds and publishes them. Check deployment success before refreshing the website.
Review changes on a branch before merging to main. Preview builds still use production Firebase if opened; use a separate test configuration for auction/payment testing.
For a website rollback, use the prior deployment in Cloudflare and revert the Git commit so the next build retains the rollback.

## Backend
Website builds do not deploy Firebase functions or database rules. They do not restore database backups or import test data.
The function source records 512MiB memory and concurrency 8 for gsCommand. Keep these settings in future Firebase deployments.
Public Firebase and Discord client parameters are not credentials. Keep GS_DISCORD_SECRET in Firebase Secret Manager. No secret value or database backup is included here.

## Validation
Queue conversion checks cover Gold, GC and USD, fractional increments, legacy gold storage, preference retention and invalid values. Generated browser module passes JavaScript syntax checks. An authenticated browser and live deployment have not been tested for this update.
