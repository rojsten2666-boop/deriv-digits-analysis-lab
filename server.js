import express from "express";
import session from "express-session";
import helmet from "helmet";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const CLIENT_ID = process.env.DERIV_CLIENT_ID;
const CLIENT_SECRET = process.env.DERIV_CLIENT_SECRET;
const REDIRECT_URI = process.env.DERIV_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET || !SESSION_SECRET) {
  console.warn("Deriv OAuth is not configured. Add DERIV_CLIENT_ID, DERIV_CLIENT_SECRET and SESSION_SECRET to .env.");
}

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(session({
  name: "deriv_demo.sid",
  secret: SESSION_SECRET || crypto.randomBytes(48).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 4 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.deriv?.accessToken) return res.status(401).json({ error: "Connect your Deriv demo account first." });
  next();
}
function safeAccounts(accounts) {
  return (accounts || []).map(a => ({
    account: a.account,
    account_id: a.account_id,
    account_type: a.account_type,
    currency: a.currency,
    balance: a.balance,
    status: a.status
  }));
}

app.get("/auth/login", (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(503).send("Set Deriv OAuth client credentials in the server environment first.");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(24).toString("hex");
  req.session.oauth = { verifier, state, createdAt: Date.now() };
  const url = new URL("https://auth.deriv.com/oauth2/auth");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "trade account_manage",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  }).toString();
  res.redirect(url.toString());
});

app.get("/auth/callback", async (req, res) => {
  const saved = req.session.oauth;
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Deriv authorization was not completed: ${String(error)}`);
  if (!saved || !code || !state || state !== saved.state || Date.now() - saved.createdAt > 10 * 60 * 1000) {
    return res.status(400).send("OAuth state validation failed or the login session expired. Return to the app and connect again.");
  }
  delete req.session.oauth;
  try {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: String(code),
      code_verifier: saved.verifier,
      redirect_uri: REDIRECT_URI
    });
    const tokenResponse = await fetch("https://auth.deriv.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Deriv token exchange failed:", tokenData.error || tokenResponse.status);
      return res.status(502).send("Deriv token exchange failed. Check your OAuth app settings and redirect URL.");
    }
    const accountsResponse = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const accountsData = await accountsResponse.json();
    if (!accountsResponse.ok) {
      console.error("Deriv accounts lookup failed:", accountsData.error || accountsResponse.status);
      return res.status(502).send("Could not retrieve Deriv accounts. Ensure the app has the required account access.");
    }
    const accounts = accountsData.data?.accounts || accountsData.accounts || [];
    const demo = accounts.find(a => String(a.account_type || "").toLowerCase() === "demo");
    if (!demo) return res.status(403).send("No demo options account was returned for this authorization. No real account will be used.");
    req.session.deriv = {
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + Number(tokenData.expires_in || 0) * 1000,
      demoAccount: safeAccounts([demo])[0]
    };
    res.redirect("/?connected=demo");
  } catch (e) {
    console.error("OAuth callback error:", e.message);
    res.status(502).send("Could not complete Deriv connection. Please try again.");
  }
});

app.get("/api/status", (req, res) => {
  const d = req.session.deriv;
  res.json({
    connected: Boolean(d?.accessToken && d.expiresAt > Date.now()),
    account: d?.demoAccount || null,
    mode: "DEMO_ONLY"
  });
});

app.post("/api/ws-url", requireAuth, async (req, res) => {
  const d = req.session.deriv;
  if (d.expiresAt <= Date.now()) {
    req.session.deriv = null;
    return res.status(401).json({ error: "Deriv authorization expired. Reconnect your demo account." });
  }
  const requested = String(req.body?.account_id || "");
  const demo = d.demoAccount;
  const accountId = String(demo?.account || demo?.account_id || "");
  if (!accountId || requested !== accountId || String(demo.account_type).toLowerCase() !== "demo") {
    return res.status(403).json({ error: "This application only permits the authorized DEMO account." });
  }
  try {
    const response = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${d.accessToken}`, "Content-Type": "application/json" }
    });
    const data = await response.json();
    const url = data.data?.url || data.url;
    if (!response.ok || !url || !url.includes("/demo?otp=")) {
      console.error("Demo OTP request failed:", data.error || response.status);
      return res.status(502).json({ error: "Could not create a demo trading session. No trade was placed." });
    }
    res.json({ url, account: demo, mode: "DEMO_ONLY" });
  } catch {
    res.status(502).json({ error: "Deriv demo connection failed." });
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.listen(PORT, () => console.log(`Deriv Pro Digit Analyzer running on port ${PORT}`));
