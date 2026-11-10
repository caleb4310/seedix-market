"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Tone = "error" | "status";

type Item = { id: number; message: string; tone: Tone };

type Push = (message: string, tone?: Tone) => void;

const ToastContext = createContext<Push>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback<Push>((message, tone = "status") => {
    const text = message.trim();
    if (!text) return;
    const id = next.current++;
    setItems((current) => [...current.slice(-4), { id, message: text, tone }]);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: Item; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const id = window.setTimeout(() => onDismiss(item.id), 5200);
    return () => window.clearTimeout(id);
  }, [item.id, onDismiss]);
  return (
    <div className="toast" role={item.tone === "error" ? "alert" : "status"} data-tone={item.tone}>
      <p>{item.message}</p>
      <button type="button" className="toast-close" onClick={() => onDismiss(item.id)} aria-label="Dismiss">
        Close
      </button>
    </div>
  );
}

export function useToast(): Push {
  return useContext(ToastContext);
}
