export function Tabs<T extends string>({
  label,
  value,
  onChange,
  options,
  size = "md",
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: { id: T; label: string }[];
  size?: "md" | "sm";
}) {
  return (
    <div className={size === "sm" ? "tabs-sm" : "tabs"} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          data-on={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
