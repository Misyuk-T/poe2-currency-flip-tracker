# Tool directories — submission checklist

Every destination below was checked on **2026-09-03**. Anything that could not
be confirmed is marked **UNVERIFIED** with the reason, rather than dropped or
guessed at. Nothing here has been submitted — this is a checklist for Taras.

Order is by expected value per hour of effort. Do 1–4 first; they are the ones
that both send players and leave a durable link.

| # | Destination | Needs | Effort | Status |
| - | ----------- | ----- | ------ | ------ |
| 1 | pathofexile.com Community Showcase | PoE account, new thread | 20 min | Verified |
| 2 | PoE2 Wiki — community websites list | Wiki account, table edit | 30 min | Verified page, edit policy UNVERIFIED |
| 3 | GG Atlas directory | Discord sign-in, short form | 10 min | Verified |
| 4 | PoE Wiki (PoE1) — community websites list | Wiki account, table edit | 20 min | Verified |
| 5 | `5k-mirrors/awesome-poe-2` | GitHub account, PR | 15 min | Verified |
| 6 | Path of Exile 1 & 2 Discord | Discord account, read pins first | 20 min | Server verified, channel UNVERIFIED |
| 7 | Path Of Exile 2 Discord | Discord account, read pins first | 20 min | Server verified, channel UNVERIFIED |
| 8 | `oflisback/awesome-poe2` | GitHub account, PR | 10 min | Verified, low reach |
| 9 | POE2 Scout Discord | Discord account | 10 min | Verified, small |

---

## Ready-to-paste descriptions

Keep these consistent everywhere — a listing that matches the forum thread and
the site itself is the point.

**One line** (awesome-list / wiki-table style; deliberately no marketing words,
does not start with "A", per the awesome-list contributing rules):

```
Currency Exchange market data with hourly low/high ranges, 24h moves, liquidity and a page for each currency, for Path of Exile 2 and Path of Exile.
```

**One line, shortest** (where a table column is narrow):

```
Hourly Currency Exchange market data with per-currency history pages.
```

**Three lines** (directory forms with a description field, Discord posts):

```
Exile Radar reads Grinding Gear Games' official Currency Exchange feed once an
hour and shows what each market did: the hour's low and high, the spread, the
24h move and liquidity, laid out in the in-game exchange categories, for Path of
Exile 2 and Path of Exile. Each currency also has its own page with the latest
completed-hour range and a labelled replay of how a conservative buy/sell plan
would have performed over past hourly windows. Free, no account, no ads; not
affiliated with or endorsed by Grinding Gear Games.
```

**Markdown link line** for the awesome lists:

```
- [Exile Radar](https://exileradar.com/poe2) - Currency Exchange market data with hourly ranges, 24h moves and per-currency history pages for PoE 2 and PoE 1.
```

Canonical URL to submit: **https://exileradar.com/poe2** (the bare domain
permanently redirects there, 308 — verified). Use the bare domain in prose,
the `/poe2` URL in directory fields that want a landing page.

---

## 1. pathofexile.com — Community Showcase

- **URL:** https://www.pathofexile.com/forum/view-forum/community-showcase
- **Needs:** a pathofexile.com account (the game account). No form, no
  moderator approval — you create a thread.
- **Effort:** 20 minutes. The post is already written.
- **Do:** see `docs/outbound/forum-tool-thread.md` for the full post, the title,
  and the things to avoid.
- **Verified:** the full forum index was read on 2026-09-03. There is **no "Tool
  Development" subforum** on pathofexile.com — Community Showcase is where tools
  go. Live threads in it right now include `exiles-base` (currency exchange
  history and regex builders), Path of Price Check, PoE-VIEW2, a poe.ninja
  build-cost extension and a PoE2 tablet farming helper. It covers both games.
- **Also verified:** external links in forum posts carry no `rel="nofollow"` —
  checked the raw HTML of a live thread. This is the single best link on the
  list.

## 2. PoE2 Wiki — List of Path of Exile 2 community websites

