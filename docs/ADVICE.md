# Advice & open options

Recommendations and choices in flight. Move resolved items into
[DECISIONS.md](DECISIONS.md).

## Custom domain (decided: buy one)

**Registrar** — recommended **Cloudflare Registrar** (at-cost pricing, free
WHOIS privacy, no first-year-cheap/renewal-expensive games) or **Porkbun** /
**Namecheap** as alternatives.

**TLD** — prefer `.com` for trust/CTR. `.gg` reads as gaming but renews pricey;
`.app`/`.io` are fine (`.app` forces HTTPS, which we already do).

**Name candidates** — live availability/price (checked via Vercel, 2026-06-27):

| Domain | Status | Price/yr |
| --- | --- | --- |
| **poe2flip.app** | available | **$9.99** — keeps the ideal `poe2flip` brand (`.com` is taken); `.app` forces HTTPS (already on) |
| **poe2flips.com** | available | $11.25 — `.com` trust, plural |
| **flippoe2.com** | available | $11.25 — `.com`, readable |
| exaltflip.com | available | $11.25 — ties to the Supabase project name |
| divineflip.com | available | $11.25 |
| poe2flip.gg | available | $129.99 — gaming TLD, pricey |
| poe2flip.com / poe2market.com / poe2currency.com / poeflip.com | taken | — |

**Recommendation:** `poe2flip.app` (best brand + cheapest + HTTPS-native) or
`poe2flips.com` if you prefer a `.com`. Buy at the Vercel domains search
(purchaseUrl returned per name) or any registrar. **The user buys it** — I do
not execute purchases. Mind GGG's IP: a generic flip/market name is safer than
PoE trademarks; don't imply official affiliation.

**Wiring once bought** (low-effort, ~10 min):
1. Vercel → Project → Settings → Domains → add the domain; follow the DNS
   instructions (A/ALIAS + CNAME, or switch nameservers to Vercel).
2. Set `NEXT_PUBLIC_SITE_URL=https://<domain>` (Production) and redeploy.
3. `canonical`, `sitemap.xml`, `robots.txt`, OG already read that env var, so
   they switch automatically.
4. In Google Search Console, add the new domain property and resubmit the
   sitemap.

## SEO — open recommendations

- **Google Search Console** (needs the user): verify the domain, submit
  `sitemap.xml`, watch impressions/CTR per currency. Single biggest measurement
  unlock.
- **Live data (cxapi)**: the biggest content-quality jump (real prices, drop
  "sample data"). Blocked on a GGG OAuth `service:cxapi` grant — a separate
  application track.
- **Dynamic OG images** per currency (price + sparkline) for social CTR —
  pure-code, queued.
- **Keyword guide pages** ("how to flip X", "divine to exalted ratio") — queued;
  pick target keywords.

## C3c (Google auth + forward journal) — what the user must do

**Unlike Firebase, Supabase is third-party, so Google requires your own OAuth
client.** There is no "just toggle it on" path (even Google One Tap needs a
Client ID). Confirmed against the current Supabase docs
(`/guides/auth/social-login/auth-google`). Steps:

1. **Google Cloud Console** → create/select a project.
2. **OAuth consent screen** → scopes `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`; set Branding (logo + name) so the consent screen
   shows the app name, not the Supabase ref.
3. **Create OAuth client ID** → application type **Web application**.
   - **Authorized JavaScript origins:** the site URL(s) —
     `https://poe2-currency-flip-tracker.vercel.app` (+ the custom domain later).
   - **Authorized redirect URIs:** the `exalted-flip` callback —
     `https://qbivdphhwfprbfbktskm.supabase.co/auth/v1/callback`
     (local dev: `http://127.0.0.1:54321/auth/v1/callback`).
4. Copy the **Client ID + Client Secret** → **Supabase Dashboard → Authentication
   → Providers → Google** → enable + paste.

Then authorize applying the forward-journal **migration** to prod Supabase. The
app code (Supabase Auth + per-user RLS + journal) is prepped on our side and can
be wired before the provider is switched on.
