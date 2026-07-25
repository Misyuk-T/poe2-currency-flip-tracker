"use client";

import { useEffect, useState } from "react";
import { mockCharacterInventory, valueInventoryInExalted } from "../lib/ggg-demo.js";
import { convertMarketPrice } from "../lib/price-guidance.js";
import { displayDigits, fallbackIconUrl, formatNumber, iconUrl, titleize } from "../lib/market.js";

function onIconError(event) {
  const img = event.currentTarget;
  if (img.src.endsWith("_fallback.svg")) return;
  img.onerror = null;
  img.src = fallbackIconUrl;
}

const TOTAL_UNITS = [
  { id: "exalted", label: "Exalted" },
  { id: "chaos", label: "Chaos" },
  { id: "divine", label: "Divine" },
];

/**
 * Demo of BACKLOG.md T8/T9 ("currency in your pocket" via `account:characters`,
 * realm=poe2). No real GGG OAuth login happens here — clicking Connect just
 * loads a fixed demo character (lib/ggg-demo.js) and prices its currency
 * stacks against the CURRENT live radar rates, so the pricing itself is real
 * even though the character/inventory is not.
 */
export default function PocketValuator({ league, rates }) {
  const [open, setOpen] = useState(false);
  const character = open && league ? mockCharacterInventory(league) : null;
  const valuation = character ? valueInventoryInExalted(character.currency, rates) : null;
  const totals = TOTAL_UNITS.map((unit) => ({
    ...unit,
    value: valuation?.totalExalted != null ? convertMarketPrice(valuation.totalExalted, "exalted", unit.id, rates) : null,
  }));

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <section className="pocket-valuator" aria-labelledby="pocket-valuator-title">
      <div className="key-currencies-heading">
        <div>
          <p className="eyebrow">account:characters · realm=poe2</p>
          <h3 id="pocket-valuator-title">
            Currency in your pocket <span className="demo-badge inline"><b className="demo-tag">DEMO</b></span>
          </h3>
        </div>
        <button type="button" className="pocket-connect-button" onClick={() => setOpen(true)}>
          Connect PoE Account (Demo)
        </button>
      </div>
      <p className="pocket-valuator-note">
        Simulates a player logging in with their own GGG account (pending OAuth scope T1) and reading their active
        character&apos;s inventory — never another player&apos;s stash. Click Connect for a demo character priced
        against the market rates on this page right now.
      </p>

      {open && character && (
        <div className="rt-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="pocket-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Inventory valuation"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pocket-modal-head">
              <div>
                <p className="pocket-character-line">
                  <strong>{character.name}</strong> · {character.class} · Level {character.level} · {character.league}
                </p>
                <p className="eyebrow">What you have, best current rate, and what it&apos;s worth</p>
              </div>
              <button type="button" className="trade-close-button" aria-label="Close" title="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>

            <div className="pocket-valuator-rows">
              {valuation.items.map((item) => (
                <div className="pocket-row" key={item.id}>
                  <img src={iconUrl(item.id)} onError={onIconError} alt="" />
                  <span className="pocket-row-name">{formatNumber(item.stackSize, { maximumFractionDigits: 0 })}× {titleize(item.id)}</span>
                  <span className="pocket-row-rate">
                    {Number.isFinite(rates?.[item.id])
                      ? `${formatNumber(rates[item.id], { maximumFractionDigits: displayDigits(rates[item.id]) })} ex/unit`
                      : "no live rate"}
                  </span>
                  <strong className="pocket-row-value">
                    {Number.isFinite(item.exaltedValue)
                      ? `≈ ${formatNumber(item.exaltedValue, { maximumFractionDigits: displayDigits(item.exaltedValue) })} ex`
                      : "unpriceable"}
                  </strong>
                </div>
              ))}
            </div>

            <div className="pocket-totals">
              <span>Total carried</span>
              <div className="pocket-totals-values">
                {totals.map((unit) => (
                  <strong key={unit.id}>
                    {unit.value != null ? formatNumber(unit.value, { maximumFractionDigits: unit.id === "exalted" ? 0 : 2 }) : "—"}
                    <small> {unit.label}</small>
                  </strong>
                ))}
              </div>
            </div>
            <p className="pocket-valuator-note">
              Character/inventory data is mocked (BACKLOG T8/T9, pending T1). Pricing uses this page&apos;s real,
              currently-live market rates — nothing about the conversion itself is fabricated.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
