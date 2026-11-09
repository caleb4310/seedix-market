"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(id);
  }, [message]);

  return (
    <ToastContext.Provider value={setMessage}>
      {children}
      {message ? (
        <div className="toast" role="status">
          {message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}
