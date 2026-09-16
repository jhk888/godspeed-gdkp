'use strict';
const crypto = require('node:crypto');
const PROJECT = 'godspeed-gdkp';
const CALLBACK = 'https://us-central1-godspeed-gdkp.cloudfunctions.net/gsDiscordAuth';
const CLIENT_ID = '1509552169722974318';
function createHandler({secret, fetchImpl = fetch, database, auth, site, leader, log = entry => console.error(JSON.stringify(entry))}) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    if (req.method !== 'GET') return res.status(405).send('Use GET.');
    let stage = 'authorization';
    let upstreamStatus;
    try {
      if (req.query.error) throw new Error('Authorization cancelled');
      if (!req.query.code) {
        const state = crypto.randomBytes(32).toString('hex');
        res.set('Set-Cookie', `gs_oauth=${state}; Max-Age=300; HttpOnly; Secure; SameSite=Lax; Path=/`);
        const url = new URL('https://discord.com/oauth2/authorize');
        url.search = new URLSearchParams({client_id: CLIENT_ID, redirect_uri: CALLBACK, response_type: 'code', scope: 'identify', state}).toString();
        return res.redirect(url.toString());
      }
      stage = 'state-cookie';
      const cookie = String(req.headers.cookie || '').match(/(?:^|;\s*)gs_oauth=([a-f0-9]{64})(?:;|$)/)?.[1];
      const state = req.query.state;
      if (typeof req.query.code !== 'string' || typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state) || !cookie || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) throw new Error('Invalid state');
      res.set('Set-Cookie', 'gs_oauth=; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Path=/');
      stage = 'discord-token';
      const response = await fetchImpl('https://discord.com/api/oauth2/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({client_id: CLIENT_ID, client_secret: secret(), grant_type: 'authorization_code', code: req.query.code, redirect_uri: CALLBACK}), signal: AbortSignal.timeout(10000)});
      upstreamStatus = response.status;
      if (!response.ok) throw new Error('Token exchange failed');
      const token = await response.json();
      if (typeof token.access_token !== 'string') throw new Error('Missing token');
      stage = 'discord-profile';
      upstreamStatus = undefined;
      const me = await fetchImpl('https://discord.com/api/users/@me', {headers: {Authorization: `Bearer ${token.access_token}`}, signal: AbortSignal.timeout(10000)});
      upstreamStatus = me.status;
      if (!me.ok) throw new Error('Identity verification failed');
      const user = await me.json();
      if (typeof user.id !== 'string' || !/^\d{15,22}$/.test(user.id)) throw new Error('Invalid identity');
      stage = 'database-ban-check';
      upstreamStatus = undefined;
      if ((await database.ref('bans/discord_' + user.id).get()).exists()) throw new Error('Banned account');
      // Verify Firebase signing permissions without exposing or persisting a login token.
      // No leader claim is granted during this diagnostic stage.
      stage = 'firebase-token-signing';
      const claims={discordId:user.id};
      if(site)claims.raidLeader=user.id===leader();
      const customToken=await auth.createCustomToken('discord_'+user.id,claims);
      if(site){
        const target=new URL(site());
        if(target.origin!=='https://godspeedgdkp.bid')throw Error('Invalid site');
        await database.ref('accounts/'+user.id+'/profile').update({discordId:user.id,discordName:user.username,displayName:user.global_name||user.username});
        target.hash=new URLSearchParams({gs_token:customToken,gs_user:JSON.stringify({id:user.id,username:user.username,displayName:user.global_name||user.username,avatar:user.avatar?'https://cdn.discordapp.com/avatars/'+user.id+'/'+user.avatar+'.png':''})}).toString();
        return res.redirect(target.toString());
      }
      const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      return res.status(200).send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Godspeed login check</title><style>body{background:#15110b;color:#eee5cf;font:18px system-ui;padding:32px;max-width:680px;margin:auto}h1{color:#d4af37}p{line-height:1.6}code{color:#d4af37}</style><h1>Discord login verified</h1><p>Account: <strong>${escape(user.username)}</strong><br>Discord ID: <code>${user.id}</code></p><p>Firebase token signing also passed for ${PROJECT}.</p><p>The website is still in maintenance. Auctions and payments have not been enabled.</p><p>Send the account name and Discord ID back to finish leader setup.</p></html>`);
    } catch (error) {
      // Only fixed diagnostic labels are emitted. Raw errors may contain credentials.
      const message = String(error?.message || '');
      let reason = 'failed';
      if (/iam\.serviceAccounts\.signBlob|signBlob/i.test(message)) reason = 'signing-permission';
      else if (/SERVICE_DISABLED|has not been used|API.*disabled/i.test(message)) reason = 'api-disabled';
      else if (/permission.denied|insufficient.permission|PERMISSION_DENIED/i.test(message)) reason = 'permission-denied';
      else if (error?.name === 'TimeoutError' || error?.name === 'AbortError') reason = 'timeout';
      else if (message === 'Banned account') reason = 'account-banned';
      else if (message === 'Invalid state') reason = 'cookie-or-state-mismatch';
      const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599 ? upstreamStatus : undefined;
      const diagnostic = {event:'godspeed-login-check-failed',version:2,stage,reason,...(status ? {upstreamStatus:status} : {})};
      log(diagnostic);
      return res.status(400).send(`Login check failed [v2 / ${stage} / ${reason}${status ? ' / HTTP ' + status : ''}]. Send this message. Start a fresh attempt from the original login-check link; do not refresh the callback page.`);
    }
  };
}
module.exports = {createHandler};
