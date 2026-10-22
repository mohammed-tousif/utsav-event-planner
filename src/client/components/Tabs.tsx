import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef<K extends string> {
  key: K;
  label: string;
  badge?: string;
}

interface TabsProps<K extends string> {
  tabs: TabDef<K>[];
  active: K;
  onChange: (key: K) => void;
  label: string;
  children: (key: K, panelProps: { id: string; 'aria-labelledby': string; role: 'tabpanel'; tabIndex: 0 }) => ReactNode;
}

/** WAI-ARIA tabs with roving tabindex and arrow, Home and End keys. */
export function Tabs<K extends string>({ tabs, active, onChange, label, children }: TabsProps<K>) {
  const base = useId();
  const refs = useRef(new Map<K, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = tabs.findIndex((t) => t.key === active);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const key = tabs[next]?.key;
    if (key) {
      onChange(key);
      refs.current.get(key)?.focus();
    }
  }

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            ref={(el) => {
              if (el) refs.current.set(tab.key, el);
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${tab.key}`}
            aria-selected={tab.key === active}
            aria-controls={`${base}-panel-${tab.key}`}
            tabIndex={tab.key === active ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={onKeyDown}
            className="tab"
          >
            {tab.label}
            {tab.badge && <span className="tab-badge">{tab.badge}</span>}
          </button>
        ))}
      </div>
      {children(active, {
        id: `${base}-panel-${active}`,
        'aria-labelledby': `${base}-tab-${active}`,
        role: 'tabpanel',
        tabIndex: 0,
      })}
    </div>
  );
}
