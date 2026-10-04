// Shared date formatting for the admin panel: local representation
// of an ISO instant, echoing the raw input back when unparseable.
// The caller paints the result as text.

export function formatDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso ?? "") : date.toLocaleString();
}
