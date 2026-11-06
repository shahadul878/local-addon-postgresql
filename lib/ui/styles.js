'use strict';

/**
 * Inline styles. Local doesn't expose its component library to third-party add-ons,
 * so the panel is self-styled and uses colours that read well in Local's light and dark themes.
 */
const COLOR = Object.freeze({
  accent: '#336791', // PostgreSQL blue
  accentText: '#ffffff',
  success: '#2e9e5b',
  danger: '#c9473d',
  muted: 'rgba(127, 127, 127, 0.85)',
  border: 'rgba(127, 127, 127, 0.28)',
  surface: 'rgba(127, 127, 127, 0.06)',
  codeSurface: 'rgba(127, 127, 127, 0.12)',
});

const SPACE = Object.freeze({ xs: 4, sm: 8, md: 14, lg: 22, xl: 32 });
const RADIUS = 6;
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const styles = Object.freeze({
  panel: { padding: `${SPACE.lg}px ${SPACE.xl}px ${SPACE.xl}px`, overflowY: 'auto', height: '100%', boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.lg },
  title: { fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' },
  subtitle: { color: COLOR.muted, fontSize: 13, margin: `${SPACE.xs}px 0 0` },
  card: {
    border: `1px solid ${COLOR.border}`,
    borderRadius: RADIUS,
    background: COLOR.surface,
    padding: SPACE.lg,
    marginBottom: SPACE.lg,
  },
  cardTitle: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLOR.muted, margin: `0 0 ${SPACE.md}px` },
  row: { display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' },
  spread: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, flexWrap: 'wrap' },
  kvGrid: { display: 'grid', gridTemplateColumns: 'max-content 1fr max-content', gap: `${SPACE.sm}px ${SPACE.md}px`, alignItems: 'center' },
  kvLabel: { color: COLOR.muted, fontSize: 13 },
  code: { fontFamily: MONO, fontSize: 12.5, background: COLOR.codeSurface, padding: '3px 7px', borderRadius: 4, wordBreak: 'break-all' },
  pre: {
    fontFamily: MONO, fontSize: 12, background: COLOR.codeSurface, padding: SPACE.md, borderRadius: RADIUS,
    maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', margin: `${SPACE.md}px 0 0`,
  },
  input: {
    font: 'inherit', fontSize: 13, padding: '7px 10px', borderRadius: RADIUS, border: `1px solid ${COLOR.border}`,
    background: 'transparent', color: 'inherit', minWidth: 200,
  },
  select: { font: 'inherit', fontSize: 13, padding: '7px 10px', borderRadius: RADIUS, border: `1px solid ${COLOR.border}`, color: 'inherit', background: 'transparent' },
  list: { listStyle: 'none', margin: `0 0 ${SPACE.md}px`, padding: 0 },
  listItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `${SPACE.sm}px 0`, borderBottom: `1px solid ${COLOR.border}` },
  error: { border: `1px solid ${COLOR.danger}`, color: COLOR.danger, borderRadius: RADIUS, padding: SPACE.md, marginBottom: SPACE.lg, fontSize: 13 },
  hint: { color: COLOR.muted, fontSize: 12.5, margin: `${SPACE.sm}px 0 0` },
  progressTrack: { height: 6, borderRadius: 3, background: COLOR.codeSurface, overflow: 'hidden', marginTop: SPACE.sm },
});

function buttonStyle(variant, isDisabled) {
  const base = {
    font: 'inherit', fontSize: 13, fontWeight: 600, padding: '7px 14px', borderRadius: RADIUS,
    cursor: isDisabled ? 'default' : 'pointer', opacity: isDisabled ? 0.5 : 1, transition: 'opacity 150ms ease',
  };
  if (variant === 'primary') {
    return { ...base, background: COLOR.accent, color: COLOR.accentText, border: `1px solid ${COLOR.accent}` };
  }
  if (variant === 'danger') {
    return { ...base, background: 'transparent', color: COLOR.danger, border: `1px solid ${COLOR.danger}` };
  }
  return { ...base, background: 'transparent', color: 'inherit', border: `1px solid ${COLOR.border}` };
}

function statusPillStyle(status) {
  const color = status === 'running' ? COLOR.success : COLOR.muted;
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
    padding: '3px 10px', borderRadius: 999, border: `1px solid ${color}`, color,
  };
}

function progressFillStyle(fraction) {
  return { height: '100%', width: `${Math.round(fraction * 100)}%`, background: COLOR.accent, transition: 'width 250ms ease' };
}

module.exports = { styles, buttonStyle, statusPillStyle, progressFillStyle, COLOR, SPACE };
