Subject: Re: OAuth application request — PoE2 Flip Helper (additional service scopes)

Hi Grinding Gear Games team,

Thanks for the reply about the Currency Exchange API. I've switched the
application over to the public CDN endpoint. The site now uses official
completed-hour Currency Exchange data and has moved to its own domain:

https://exileradar.com/poe2

I'd like to request two additional scopes on the same application. Here are the
OAuth details:

PoE account: Artorio#0429
Application name: PoE2 Flip Helper
Client type: Confidential Client
Grant type: Client Credentials
Requested scope: service:leagues, service:leagues:ladder

The application already holds service:cxapi from the earlier request. It is no
longer used — Currency Exchange data now comes from the public CDN — so please
feel free to drop it if that is tidier on your side.

Both requested scopes are service scopes for confidential clients using
client_credentials, so no change to the client type or grant is needed, and no
account scope or player sign-in is involved.

What I would use them for:

  service:leagues — the league list is currently hardcoded in my configuration,
  so a new league doesn't appear in the tool until I redeploy. This scope lets
  me pick leagues up automatically along with their start and end dates, and
  show players how far into the league they are.

  service:leagues:ladder — I'd like to show aggregate top-1000 ladder
  progression (median level and levelling pace) next to the currency data, as
  context for how mature the league's economy is. Snapshots would be stored
  server-side, but only aggregate metrics would be exposed in the UI or my
  public API — no character names, account names or individual entries.

To be clear about status: neither integration is built yet — approval is the
prerequisite. Once enabled, both would run as scheduled backend jobs.
`GET /league?realm=poe2&type=main` roughly once a day. For each supported PoE2
league, the top 1,000 ladder entries roughly every six hours, which is two
requests of up to 500 entries. Results would be written to my own database and
the site would read that cache, so visitor traffic would never reach your API.

Compliance:
  - User-Agent follows the documented format:
    OAuth {client_id}/0.1.0 (contact: misyuktaras@gmail.com)
  - Rate-limit headers are parsed and followed: the client reads
    X-Rate-Limit-{rule} and -State on every response and honours Retry-After,
    falling back to the largest remaining penalty when that header is absent.
  - The required notice — "This product isn't affiliated with or endorsed by
    Grinding Gear Games in any way." — is displayed in the site footer on every
    page.
  - The client-credentials flow would run entirely on the backend; the secret
    and the service token would never reach the browser.

This remains a read-only, non-commercial web application with no subscription
or paywall, and no interaction with the game client.

Best regards,
Taras Misyuk
misyuktaras@gmail.com
