"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ListedPair } from "@/lib/registry";
import { logoSrc } from "@/lib/logoUrl";

export function BackingCombobox({
  pairs,
  value,
  onChange,
  empty,
}: {
  pairs: ListedPair[];
  value: string;
  onChange: (address: string) => void;
  empty: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const selected = pairs.find((pair) => pair.address === value) ?? null;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return pairs;
    return pairs.filter((pair) => `${pair.symbol} ${pair.name} ${pair.address}`.toLowerCase().includes(needle));
  }, [pairs, query]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function choose(pair: ListedPair) {
    onChange(pair.address);
    setQuery("");
    setOpen(false);
  }

  if (pairs.length === 0) return <p className="note">{empty}</p>;

  const label = selected ? `${selected.symbol} — ${selected.name}` : pairs[0]?.category === "preipo" ? "Pick a pre-IPO" : "Pick a stock";
  return (
    <div className="combo" ref={box}>
      <button
        type="button"
        className="combo-button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Backing token"
        onClick={() => {
          setOpen((value) => !value);
          setQuery("");
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <span>{label}</span>
        <span className="caret" aria-hidden="true" />
      </button>
      {open ? (
        <div className="combo-pop">
          <input
            className="combo-input"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label="Search backing tokens"
            placeholder="Search symbol or name"
            value={query}
            autoFocus
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(shown.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter" && shown[active]) {
                event.preventDefault();
                choose(shown[active]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
        <ul className="combo-list" id={listId} role="listbox">
          {shown.length === 0 ? <li className="combo-empty">No matching token</li> : null}
          {shown.map((pair, index) => (
            <li key={pair.address} role="presentation">
              <button
                type="button"
                role="option"
                id={`${listId}-${index}`}
                aria-selected={pair.address === value}
                data-active={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(pair)}
              >
                <span className="combo-mark" aria-hidden="true">
                  {logoSrc(pair.logo) ? <img src={logoSrc(pair.logo) ?? ""} alt="" /> : pair.symbol.slice(0, 1)}
                </span>
                <span>
                  <strong>{pair.symbol}</strong>
                  <span>{pair.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        </div>
      ) : null}
    </div>
  );
}
