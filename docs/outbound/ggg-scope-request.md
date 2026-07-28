Subject: Re: OAuth application request — PoE2 Flip Helper

Hi Grinding Gear Games team,

Thanks for letting me know the Currency Exchange API went public through the CDN.
That covered what I needed at the time, so the OAuth application never ended up
being created and I don't have any credentials.

The site has grown since then and two new features do need OAuth, so I'd like to
pick the application back up.

Here are the OAuth details for the application:

PoE account: Artorio#0429
Application name: PoE2 Flip Helper
Client type: Confidential Client
Grant type: Client Credentials
Requested scope: service:leagues, service:leagues:ladder

The site is now live on real Currency Exchange data here:

https://exileradar.com/poe2

I need service:leagues because my league list is hardcoded in config right now,
so a new league doesn't show up until I redeploy. With it I can pick up leagues
and their start and end dates automatically, and show players how far into the
league they are.

service:leagues:ladder is for a small panel showing aggregate top-1000
progression, median level and levelling pace, as context for how mature the
league economy is. I'd store the snapshots server-side but only show aggregates.
No character names, account names, or individual entries.

Neither feature is built yet, credentials are the blocker. When they are, both
would run as backend jobs on a schedule: the league list about once a day, and
the ladder about every six hours per league, which is two requests of 500
entries. Everything gets cached in my own database and the site reads from that,
so visitor traffic won't hit your API.

Same commitments as before. The integration is read-only, with no gameplay
automation, no game client interaction, and no market actions. It stays a
non-commercial hobby project with no subscription or paywall. My API client
already parses the rate-limit headers and honours Retry-After, the required
third-party notice is in the site footer, and the User-Agent will use whatever
client id you issue. The secret would stay server-side.

I saw the docs say new applications aren't being processed at the moment. If
that's still the case I'm happy to wait, I'd just like the request on record.

Best regards,
Taras Misyuk
misyuktaras@gmail.com
