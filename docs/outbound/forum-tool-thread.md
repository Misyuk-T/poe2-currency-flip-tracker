# Official forum thread — Exile Radar

Copy-paste post for the pathofexile.com forums. Written 2026-09-03; every
product claim below was checked against the live site the same day.

This is the evergreen one. It is meant to sit there for years and be the
canonical "here is the tool" reference, so it is written flat and factual
rather than as a launch pitch.

---

## Where to post

**Community Showcase — https://www.pathofexile.com/forum/view-forum/community-showcase**

There is **no "Tool Development" subforum on pathofexile.com**. The full forum
index was checked on 2026-09-03: the categories are Path of Exile 2 Early
Access, News, Help & Support, Feedback, Discussion, Classes/Builds, Community,
Racing and PvP, Console, Trading, and Careers & Press. Community Showcase (under
Community) is where third-party tools actually get announced — threads live in
it right now for `exiles-base` (currency exchange history), Path of Price Check,
PoE-VIEW2, a poe.ninja build-cost extension and a PoE2 tablet farming helper.
Community Showcase takes both PoE1 and PoE2 tools; there is no PoE2-specific
equivalent.

Requirements: a pathofexile.com account (the same account as the game). No
moderator approval, no application, no form — you just create a thread.

**Verified bonus:** external links inside forum posts are plain `<a href>` with
no `rel="nofollow"`. (Checked the raw HTML of a live Community Showcase thread
on 2026-09-03 — the only `nofollow` attributes on the page are on internal
reply/filter buttons.) So this thread is a real followed link, which is exactly
what the site's zero-backlink problem needs.

---

## Title

```
Exile Radar - hourly Currency Exchange prices for every PoE2 and PoE1 market (free, no login)
```

Alternates if that reads long in the thread list:

- `Exile Radar - hourly Currency Exchange market data for PoE2 and PoE1`
- `Exile Radar - what every Currency Exchange market did, hour by hour`

---

## Body

Paste as-is. The forum takes light BBCode; `[b]`, `[url]` and `[list]` are used
below and nothing else, so there is nothing to go wrong.

```
I play a lot of Currency Exchange and got tired of guessing whether the ratio in
front of me was normal for the day or someone having a moment. So I built a site
that reads GGG's official Currency Exchange feed once an hour and shows what each
market actually did.

[url]https://exileradar.com[/url]

[b]What it does[/b]
[list]
[*]Every market in the feed, in one sortable table: the hour's low and high, the
spread between them, the 24h move, and a liquidity column so you can tell the
deep markets from the thin ones. Categories follow the in-game exchange layout,
so it reads roughly like the trade screen.
[*]A page per currency - 628 of them at the moment - with the latest completed
hour's range, the 24h move, how many samples that hour had, and a short write-up
of what the currency is and how it tends to trade.
[*]Open any market and you get a plan view: a conservative buy level and sell
level worked out from past hourly ranges, plus a replay of what running that
plan would have done over past windows - how often the buy price was touched,
and how often the sell price came after it.
[*]If the price you see in game is different from the feed, type it in and the
whole plan rebases onto your number instead of mine.
[*]Both games and the public leagues GGG publishes: PoE2 (Runes of Aldur, its
hardcore version, Standard, Hardcore) and PoE1 (Allflame, its hardcore and
ruthless versions, Standard, Hardcore). New leagues appear in the picker on
their own once the feed starts carrying them.
[/list]

[b]Where the data comes from[/b]
GGG's official Currency Exchange feed, read once an hour. Completed hours only -
the currency pages state the completed hour they are showing, and the plan view
tells you how old the price it is working from is. Nothing reads the game
client, nothing talks to the game, nothing is scraped from other sites.

[b]What it does not do[/b]
[list]
[*]No predictions. Nothing on the site forecasts a price. The replay numbers are
history being replayed, and they are labelled that way on the page.
[*]No guaranteed profit. An hourly low touching your buy price means the market
traded there - not that your order filled, and not at your size. The site says
this next to the number rather than in a footnote.
[*]No live quotes. Hourly data is day-scale context. Before a big trade, check
the real price in game; there is a box to paste it into.
[*]No account, no login, no ads, no paid tier, nothing to install.
[*]Not affiliated with or endorsed by Grinding Gear Games in any way. It is a
fan project. Item names and artwork are GGG's.
[/list]

Feedback welcome, especially from people who trade a specific market daily - if
a number looks wrong to you there, that is the failure mode I cannot catch on my
own. Same goes for anything that reads as overclaiming; I would rather cut a
feature than have the site imply free money.
```

---

## What to avoid

- **Do not cross-post.** One thread, in Community Showcase. Do not also post it
  in Early Access Discussion or Early Access Trading — that reads as spam and is
  the fastest way to get the thread removed instead of indexed.
- **Keep it non-commercial, visibly.** GGG's Terms of Use say posts promoting a
  person or entity or their goods or services need GGG's prior written approval.
  Free fan tools are posted in Community Showcase constantly, but the thing that
  keeps them on the right side of that line is that there is nothing to buy. No
  donation link, no Patreon, no affiliate links, no "premium tier coming soon",
  no newsletter signup. If a paid tier ever exists, this thread needs rethinking
  before it gets updated.
- **Never imply GGG involvement.** Keep the non-affiliation line in the post.
  Do not use GGG logos or the Path of Exile wordmark as a site logo, and do not
  describe the tool as "official", "partnered" or "approved".
- **No hype vocabulary.** No "revolutionary", "game-changing", "insane profits",
  "the only tool you need". The forum audience reads that as an ad and stops
  reading. The post above is deliberately duller than it could be.
- **No emoji, no images-only post.** A wall of icons reads as marketing. Plain
  text is the house style there.
- **Do not bump.** The thread's whole value is that it stays alive for years.
  Reply when there is something real to say (a new league is live, a feature
  landed, someone asked a question) and never just to move it up the list.
- **Answer everything.** A tool thread with unanswered questions from two months
  ago is worse than no thread. Budget a few minutes a week for it.

---

## Maintenance

- Update the currency-page count (628 as of 2026-09-03) only if it is re-checked
  — `curl -s https://exileradar.com/sitemap.xml | grep -c '/poe2/currencies/'`.
- Update the league list in the post when leagues change. Forbidden Rites
  (0.5.5) launches 2026-09-04 20:00 UTC and both it and Runes of Aldur run until
  the 1.0 release, announced for 2026-12-11 — so after launch day the PoE2 line
  should read "Forbidden Rites, Runes of Aldur, their hardcore versions,
  Standard, Hardcore".
- Post the thread **before** the Reddit push, not after. It is the durable
  reference the Reddit thread can point at once the Reddit thread is buried.
