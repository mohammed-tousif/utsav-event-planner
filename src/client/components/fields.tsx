import { useId, type ReactNode } from 'react';

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label, control, hint and error wired together for assistive tech. */
export function Field({ label, hint, error, optional, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field" data-invalid={error ? true : undefined}>
      <label htmlFor={id} className="field-label">
        {label}
        {optional && <span className="field-optional"> (optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface ChoiceGroupProps<T extends string> {
  legend: string;
  hint?: string;
  error?: string;
  type: 'radio' | 'checkbox';
  options: readonly T[];
  labels: Record<T, string>;
  value: readonly T[];
  onChange: (value: T[]) => void;
  max?: number;
  name: string;
  optional?: boolean;
}

/** Radio or checkbox group rendered as selectable pills. */
export function ChoiceGroup<T extends string>({
  legend,
  hint,
  error,
  type,
  options,
  labels,
  value,
  onChange,
  max,
  name,
  optional,
}: ChoiceGroupProps<T>) {
  const id = useId();
  const atMax = max !== undefined && value.length >= max;
  return (
    <fieldset
      className="field choice-group"
      data-invalid={error ? true : undefined}
      aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].join(' ').trim() || undefined}
    >
      <legend className="field-label">
        {legend}
        {optional && <span className="field-optional"> (optional)</span>}
      </legend>
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      <div className="pills">
        {options.map((option) => {
          const checked = value.includes(option);
          return (
            <label key={option} className="pill" data-checked={checked || undefined}>
              <input
                type={type}
                name={name}
                value={option}
                checked={checked}
                disabled={type === 'checkbox' && !checked && atMax}
                onChange={(event) => {
                  if (type === 'radio') onChange([option]);
                  else onChange(event.target.checked ? [...value, option] : value.filter((v) => v !== option));
                }}
              />
              <span>{labels[option]}</span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
