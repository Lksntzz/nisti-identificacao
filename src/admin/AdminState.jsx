import React from 'react';

function StateIcon({ tone }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true
  };

  if (tone === 'success') {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 2.6 2.6L16.5 9" /></svg>;
  }
  if (tone === 'error') {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></svg>;
  }
  if (tone === 'warning') {
    return <svg {...common}><path d="M10.3 3.7 2.4 17.4A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.6L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
  }
  if (tone === 'loading') {
    return <svg {...common} className="nisti-state-spinner"><path d="M21 12a9 9 0 1 1-3.2-6.9" /><path d="M21 3v6h-6" /></svg>;
  }
  if (tone === 'info') {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
  }
  return <svg {...common}><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5Z" /><path d="m4.4 7.3 7.6 4.3 7.6-4.3M12 21v-9.4" /></svg>;
}

export function AdminState({
  tone = 'empty',
  title,
  description,
  actionLabel = '',
  onAction,
  compact = false,
  className = ''
}) {
  const role = tone === 'error' ? 'alert' : tone === 'success' ? 'status' : undefined;

  return (
    <div className={`nisti-admin-state ${tone} ${compact ? 'compact' : ''} ${className}`.trim()} role={role}>
      <div className="nisti-admin-state-icon"><StateIcon tone={tone} /></div>
      <div className="nisti-admin-state-copy">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      {actionLabel && onAction && (
        <button type="button" className="nisti-admin-state-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default AdminState;
