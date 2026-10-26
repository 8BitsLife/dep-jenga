import { motion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { RISK_COLOR, SEV_META } from '../lib/severity';
import { sfx } from '../lib/sound';
import type { Severity } from '../lib/types';

/** Keyboard-keycap button: physical travel on press, lights up when its shortcut is hit. */
export function Key({
  children,
  onClick,
  active,
  hotkey,
  title,
  tone = 'default',
  className = '',
  disabled,
  pitch = 1,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  hotkey?: string;
  title?: string;
  tone?: 'default' | 'primary' | 'danger' | 'ghost';
  className?: string;
  disabled?: boolean;
  pitch?: number;
}) {
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (!hotkey) return;
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === hotkey.toLowerCase()) {
        setPressed(true);
        setTimeout(() => setPressed(false), 140);
      }
    };
    window.addEventListener('depjenga:key', on);
    return () => window.removeEventListener('depjenga:key', on);
  }, [hotkey]);
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={`key key-${tone} ${active ? 'is-active' : ''} ${pressed ? 'is-pressed' : ''} ${className}`}
      onPointerEnter={() => sfx.tick(1.3)}
      onClick={() => {
        sfx.pop(pitch);
        onClick?.();
      }}
    >
      {children}
      {hotkey && <kbd className="key-hint">{hotkey}</kbd>}
    </button>
  );
}

export function SevChip({ severity, count, small }: { severity: Severity; count?: number; small?: boolean }) {
  const m = SEV_META[severity];
  return (
    <span className={`sev-chip ${small ? 'sm' : ''} sev-${severity.toLowerCase()}`} style={{ ['--sev' as string]: m.color }}>
      <span className="sev-dot" />
      {m.label}
      {count != null && <b>{count}</b>}
    </span>
  );
}

export function Unavailable({ children }: { children: ReactNode }) {
  return <span className="unavailable" title="Data unavailable — not estimated">{children}</span>;
}

/** Animated radial gauge. value=null renders a hatched "no data" ring. */
export function Ring({ value, size = 120, stroke = 10, color, label, sub }: { value: number | null; size?: number; stroke?: number; color: string; label: ReactNode; sub?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="3" height="6" fill="rgba(255,255,255,0.12)" />
          </pattern>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={value == null ? 'url(#hatch)' : 'rgba(255,255,255,0.07)'} strokeWidth={stroke} fill="none" />
        {value != null && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(100, value)) / 100) }}
            transition={{ type: 'spring', stiffness: 40, damping: 14, delay: 0.2 }}
            style={{ filter: `drop-shadow(0 0 8px ${color})` }}
          />
        )}
      </svg>
      <div className="ring-label">
        <div className="ring-value">{label}</div>
        {sub && <div className="ring-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function RiskBar({ score }: { score?: number }) {
  if (score == null) return <Unavailable>no data</Unavailable>;
  return (
    <span className="riskbar">
      <span className="riskbar-track">
        <motion.span className="riskbar-fill" style={{ background: RISK_COLOR(score) }} initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ type: 'spring', stiffness: 80, damping: 16 }} />
      </span>
      <b style={{ color: RISK_COLOR(score) }}>{score}</b>
    </span>
  );
}

export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      setV(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{v}</>;
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`copy-btn ${done ? 'done' : ''}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        sfx.pop(1.4);
        setDone(true);
        setTimeout(() => setDone(false), 1300);
      }}
    >
      {done ? 'Copied ✓' : label}
    </button>
  );
}

export const fmtDate = (iso?: string) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const ecoIcon = (eco: string) =>
  ({ npm: '⬢', PyPI: '🐍', Go: '◎', 'crates.io': '⚙', Maven: '☕', RubyGems: '◆', Packagist: '🐘', NuGet: '◈' })[eco] ?? '▣';
