'use client';

import { useState } from 'react';
import { ChevronDown, Filter } from 'lucide-react';

// Menu de filtro do design system (usado no pipeline, agenda e tarefas).
export function FilterMenu({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const active = options.find((o) => o.value === value);

  return (
    <div className="menu-anchor">
      <button
        type="button"
        className={`btn ${value !== 'all' ? 'btn-filter-active' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Filter size={15} />
        <span>{active?.label ?? label}</span>
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
      </button>

      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu" role="listbox" aria-label={ariaLabel}>
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`menu-item ${value === opt.value ? 'menu-item-active' : ''}`}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                role="option"
                aria-selected={value === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
