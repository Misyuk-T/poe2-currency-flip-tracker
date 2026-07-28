Subject: Re: OAuth application request — PoE2 Flip Helper (service:leagues, service:leagues:ladder)

Hi Grinding Gear Games team,

Thanks again for the reply about the Currency Exchange API. Moving to the public
CDN worked well, and it meant the OAuth application I had applied for was no
longer needed at the time — so as far as I can tell it was never created, and I
have no client credentials.

The site has since grown and now has two features that do need OAuth, so I would
like to pick that application back up. It runs here:

https://exileradar.com/poe2

Here are the OAuth details for the application:

PoE account: Artorio#0429
Application name: PoE2 Flip Helper
Client type: Confidential Client
Grant type: Client Credentials
Requested scope: service:leagues, service:leagues:ladder

Both are service scopes used with client_credentials — no account scope, and no
player sign-in anywhere in the application.

What I would use them for:

  service:leagues — the league list is currently hardcoded in my configuration,
  so a new league doesn't appear in the tool until I redeploy. This scope lets me
  pick leagues up automatically along with their start and end dates, and show
  players how far into the league they are.

  service:leagues:ladder — I'd like to show aggregate top-1000 ladder progression
  (median level and levelling pace) next to the currency data, as context for how
  mature the league's economy is. Snapshots would be stored server-side, but only
  aggregate metrics would be exposed in the UI or my public API — no character
  names, account names or individual entries.

To be clear about status: neither integration is built yet — credentials are the
prerequisite. Once enabled, both would run as scheduled backend jobs.
`GET /league?realm=poe2&type=main` roughly once a day. For each supported PoE2
league, the top 1,000 ladder entries roughly every six hours, which is two
requests of up to 500 entries. Results would be written to my own database and
the site would read that cache, so visitor traffic would never reach your API.

On compliance:
  - Rate-limit headers are already parsed and followed in the existing API
    client: it reads X-Rate-Limit-{rule} and -State on every response and
    honours Retry-After, falling back to the largest remaining penalty when that
    header is absent.
  - The User-Agent will follow the documented format,
    OAuth {client_id}/0.1.0 (contact: misyuktaras@gmail.com), using the client
    id you issue.
  - The required notice — "This product isn't affiliated with or endorsed by
    Grinding Gear Games in any way." — is displayed in the site footer on every
    page.
  - The client secret and service token would live server-side only and never
    reach the browser.

This remains a read-only, non-commercial web application with no subscription or
paywall, and no interaction with the game client.

I realise the developer documentation currently says new applications aren't
being processed. If that still applies, I'm happy to wait — I'd just like the
request on record.

Best regards,
Taras Misyuk
misyuktaras@gmail.com
