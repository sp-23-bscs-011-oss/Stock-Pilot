import { useId, type ReactNode } from "react";

export interface FieldControlProps {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  /** Renders the control, spreading the accessibility props onto it. */
  children: (control: FieldControlProps) => ReactNode;
}

/** Label, hint and error wiring for any control (select, textarea, custom inputs). */
export function Field({ label, error, hint, className, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={className ? `form__field ${className}` : "form__field"}>
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && (
        <p id={hintId} className="form__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="form__error">
          {error}
        </p>
      )}
    </div>
  );
}
