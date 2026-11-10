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

  return (
    <div className="combo" ref={box}>
      <input
        className="combo-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Backing token"
        placeholder={selected ? `${selected.symbol} — ${selected.name}` : "Search a backing token"}
        value={open ? query : selected ? `${selected.symbol} — ${selected.name}` : ""}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setActive(0);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(shown.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter" && open && shown[active]) {
            event.preventDefault();
            choose(shown[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open ? (
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
      ) : null}
    </div>
  );
}
