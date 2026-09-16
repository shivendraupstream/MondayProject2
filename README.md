# monday.com SendGrid Integration Server

A Node.js/Express backend that powers a custom monday.com integration recipe: **"Send a SendGrid template email"**. It connects a monday.com Workflow Builder automation to the SendGrid API, letting a board automation send a templated email with per-item dynamic data.

Deployed on Render. Built for Upstream Tech.

## What this does

The recipe lets a user build an automation like:

> When [trigger happens] on this board, send a SendGrid template email to [recipient], using [template], with [these variables mapped from item columns].

This server implements the three server-side pieces monday.com calls into to make that recipe work: listing available templates, describing a template's variables, and actually sending the email.

## Architecture

```
monday.com Workflow Builder
        |
        | (signed JWT in Authorization header)
        v
Render-hosted Express server (this repo)
        |
        | (Bearer token)
        v
SendGrid API
```

Three routes, all mounted under `/sendgrid`:

| Route | File | Purpose |
|---|---|---|
| `POST /sendgrid/templates/options` | `routes/templates.js` | Populates the "SendGrid Template" dropdown in the recipe builder. Calls SendGrid's `/v3/templates` and returns `{ title, value }` pairs. |
| `ALL /sendgrid/mapping-schema` | `routes/mapping.js` | Given a selected template, returns the list of variable names it expects (as monday "dynamic mapping" fields), pulled from the template's active version's test data. |
| `POST /sendgrid/send-template-email` | `routes/send.js` | The actual action: sends the email via SendGrid using the mapped variables, then reports success or failure back to monday. |

`middleware/verifyMondayRequest.js` verifies the JWT monday signs onto every incoming request, using the app's Signing Secret. It can be bypassed for local testing (see Environment Variables below).

## The async action block flow

`send-template-email` is configured as an **async action block** in the monday Developer Center. This matters because it changes the response contract:

- **A normal (synchronous) action block** would call SendGrid, wait for the result, and reply to monday's original request with the outcome. monday waits up to 60 seconds for that reply.
- **An async action block** replies to the original request immediately, just to acknowledge it was received, then does the actual work, then reports the real result afterward by POSTing to a `callbackUrl` monday includes in the original payload. The automation stays "in progress" in monday's UI until that callback arrives.

This project uses the async pattern because the original synchronous version was intermittently getting stuck showing "In progress" or "Failed" in the automation Run History even though the email had actually sent. That was traced to Render's free-tier cold starts occasionally pushing the response past monday's timeout window. The async pattern removes that race condition: monday no longer needs the whole SendGrid round trip to happen inside its response window.

### Reporting the result

Once the SendGrid call resolves, `send.js` POSTs the outcome to `callbackUrl`:

- **Success:** `{ "success": true, "outputFields": { ... } }`
- **Failure:** `{ "success": false, "severityCode": 4000, "runtimeErrorDescription": "...", "notificationErrorTitle": "...", "notificationErrorDescription": "..." }`

That callback POST must itself be authenticated. It carries an `Authorization` header containing a JWT signed with the app's Signing Secret, with the app's numeric ID in the payload:

```javascript
jwt.sign({ appId: Number(MONDAY_APP_ID) }, MONDAY_SIGNING_SECRET)
```

**Important:** `appId` must be a JavaScript number, not a string, when signed. `process.env.MONDAY_APP_ID` is always a string in Node, so it must be explicitly cast with `Number(...)`. Signing it as a string produces a JWT that monday's gateway silently rejects with an empty-bodied `401`, with no other indication of what's wrong. This was the root cause of a stuck-in-401 debugging session and is the single most important gotcha in this codebase.

## Environment variables

Set these in Render's Environment tab (or a local `.env` file for local development):

| Variable | Used by | Description |
|---|---|---|
| `PORT` | `server.js` | Port Express listens on. Render sets this automatically in production. |
| `MONDAY_SIGNING_SECRET` | `verifyMondayRequest.js`, `routes/send.js` | Your app's Signing Secret from the Developer Center Basic Details page. Used both to verify incoming requests from monday and to sign outgoing async callback JWTs. Not the same value as the Client Secret. |
| `MONDAY_APP_ID` | `routes/send.js` | Your app's numeric App ID from the Developer Center Basic Details page. Must be cast with `Number()` before signing. |
| `SENDGRID_FROM_ADDRESS` | `routes/send.js` | Fallback "from" address used if the recipe doesn't supply one. Must be a SendGrid-verified sender. |
| `DEV_BYPASS_AUTH` | `verifyMondayRequest.js` | When set to `"true"`, skips JWT verification on incoming requests entirely. Useful for local testing with curl/Postman without a real monday JWT. **Should be `false` (or unset) in production** — see Security below. |

The SendGrid API key itself is not an environment variable. It's expected to arrive per-request in `payload.credentialsValues.sendgrid_connection.accessToken`, supplied by monday's Credentials feature when a user connects their SendGrid account to the recipe. A `req.body.apiKey` fallback exists in each route purely as a local-testing shortcut.

## Local development

```bash
npm install
npm run dev   # or: node server.js
```

Test a route directly without monday in the loop:

```bash
curl -X POST http://localhost:3000/sendgrid/templates/options \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "YOUR_SENDGRID_KEY"}'
```

Set `DEV_BYPASS_AUTH=true` locally so `verifyMondayRequest` doesn't reject requests that lack a real monday-signed JWT.

## Deployment

Deployed on Render as a standard Node web service.

- Build command: `npm install`
- Start command: `node server.js`
- All five environment variables above must be set in Render's Environment tab.
- After changing environment variables, trigger a manual redeploy, Render does not always reload a running instance's environment on a settings-only save.

## Known issues and hard-won lessons

- **Render cold starts can still delay the initial acknowledgment.** The async pattern removes the timeout risk on the SendGrid call itself, but the very first `res.status(200)` ack still has to arrive within monday's window. Keeping the Render service warm (a paid tier, or a periodic keep-alive ping) reduces the chance of a slow first response.
- **`appId` must be a number in the callback JWT**, not a string. See "The async action block flow" above.
- **`callbackUrl` only exists for async action blocks.** If a block isn't marked async in the Developer Center, monday never sends a `callbackUrl`, and this code will silently skip the callback POST (logged as a warning) since there's nowhere to send it.
- **`DEV_BYPASS_AUTH=true` disables all incoming JWT verification.** This is intended for local development only. Running it in production on Render means anyone who discovers the run URL could POST directly to `/sendgrid/send-template-email` and trigger a real SendGrid send. Confirm it's `false` in the Render dashboard before considering this production-ready.
- **Signing Secret vs. Client Secret.** monday's Developer Center Basic Details page lists both. Only the Signing Secret is correct for `MONDAY_SIGNING_SECRET`, they are different values and both look like plausible random strings.

## Dependencies

- `express` — HTTP server and routing
- `jsonwebtoken` — verifying incoming monday JWTs and signing outgoing callback JWTs
- `dotenv` — loads `.env` for local development
