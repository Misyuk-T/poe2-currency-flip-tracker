/**
 * Presentation taxonomy layered on top of GGG's flat trade categories.
 * GGG exposes e.g. all 206 runes as one "Runes" category; stable item-name
 * families let us preserve the progression players recognise in-game.
 */
export function catalogTaxonomy({ name = "", category = "" } = {}) {
  const n = name.normalize("NFKD");
  const tier = numberIn(n, /(?:Level|Tier)\s+(\d+)/i);

  if (category === "Runes") {
    if (/^Lesser /.test(n)) return result("Lesser runes", 10, n);
    if (/^Greater (?!Rune of )/.test(n)) return result("Greater runes", 30, n);
    if (/^Perfect /.test(n)) return result("Perfect runes", 40, n);
    if (/^(?:Desert|Glacial|Storm|Iron|Body|Mind|Rebirth|Inspiration|Stone|Vision|Robust|Adept|Resolve|Ward|Charging) Rune$/.test(n)) return result("Standard runes", 20, n);
    if (/^Warding Rune /.test(n)) return result("Warding runes", 60, n);
    if (/^Ancient Rune /.test(n)) return result("Ancient runes", 70, n);
    if (/^Legacy of /.test(n)) return result("Legacy runes", 80, n);
    return result("Special runes", 50, n);
  }
  if (category === "Essences") {
    if (/^Lesser /.test(n)) return result("Lesser essences", 10, n);
    if (/^Greater /.test(n)) return result("Greater essences", 30, n);
    if (/^Perfect /.test(n)) return result("Perfect essences", 40, n);
    if (/^Essence of (?:Hysteria|Delirium|Horror|Insanity|the Abyss|the Breach)$/.test(n)) return result("Special essences", 50, n);
    return result("Standard essences", 20, n);
  }
  if (category === "Currency") {
    if (/ Shard$/.test(n)) return result("Shards", 50, n);
    if (/Jeweller's Orb$/.test(n)) return result("Jeweller's orbs", 40, n);
    if (/^Greater /.test(n)) return result("Greater currency", 20, n);
    if (/^Perfect /.test(n)) return result("Perfect currency", 30, n);
    return result("Core currency", 10, n);
  }
  if (category === "Fragments") {
    if (/Reliquary Key/.test(n)) return result("Reliquary keys", 50, n);
    if (/Crisis Fragment/.test(n)) return result("Crisis fragments", 20, n);
    if (/^Origin /.test(n)) return result("Origin fragments", 30, n);
    if (/ Fate$/.test(n)) return result("Fate fragments", 40, n);
    return result("Invitations & splinters", 10, n);
  }
  if (category === "Expedition") {
    if (/ Saga$/.test(n)) return result("Sagas", 20, n);
    if (/^Thaumaturgic Flux/.test(n)) return result("Thaumaturgic flux", 40, n, tier);
    if (/^(?:Blazing|Chilling|Crackling|Void) Flux$/.test(n)) return result("Elemental flux", 30, n);
    if (/^Perfect Flux$/.test(n)) return result("Perfect flux", 50, n);
    if (/^Emergent /.test(n)) return result("Emergent currency", 60, n);
    if (/^Carved /.test(n)) return result("Carved currency", 70, n);
    return result("Logbooks", 10, n);
  }
  if (category === "Ritual") {
    if (/^Omen /.test(n)) return result("Omens", 20, n);
    if (/^(?:Bear|Primate|Stag|Boar|Snake|Wolf|Cat|Owl|Ox|Fox|Rabbit) Idol$/.test(n)) return result("Animal idols", 30, n);
    if (/^Idol of /.test(n)) return result("Named idols", 40, n);
    return result("Invitations & splinters", 10, n);
  }
  if (category === "Breach") {
    if (/^Refined .* Catalyst$/.test(n)) return result("Refined catalysts", 40, n);
    if (/ Catalyst$/.test(n)) return result("Catalysts", 30, n);
    if (/Wombgift$/.test(n)) return result("Wombgifts", 20, n);
    return result("Splinters & stones", 10, n);
  }
  if (category === "Delirium") {
    if (/^Ancient /.test(n)) return result("Ancient liquids", 60, n);
    if (/^Diluted /.test(n)) return result("Diluted liquids", 20, n);
    if (/^Liquid /.test(n)) return result("Liquids", 30, n);
    if (/^Concentrated /.test(n)) return result("Concentrated liquids", 40, n);
    if (/^Potent /.test(n)) return result("Potent liquids", 50, n);
    return result("Simulacrum", 10, n);
  }
  if (category === "Vaal") {
    if (/^[^']+'s Soul Core /.test(n)) return result("Named soul cores", 40, n);
    if (/^Soul Core /.test(n)) return result("Soul cores", 30, n);
    if (/ Thesis$/.test(n)) return result("Theses", 20, n);
    return result("Vaal crafting", 10, n);
  }
  if (category === "Verisium") {
    if (/ Crest /.test(n)) return result("Faction crests", 20, n);
    if (/Alloy$/.test(n)) return result("Alloys", 30, n);
    if (/Starlit Ore$/.test(n)) return result("Starlit ore", 40, n);
    return result("Verisium", 10, n);
  }
  if (category === "Abyssal Bones") {
    if (/Gaze$/.test(n)) return result("Abyssal gazes", 50, n);
    if (/^Gnawed /.test(n)) return result("Gnawed bones", 10, n);
    if (/^Preserved /.test(n)) return result("Preserved bones", 20, n);
    if (/^Ancient /.test(n)) return result("Ancient bones", 30, n);
    return result("Altered bones", 40, n);
  }
  if (category === "Uncut Gems") {
    if (/^Uncut Support Gem/.test(n)) return result("Support gems", 10, n, tier);
    if (/^Uncut Spirit Gem/.test(n)) return result("Spirit gems", 20, n, tier);
    return result("Skill gems", 30, n, tier);
  }
  if (category === "Waystones") {
    const band = tier <= 5 ? "Tier 1–5" : tier <= 10 ? "Tier 6–10" : "Tier 11–16";
    return result(band, tier <= 5 ? 10 : tier <= 10 ? 20 : 30, n, tier);
  }
  return result(category, 10, n, tier);
}

function result(subcategory, groupOrder, name, itemOrder = null) {
  const normalizedItemOrder = Number.isFinite(itemOrder) ? itemOrder : 0;
  return { subcategory, catalogOrder: groupOrder * 1000 + normalizedItemOrder, sortName: name };
}

function numberIn(value, pattern) {
  const match = value.match(pattern);
  return match ? Number(match[1]) : null;
}