- **URL:** https://www.poe2wiki.net/wiki/List_of_Path_of_Exile_2_community_websites
- **Needs:** a poe2wiki.net account, then edit the first table ("Path of Exile 2
  community websites") and add a row: Link / Authors / Description. This is a
  plain MediaWiki table edit, not a moderator request — there is no submission
  form and no queue.
- **Effort:** 30 minutes including account creation. Read the wiki's editing
  guide first; a badly formatted table row gets reverted.
- **Which table:** the **websites** table, not the "community tools" table below
  it — the second one is for desktop overlays and apps.
- **Verified:** the page exists and its contents were read on 2026-09-03. Direct
  comparables are already listed there: **PoE2 Base** ("Currency Exchange market
  data with ratios, volume and price history"), **Divine Tendies**, **PoE2.Ninja**
  and **ggAtlas**. The wiki's own search index reports the page as last edited
  **06:59, 1 September 2026** — it is actively maintained.
- **UNVERIFIED:** whether anonymous or brand-new accounts can edit, and whether
  there is an autoconfirm delay. The wiki sits behind an Anubis anti-bot
  challenge that blocks headless fetching, so the permissions page could not be
  read. Check `Special:CreateAccount` and the Community Portal when you get
  there.
- **Note:** `https://www.poe2wiki.net/wiki/Third-party_tools` is an **empty
  page** — it exists as a title but has no content and cannot be created
  anonymously. Do not use it; the community-websites list above is the real one.

## 3. GG Atlas — PoE2 tools directory

- **URL:** https://ggatlas.app/poe2 — submission form at https://ggatlas.app/submit
- **Needs:** the form asks for the resource link (required), the game (required),
  and a functionality category (required — pick **Market & Analytics**). Name and
  description are optional; fill them anyway with the one-line description above.
  The site offers "Sign in with Discord", and sign-in is probably required to
  submit.
- **Effort:** 10 minutes.
- **Verified:** the directory exists, is current (it reports the latest observed
  game version as 0.5.5, updated Sep 3 2026), tracks per-tool reachability and
  "maintainer confirmed" status, and already lists Exiled Exchange 2, Sidekick,
  LAMA, PoE Overlay II, poe.ninja, PoE2DB and others under Market & Analytics.
  It is itself listed on the PoE2 wiki, so it is a recognised destination rather
  than a link farm.
- **Bonus:** it has a "maintainer confirmed" flag — claiming the listing after
  submission is worth the extra two minutes.

## 4. PoE Wiki (PoE1) — List of Path of Exile community websites

- **URL:** https://www.poewiki.net/wiki/List_of_Path_of_Exile_community_websites
- **Needs:** a poewiki.net account, then add a row to the **Trading** table.
  Same MediaWiki edit model as the PoE2 wiki, no form or moderator request.
- **Effort:** 20 minutes (less if the PoE2 wiki account works here too — check;
  they are sister projects but may be separate logins).
- **Only do this if the PoE1 side is real, and it is:** the live config serves
  PoE1 leagues (Allflame, Hardcore Allflame, Ruthless Allflame, Standard,
  Hardcore) with thousands of priced pairs. Listing a PoE2-only site here would
  get reverted.
- **Verified:** the page exists and its guidelines were read on 2026-09-03. It
  states plainly that only websites and web apps belong on this list (desktop
  apps go on the separate applications list), that dead or unmaintained sites
  should be avoided, and that anything violating the PoE terms of use is an
  instant permanent ban. The Trading table already holds poe.ninja, poe.watch,
  DivineTendies and PoE-Antiquary.
- **UNVERIFIED:** same Anubis caveat as the PoE2 wiki — the editing-permissions
  policy could not be fetched.

## 5. `5k-mirrors/awesome-poe-2` (GitHub)

- **URL:** https://github.com/5k-mirrors/awesome-poe-2
- **Needs:** a GitHub account and a pull request adding one line to the **Tools**
  section of `README.md`.
- **Effort:** 15 minutes.
- **Verified:** 70 stars, not archived, last push 2026-02-11. Its `contributing.md`
  was read: format is `[Name](link) - Description.`, no marketing slogans, avoid
  "easy / simple / beautiful / premium / powerful / amazing", do not start with
  "A" or "An", do not use "your", no numbers (they go stale), and keep spelling
  as "PoE 2" / "Path of Exile 2" / "GGG". If you touch the section headings, run
  `npx doctoc --title '## Contents' README.md`. The markdown link line above
  already complies.
- **Caveat:** last commit was February 2026, so the PR may sit for a while. Open
  it anyway; it costs nothing and merges eventually.

## 6. Path of Exile 1 & 2 Discord

- **Invite:** https://discord.gg/pathofexile
- **Verified:** the invite resolves to a server named "Path of Exile 1 & 2" with
  approximately 264,000 members and 65,000 online, landing channel
  `rules-and-info` (checked via Discord's public invite endpoint, 2026-09-03).
  This is the large community server.
- **Needs:** a Discord account. **Read `rules-and-info` and the pinned messages
  in whichever channel you intend to post in, before posting.** Large servers
  ban tool spam on sight, and a ban here is permanent and expensive.
- **Effort:** 20 minutes, most of it reading.
- **UNVERIFIED:** the channel list. Search results mention a `#tooldev-general`
  channel for tool developers, but channels cannot be seen without joining, so
  treat that name as a lead, not a fact. Look for a tool-dev, community-showcase
  or self-promo channel and follow its pinned rules exactly.

## 7. Path Of Exile 2 Discord

- **Invite:** https://discord.gg/pathofexile2
- **Verified:** resolves to a server named "Path Of Exile 2", approximately
  79,000 members and 18,000 online, landing channel `announcements` (same method
  and date).
- **Needs / effort / caveats:** identical to #6. Read the rules channel first.
- **UNVERIFIED:** its channel structure and whether it permits tool posts at all.

## 8. `oflisback/awesome-poe2` (GitHub)

- **URL:** https://github.com/oflisback/awesome-poe2
- **Needs:** GitHub account, PR adding a line to the **Trading & Economy**
  section of `README.md` (it already lists poe.ninja, PoE 2 Scout and Divine
  Tendies there, so the fit is exact).
- **Effort:** 10 minutes.
- **Verified:** exists, not archived, last push 2026-06-17. Only 1 star, so the
  reach is close to zero — do it last, and only because it is cheap.

## 9. POE2 Scout Discord

- **Invite:** https://discord.gg/EHXVdQCpBq (found linked from poe2scout.com)
- **Verified:** resolves to a server named "POE2 Scout", approximately 199
  members, 58 online (2026-09-03).
- **Worth it for:** peer feedback from people who also build market tools, and a
  sanity check on the data against another Currency Exchange consumer. **Not**
  worth it as a distribution channel at that size, and be tactful — it is a
  competitor's server.

---

## Checked and deliberately not listed

- **A "Tool Development" subforum on pathofexile.com — does not exist.** The
  full forum index was enumerated on 2026-09-03. Community Showcase is the
  destination (#1 above).
- **`poe2wiki.net/wiki/Third-party_tools` — empty page**, cannot be created
  anonymously. See the note under #2.
- **PoE Wiki "List of Path of Exile community applications"** —
  https://www.poewiki.net/wiki/List_of_Path_of_Exile_community_applications
  exists and was read, but its guidelines say explicitly that it is for desktop
  and mobile applications and that web apps belong on the websites list. Exile
  Radar does not qualify. Do not submit it here.
- **r/PathOfExile2** — handled separately in `docs/outbound/reddit-launch-post.md`.
  Its rules are **UNVERIFIED**; Reddit blocks headless fetching, so the sidebar
  has to be read manually before posting.
- **poe2.com ("Unofficial PoE2 Community Directory")** — **UNVERIFIED.** The site
  exists and describes itself as an independent fan directory with Builds and
  Resources sections, but no submission path could be found beyond a footer
  Contact link. If you want it, email via that contact link and expect nothing.
- **exile.pub/poe2, pathofcodex.com/tools, poe2-directory.vercel.app** —
  **UNVERIFIED.** All three surface in search as PoE2 tool lists. `exile.pub`
  could not be fetched (the page exceeded the fetch size limit); the other two
  were not confirmed to accept outside submissions and may simply be one team's
  own feature list. Check them by hand before spending time.
- **Discord servers for poe2db, Craft of Exile, FilterBlade, Exiled Exchange,
  Divine Tendies, The Forbidden Trove** — the obvious vanity invite codes were
  all tested and none resolve. If you want any of these, find the invite from
  the tool's own site first. Divine Tendies in particular lists only an email
  address, no Discord.

---

## Two things to have ready before you start

1. **The site has to be worth listing when a curator clicks.** Every one of
   these destinations will get a human opening https://exileradar.com/poe2 within
   a day. Make sure the current league is showing real rows.
2. **Do not submit the same day everywhere.** Spread #1–#5 over a week. A pile of
   listings appearing within an hour of each other looks exactly like what it
   would be.
