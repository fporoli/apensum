import { useEffect, useRef, useState } from 'react';
import { TextField, type SxProps, type Theme } from '@mui/material';
import { useI18n } from './i18n';
import { formatClockTime, formatDurationInput, parseClockTime, parseDuration } from './timeInput';

interface FreeTextProps<T> {
  label: string;
  value: T | null;
  /** The parsed value, or `null` while the text is empty or not readable. */
  onChange: (value: T | null) => void;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Shown under the field when there is no error (e.g. the computed end time). */
  helperText?: string;
  sx?: SxProps<Theme>;
}

/**
 * A text field the user types freely into; it parses on each keystroke (so the parent's value is
 * always current) and rewrites the text in its normal form when the field loses focus.
 */
function FreeTextField<T>({
  label, value, onChange, required, disabled, autoFocus, helperText, sx,
  parse, format, hint, invalidText,
}: FreeTextProps<T> & { parse: (text: string) => T | null | undefined; format: (value: T) => string; hint: string; invalidText: string }) {
  const [text, setText] = useState(value === null ? '' : format(value));
  const focused = useRef(false);
  // Only text the user typed is rewritten on blur; a value computed elsewhere is shown as it is.
  const typed = useRef(false);
  // A value set from outside (a preset, another field) replaces the text unless the user is typing.
  useEffect(() => {
    if (!focused.current) setText(value === null ? '' : format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const parsed = parse(text);
  // An empty required field is not flagged here: the form's save button stays disabled instead.
  const invalid = parsed === undefined;
  return (
    <TextField
      label={label}
      size="small"
      value={text}
      required={required}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder={hint}
      error={invalid}
      helperText={invalid ? invalidText : (helperText ?? ' ')}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        if (!typed.current) return;
        typed.current = false;
        const p = parse(text);
        if (p !== undefined) setText(p === null ? '' : format(p));
      }}
      onChange={(e) => {
        typed.current = true;
        setText(e.target.value);
        const p = parse(e.target.value);
        onChange(p === undefined ? null : p);
      }}
      slotProps={{ htmlInput: { autoComplete: 'off', spellCheck: false }, inputLabel: { shrink: true } }}
      sx={sx}
    />
  );
}

/** Duration in minutes, typed as `8h`, `8:10`, `45m`, `1.5h`; rounded to 5 minutes. */
export function DurationField(props: FreeTextProps<number>) {
  const { t } = useI18n();
  return (
    <FreeTextField
      {...props}
      parse={parseDuration}
      format={formatDurationInput}
      hint={t('time.durationHint')}
      invalidText={t('time.durationInvalid')}
    />
  );
}

/** Time of day as "HH:mm", typed as `9:45`, `945`, `1800` or `9`. */
export function ClockTimeField(props: FreeTextProps<string>) {
  const { t } = useI18n();
  return (
    <FreeTextField
      {...props}
      parse={(text) => {
        const m = parseClockTime(text);
        return m === null || m === undefined ? m : formatClockTime(m);
      }}
      format={(v) => v}
      hint={t('time.clockHint')}
      invalidText={t('time.clockInvalid')}
    />
  );
}
