'use client';

import { Input } from '@base-ui/react/input';
import { Field } from '@base-ui/react/field';
import { Select } from '@base-ui/react/select';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export type SelectOption = { label: string; value: string };

export function SearchField({ label = 'Search', ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <Field.Root className="search-field">
      <Field.Label className="sr-only">{label}</Field.Label>
      <Search aria-hidden="true" size={18} />
      <Input type="search" aria-label={label} {...props} />
    </Field.Root>
  );
}

export function SelectField({ label, options, value, onValueChange, name }: {
  label: string;
  options: SelectOption[];
  value: string;
  onValueChange(value: string): void;
  name?: string;
}) {
  const labelId = useId();
  return (
    <div className="select-field">
      <span id={labelId}>{label}</span>
      <Select.Root items={options} name={name} value={value} onValueChange={(nextValue) => nextValue && onValueChange(nextValue)}>
        <Select.Trigger aria-labelledby={labelId} className="select-trigger">
          <Select.Value />
          <Select.Icon><ChevronDown aria-hidden="true" size={16} /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="select-positioner" sideOffset={6}>
            <Select.Popup className="select-popup">
              <Select.List>
                {options.map((option) => (
                  <Select.Item className="select-item" key={option.value} value={option.value}>
                    <Select.ItemText>{option.label}</Select.ItemText>
                    <Select.ItemIndicator><Check aria-hidden="true" size={15} /></Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

export function TextField({ label, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const describedBy = error ? `${props.id}-error` : hint ? `${props.id}-hint` : undefined;
  return (
    <Field.Root className="text-field" invalid={Boolean(error)}>
      <Field.Label>{label}</Field.Label>
      <Input aria-describedby={describedBy} aria-invalid={Boolean(error)} {...props} />
      {hint ? <Field.Description id={`${props.id}-hint`}>{hint}</Field.Description> : null}
      {error ? <Field.Error className="field-error" id={`${props.id}-error`}>{error}</Field.Error> : null}
    </Field.Root>
  );
}

export function TextAreaField({ label, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <Field.Root className="text-field">
      <Field.Label>{label}</Field.Label>
      <Field.Control render={<textarea {...props} />} />
    </Field.Root>
  );
}
