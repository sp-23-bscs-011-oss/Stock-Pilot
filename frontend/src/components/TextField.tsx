import { useId, useState, type InputHTMLAttributes } from "react";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  error?: string;
  hint?: string;
  /** Adds a show/hide toggle to password fields. */
  revealable?: boolean;
}

export function TextField({ label, error, hint, revealable, type = "text", ...inputProps }: TextFieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  const input = (
    <input
      id={id}
      type={revealable && revealed ? "text" : type}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      {...inputProps}
    />
  );

  return (
    <div className="form__field">
      <label htmlFor={id}>{label}</label>
      {revealable ? (
        <div className="form__input-group">
          {input}
          <button
            type="button"
            className="form__reveal"
            onClick={() => setRevealed((value) => !value)}
            aria-pressed={revealed}
            aria-label={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          >
            {revealed ? "Hide" : "Show"}
          </button>
        </div>
      ) : (
        input
      )}
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
