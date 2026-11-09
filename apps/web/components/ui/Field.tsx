import type { ReactNode } from "react";

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={className ? `field ${className}` : "field"}>
      <span className="lbl">{label}</span>
      {children}
    </label>
  );
}
