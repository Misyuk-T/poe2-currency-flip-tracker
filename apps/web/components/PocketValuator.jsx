"use client";

import { useState } from "react";
import { mockCharacterInventory, valueInventoryInExalted } from "../lib/ggg-demo.js";
import { convertMarketPrice } from "../lib/price-guidance.js";
import { displayDigits, fallbackIconUrl, formatNumber, iconUrl, titleize } from "../lib/market.js";

function onIconError(event) {
  const img = event.currentTarget;
  if (img.src.endsWith("_fallback.svg")) return;
  img.onerror = null;
  img.src = fallbackIconUrl;
}

/**
 * Demo of BACKLOG.md T8/T9 ("currency in your pocket" via `account:characters`,
 * realm=poe2). No real GGG OAuth login happens here — clicking Connect just
 * loads a fixed demo character (lib/ggg-demo.js) and prices its currency
 * stacks against the CURRENT live radar rates, so the pricing itself is real
 * even though the character/inventory is not.
 */
export default function PocketValuator({ league, rates }) {
  const [connected, setConnected] = useState(false);
  const character = connected && league ? mockCharacterInventory(league) : null;
  const valuation = character ? valueInventoryInExalted(character.currency, rates) : null;
  const totalDivine = valuation?.totalExalted != null ? convertMarketPrice(valuation.totalExalted, "exalted", "divine", rates) : null;

  return (
    <section className="pocket-valuator" aria-labelledby="pocket-valuator-title">
      <div className="key-currencies-heading">
        <div>
          <p className="eyebrow">account:characters · realm=poe2</p>
          <h3 id="pocket-valuator-title">
            Currency in your pocket <span className="demo-badge inline"><b className="demo-tag">DEMO</b></span>
          </h3>
        </div>
        {!connected && (
          <button type="button" className="pocket-connect-button" onClick={() => setConnected(true)}>
            Connect PoE Account (Demo)
          </button>
        )}
      </div>

      {!connected ? (
        <p className="pocket-valuator-note">
          Simulates a player logging in with their own GGG account (pending OAuth scope T1) and reading their active
          character&apos;s inventory — never another player&apos;s stash. Click Connect to see a demo character priced
          against the market rates on this page right now.
        </p>
      ) : (
        <>
          <p className="pocket-character-line">
            <strong>{character.name}</strong> · {character.class} · Level {character.level} · {character.league}
          </p>
          <div className="pocket-valuator-rows">
            {valuation.items.map((item) => (
              <div className="pocket-row" key={item.id}>
                <img src={iconUrl(item.id)} onError={onIconError} alt="" />
                <span>{formatNumber(item.stackSize, { maximumFractionDigits: 0 })}× {titleize(item.id)}</span>
                <strong>
                  {Number.isFinite(item.exaltedValue)
                    ? `≈ ${formatNumber(item.exaltedValue, { maximumFractionDigits: displayDigits(item.exaltedValue) })} ex`
                    : "no live rate"}
                </strong>
              </div>
            ))}
          </div>
          <div className="pocket-total">
            <span>Total carried</span>
            <strong>
              {valuation.totalExalted != null
                ? `≈ ${formatNumber(valuation.totalExalted, { maximumFractionDigits: 0 })} exalted`
                : "no priceable currency"}
              {totalDivine != null ? ` (${formatNumber(totalDivine, { maximumFractionDigits: 2 })} divine)` : ""}
            </strong>
          </div>
          <p className="pocket-valuator-note">
            Character/inventory data is mocked (BACKLOG T8/T9, pending T1). Pricing uses this page&apos;s real,
            currently-live market rates — nothing about the conversion itself is fabricated.
          </p>
        </>
      )}
    </section>
  );
}
