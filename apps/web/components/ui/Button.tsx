import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "accent" | "ghost";

export function Button({
  variant = "primary",
  block,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; block?: boolean }) {
  const names = ["btn", variant, block ? "block" : "", className ?? ""].filter(Boolean).join(" ");
  return <button className={names} {...props} />;
}
