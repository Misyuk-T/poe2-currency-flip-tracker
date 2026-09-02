// League-specific facts for the evergreen /guides/league-start-currency page.
// The page itself is written to apply to any league start; everything that goes
// stale lives here, so refreshing for a new league is a one-file edit.
//
// House rule: every field below must be traceable to an official GGG post, and
// nothing here may assert a price, a ratio or a market outcome. Sources:
//   announcement  — https://www.pathofexile.com/forum/view-thread/3999858
//   press release — https://www.pathofexile.com/forum/view-thread/3999865
//   event FAQ     — https://www.pathofexile.com/forum/view-thread/4000430
export const currentLeague = {
  name: "Forbidden Rites",
  version: "0.5.5",
  // FAQ: "Forbidden Rites begins at 1PM PDT on September 4th, which is
  // Sep 04, 2026 11:00 PM (GMT+3) in your local time." 23:00 GMT+3 = 20:00 UTC.
  startsOn: "4 September 2026",
  startsAt: "1 PM PDT",
  startsAtUtc: "20:00 UTC",
  startsAtIso: "2026-09-04T20:00:00Z",
  // FAQ: "Forbidden Rites will run until the 1.0 full release and will end
  // alongside Runes of Aldur." The announcement dates 1.0 to December 11.
  endsWith: "the 1.0 full release",
  // The previous league keeps running in parallel rather than being replaced.
  parallelLeague: "Runes of Aldur",
  source: "https://www.pathofexile.com/forum/view-thread/3999858",
  pressSource: "https://www.pathofexile.com/forum/view-thread/3999865",
  faqSource: "https://www.pathofexile.com/forum/view-thread/4000430",
};

export const faqs = [
  {
    q: "What currency should I buy at league start in PoE2?",
    a: "There is no single right answer, and anyone who names one is guessing. In mechanism terms, the currencies that are safest to hold early are the ones everybody produces and consumes — the everyday crafting orbs — because you can actually get out of them again. The riskiest are the ones carrying the biggest early scarcity premium, since that premium tends to erode as supply catches up. Decide from the liquidity and hourly range you can see, not from a prediction.",
  },
  {
    q: "Is league start a good time to flip currency in PoE2?",
    a: "League start is when prices move most, and that cuts both ways: wider swings mean more opportunity and a higher chance of being stuck holding something thin that nobody is buying yet. If you trade early, size positions against how liquid the market is rather than against how far it has moved.",
  },
  {
    q: "Why do PoE2 currency prices swing so much on day 1?",
    a: "Supply of everything starts at zero and arrives at different speeds, demand is concentrated on the same handful of progression items, and very few trades have happened. When a market has only a few trades in it, each one moves the quoted range a long way — so early prices are a market being discovered, not a settled market being nudged.",
  },
  {
    q: "When do PoE2 currency prices stabilise after a league launch?",
    a: "There is no fixed day. Prices generally steady as supply catches up with the front-loaded demand, which happens sooner for common bulk currencies and later for high-value endgame ones. Rather than waiting for a date, watch for the 24h move to shrink and the hourly low/high range to narrow on the markets you care about.",
  },
  {
    q: "Does this tracker have data on day 1 of a new league?",
    a: "It follows the official hourly currency exchange feed, so a new league is covered once it is published there and the tracker is pointed at it. Expect the first day to be thin: fewer samples per hour and wider low/high ranges. Treat those early readings as low-confidence context and confirm any price in game.",
  },
  {
    q: "Which league does this guide cover?",
    a: `It is written to apply to any Path of Exile 2 league start. The league start it was last updated for is ${currentLeague.name} (${currentLeague.version}), which GGG announced for ${currentLeague.startsOn} at ${currentLeague.startsAt} (${currentLeague.startsAtUtc}). It is an event league with its own fresh economy, and the existing ${currentLeague.parallelLeague} league keeps running alongside it rather than being replaced — GGG has said ${currentLeague.name} runs until ${currentLeague.endsWith} and ends alongside ${currentLeague.parallelLeague}. So there are two live economies to keep apart when you read a price. The mechanics described here are meant to carry over to whatever launches after that.`,
  },
];
