// Run before styles load so a saved light/dark palette does not flash the default.
try {
  const theme = localStorage.getItem('cc.theme');
  if (theme && /^[a-z0-9-]{1,40}$/.test(theme)) document.documentElement.dataset.theme = theme;
} catch { /* Storage is optional; the default palette remains usable. */ }
