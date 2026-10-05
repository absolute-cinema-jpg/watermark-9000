import { useEffect, useMemo, useRef, useState } from 'react';

const FALLBACK = [
  'Helvetica Neue',
  'Helvetica',
  'Arial',
  'Arial Black',
  'Avenir Next',
  'Avenir',
  'Futura',
  'Gill Sans',
  'Menlo',
  'Monaco',
  'Courier New',
  'SF Mono',
  'Andale Mono',
  'Georgia',
  'Times New Roman',
  'Baskerville',
  'Didot',
  'Optima',
  'Impact',
  'Verdana',
  'Trebuchet MS',
  'DIN Alternate',
  'DIN Condensed',
  'Chalkboard',
  'American Typewriter',
  'Copperplate',
];

let fontCache = null;

async function loadFonts() {
  if (fontCache) return fontCache;
  try {
    if (window.queryLocalFonts) {
      const fonts = await window.queryLocalFonts();
      const fams = [...new Set(fonts.map((f) => f.family))].filter((f) => f && !f.startsWith('.')).sort((a, b) => a.localeCompare(b));
      if (fams.length) {
        fontCache = fams;
        return fams;
      }
    }
  } catch (e) {
    console.warn('queryLocalFonts failed', e);
  }
  fontCache = FALLBACK.filter((f) => document.fonts.check(`12px "${f}"`)).sort();
  return fontCache;
}

export function FontPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [fonts, setFonts] = useState(fontCache || FALLBACK);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const ref = useRef();
  const listRef = useRef();

  useEffect(() => {
    if (!open) return;
    loadFonts().then(setFonts);
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? fonts.filter((f) => f.toLowerCase().includes(s)) : fonts;
  }, [fonts, q]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const idx = filtered.indexOf(value);
    if (idx >= 0 && !q) {
      setHl(idx);
      const el = listRef.current.children[idx];
      el && el.scrollIntoView({ block: 'center' });
    }
  }, [open, filtered.length]);

  const pick = (f) => {
    onChange(f);
    setOpen(false);
    setQ('');
  };

  return (
    <div className="fontpick" ref={ref} style={{ flex: 1, minWidth: 0 }}>
      <button className="select trigger" style={{ fontFamily: `"${value}"` }} onClick={() => setOpen(!open)}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
      </button>
      {open && (
        <div className="menu">
          <input
            className="input"
            autoFocus
            placeholder={`Search ${fonts.length} fonts…`}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHl(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHl((h) => Math.min(filtered.length - 1, h + 1));
                listRef.current?.children[hl + 1]?.scrollIntoView({ block: 'nearest' });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHl((h) => Math.max(0, h - 1));
                listRef.current?.children[hl - 1]?.scrollIntoView({ block: 'nearest' });
              } else if (e.key === 'Enter' && filtered[hl]) pick(filtered[hl]);
              else if (e.key === 'Escape') setOpen(false);
            }}
          />
          <div className="list" ref={listRef}>
            {filtered.map((f, i) => (
              <div key={f} className={`opt ${i === hl ? 'hl' : ''} ${f === value ? 'cur' : ''}`} style={{ fontFamily: `"${f}"` }} onMouseEnter={() => setHl(i)} onClick={() => pick(f)}>
                {f}
              </div>
            ))}
            {!filtered.length && <div className="hint" style={{ padding: 10 }}>No fonts match</div>}
          </div>
        </div>
      )}
    </div>
  );
}
