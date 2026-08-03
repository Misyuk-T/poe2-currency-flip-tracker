"use client";

import { useEffect, useState } from "react";
import { mockCharacterInventory, valueInventoryInExalted } from "../lib/ggg-demo.js";
import { useScrollLock } from "../lib/use-scroll-lock.js";
import { bestExitCurrency } from "../lib/exit-currency.js";
import { convertMarketPrice } from "../lib/price-guidance.js";
import { displayDigits, fallbackIconUrl, formatNumber, gameIconUrl, iconUrl, titleize } from "../lib/market.js";

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
 * OAuth happens, no account is read. Clicking the button samples random real
 * items off the live radar and invents only the QUANTITIES, purely to demo the
 * UI/flow ahead of the real OAuth scope (T1).
 *
 * Everything derived from those quantities is real arithmetic on live data:
 * the per-item worth, the exalted/chaos/divine totals, and the "best exit"
 * column (see lib/exit-currency.js — cheapest gold cost among the anchors you
 * can actually be paid in).
 */
export default function PocketValuator({ game, league, rates, pool, goldPerUnit }) {
  const [open, setOpen] = useState(false);
  const [character, setCharacter] = useState(null);
  const valuation = character ? valueInventoryInExalted(character.currency, rates) : null;
  const totals = TOTAL_UNITS.map((unit) => ({
    ...unit,
    value: valuation?.totalExalted != null ? convertMarketPrice(valuation.totalExalted, "exalted", unit.id, rates) : null,
  }));

  function connect() {
    if (!league) return;
    setCharacter(mockCharacterInventory(league, { pool })); // fresh random roll each time
    setOpen(true);
  }

  useScrollLock(open);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="pocket-valuator-control">
      <span>Inventory</span>
      <button
        type="button"
        className="pocket-connect-button"
        onClick={connect}
        title="Demo only — no real login. Samples random real items, priced against this page's live rates."
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
              <div className="pocket-row pocket-row-head" aria-hidden="true">
                <span className="pocket-row-name">Holding</span>
                <span className="pocket-row-value">Worth</span>
                <span className="pocket-row-exit">Best paid in</span>
              </div>
              {valuation.items.map((item) => {
                const { best } = bestExitCurrency(item.exaltedValue, { rates, goldPerUnit });
                return (
                  <div className="pocket-row" key={item.id}>
                    <img src={item.icon ?? iconUrl(item.id)} onError={onIconError} alt="" />
                    <span className="pocket-row-name">
                      {formatNumber(item.stackSize, { maximumFractionDigits: 0 })}× {item.name ?? titleize(item.id)}
                    </span>
                    <strong className="pocket-row-value">
                      {Number.isFinite(item.exaltedValue)
                        ? `${formatNumber(item.exaltedValue, { maximumFractionDigits: displayDigits(item.exaltedValue) })} ex`
                        : "unpriceable"}
                    </strong>
                    <span className="pocket-row-exit">
                      {best ? (
                        <>
                          <b>
                            <img src={gameIconUrl(game, best.unit)} onError={onIconError} alt="" />
                            {formatNumber(best.units, { maximumFractionDigits: displayDigits(best.units) })}{" "}
                            {titleize(best.unit)}
                          </b>
                          <small>{formatNumber(best.gold, { maximumFractionDigits: 0 })} gold to receive</small>
                        </>
                      ) : (
                        <small>too small to sell whole</small>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="pocket-totals">
              <span>Total carried</span>
              <div className="pocket-totals-values">
                {totals.map((unit) => (
                  <strong key={unit.id}>
                    <img src={gameIconUrl(game, unit.id)} onError={onIconError} alt="" />
                    {unit.value != null ? formatNumber(unit.value, { maximumFractionDigits: unit.id === "exalted" ? 0 : 2 }) : "—"}
                    <small>{unit.label}</small>
                  </strong>
                ))}
              </div>
            </div>
            <p className="pocket-valuator-note">
              <strong>The character and amounts are randomly generated</strong> — nothing is read from a GGG
              account. Item names and prices are real, from this page&apos;s live market. &ldquo;Best paid
              in&rdquo; is the currency costing the least gold to receive. Goes live once GGG grants account
              access.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
