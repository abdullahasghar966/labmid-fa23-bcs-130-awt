export function StatusBadge({ status }) {
  return <span className={`badge status-${status}`}>{status}</span>;
}

export const formatDate = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export const formatMoney = (n) =>
  Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
