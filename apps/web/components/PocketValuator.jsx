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
 * realm=poe2). This is NOT a real login and NOT real inventory data — no GGG
 * OAuth happens, no account is read. Clicking Connect randomly generates a
 * fake character and fake currency amounts (a new random roll every time you
 * open it) purely to demo the UI/flow ahead of the real OAuth scope (T1).
 * The ONLY real thing here is the pricing: fake amounts are converted using
 * this page's actual, currently-live market rates.
 */
export default function PocketValuator({ league, rates }) {
  const [open, setOpen] = useState(false);
  const [character, setCharacter] = useState(null);
  const valuation = character ? valueInventoryInExalted(character.currency, rates) : null;

  function connect() {
    if (!league) return;
    setCharacter(mockCharacterInventory(league)); // fresh random roll each time
    setOpen(true);
  }
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
    <div className="pocket-valuator-control">
      <span>Inventory</span>
      <button
        type="button"
        className="pocket-connect-button"
        onClick={connect}
        title="Demo only — no real login. Generates a fake character, priced against this page's live rates."
      >
        Value my currency
        <b className="demo-tag">DEMO</b>
      </button>

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
                <p className="eyebrow">Fake demo character · randomly generated · not a real account</p>
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
              <strong>None of the above is real.</strong>{" "}
              The character and the amounts are randomly generated for this demo — not read from any GGG account.
              Only the exalted/chaos/divine conversion is real, computed from this page&apos;s actual live market
              rates.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
