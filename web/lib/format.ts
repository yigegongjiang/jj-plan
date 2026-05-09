export function fmtTime(ms: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return String(ms);
  const d = new Date(ms);
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}

export function fmtRelative(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < 0) return fmtTime(ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return fmtTime(ms).slice(0, 10);
}
