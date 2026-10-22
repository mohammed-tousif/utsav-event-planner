import type { ReactNode } from 'react';

interface NoticeProps {
  tone: 'info' | 'warn' | 'error' | 'success';
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  live?: boolean;
}

const ICONS: Record<NoticeProps['tone'], string> = {
  info: 'M12 8h.01M11 12h1v4h1',
  warn: 'M12 9v4m0 4h.01',
  error: 'M15 9l-6 6m0-6l6 6',
  success: 'M8 12.5l3 3 5-6',
};

/** Status message. Tone is carried by an icon and title, never colour alone. */
export function Notice({ tone, title, children, action, live = false }: NoticeProps) {
  return (
    <div className={`notice notice-${tone}`} role={live ? (tone === 'error' ? 'alert' : 'status') : undefined}>
      <svg className="notice-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d={ICONS[tone]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="notice-body">
        {title && <p className="notice-title">{title}</p>}
        <div>{children}</div>
        {action && <div className="notice-action">{action}</div>}
      </div>
    </div>
  );
}
