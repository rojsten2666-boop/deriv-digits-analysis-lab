# Deriv Pro Digit Analyzer — DEMO-only starter

This is a runnable starter application based on the uploaded “Volatility Scanner” video. It includes a live market scanner, rolling digit statistics, six digit-contract categories, Deriv OAuth sign-in, a demo-only authenticated WebSocket, and a guarded automatic demo execution loop.

**It is not connected to your account yet.** You must register a Deriv OAuth 2.0 application and configure the server environment variables. I cannot sign in to Deriv or accept terms on your behalf.

## Safety design

- Server selects only an account returned by Deriv with `account_type: "demo"`.
- Server rejects an OTP request unless the account matches that demo account.
- Server rejects WebSocket URLs that do not contain the `/demo?otp=` path.
- Auto-trading is OFF by default and requires a visible checkbox plus a Start button.
- No real-account mode is implemented.
- The bot stops when the WebSocket closes.
- Default max session trades: 5; default max session loss: 5 account-currency units.
- Historical frequency is descriptive, not a predictive guarantee. A high historical frequency threshold is not proof of positive expected value.

## Requirements

- Node.js 20+
- A Deriv OAuth 2.0 app registered at https://developers.deriv.com/
- Deriv app configured with `trade` scope
- Exact callback URL configured in Deriv app settings

## Configure and run locally

```bash
cp .env.example .env
# Edit .env with your Deriv OAuth client ID, client secret and a long session secret
npm install
npm start
```

Open http://localhost:3000.

Set `DERIV_REDIRECT_URI=http://localhost:3000/auth/callback` in `.env` and register that exact URL in the Deriv OAuth app for local testing. For hosted deployment, use HTTPS and set the exact hosted callback URL in both places.

## Deploy

Deploy this Node application to a private server host that supports HTTPS and persistent server processes (for example, a Node hosting service). Configure these environment variables in the host dashboard:

- `DERIV_CLIENT_ID`
- `DERIV_CLIENT_SECRET`
- `DERIV_REDIRECT_URI`
- `SESSION_SECRET`
- `NODE_ENV=production`

Do not commit `.env`, client secrets, access tokens, or OTP URLs to GitHub. Do not host the OAuth token exchange in a public static-only GitHub Pages site. The app uses an in-memory Express session store for this starter; for production use, configure a secure persistent session store and review cookie/proxy settings for your host.

## API flow used

- Public market data: `active_symbols`, `ticks_history`, `ticks`
- Account OAuth: Deriv Authorization Code + PKCE
- Demo session: `POST /trading/v1/options/accounts/{accountId}/otp`
- Trading: `proposal`, `buy`, `proposal_open_contract`
- Digit contract types: `DIGITOVER`, `DIGITUNDER`, `DIGITEVEN`, `DIGITODD`, `DIGITMATCH`, `DIGITDIFF`

Check current schemas and terms before deployment:
- https://developers.deriv.com/docs/intro/api-overview/
- https://developers.deriv.com/docs/intro/authentication/
- https://developers.deriv.com/docs/intro/oauth/
- https://developers.deriv.com/docs/data/
- https://developers.deriv.com/docs/trading/
- https://deriv.com/terms-and-conditions/api-users

## Important known limitations before live use

1. The market discovery filter uses the active-symbol metadata fields `submarket_display_name`, `display_name`, and `market_display_name`. Verify it against the current response for your Deriv account/region; if Deriv changes those fields, update the filter.
2. The scanner currently caps simultaneous market subscriptions at 40 to avoid uncontrolled subscription growth. It loads up to 1,000 historical ticks per subscribed market.
3. The sample auto strategy is a configurable frequency threshold, not a validated profitable strategy. It places one-tick contracts and can lose the full stake. Test only with demo funds.
4. Digit extraction uses each symbol's `pip_size` metadata. Validate sample last digits against Deriv's own displayed tick precision for each market.
5. This starter does not persist raw ticks or raw market feed data. The app keeps a rolling in-memory window only.
6. Before using any Deriv API integration, read and comply with the current API-user terms. In particular, the terms restrict storage of API-derived content and allow caching only within the stated limit.
7. Review all behavior with a qualified developer before relying on unattended execution. Do not enable real-money trading in this demo-only project.

## Test checklist

- [ ] Deriv OAuth login returns to `/auth/callback`.
- [ ] OAuth state is validated.
- [ ] Only a demo account is selected.
- [ ] OTP response contains a `/demo?otp=` URL.
- [ ] `active_symbols` loads and volatility filter matches current symbol metadata.
- [ ] `ticks_history` returns prices and digits match Deriv's display precision.
- [ ] Live tick subscriptions update the dashboard.
- [ ] All six contract types return proposals for selected symbols/barriers.
- [ ] Proposal ask price is used as the buy maximum price.
- [ ] Open-contract updates settle and update P/L.
- [ ] Network loss stops auto-trading.
- [ ] Risk caps stop further purchases.
- [ ] No token, secret, or OTP is written to browser logs or Git.
