import { useEffect, useRef, useState } from 'react';
import { I } from './icons.jsx';

export function Panel({ className = '', title, sub, actions, children, bodyClass = '', bodyProps = {} }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        {sub && <span className="sub">{sub}</span>}
        <span className="grow" />
        {actions}
      </header>
      <div className={`panel-body ${bodyClass}`} {...bodyProps}>
        {children}
      </div>
    </section>
  );
}

export function Row({ label, children, title }) {
  return (
    <div className="row" title={title}>
      <label>{label}</label>
      <div className="inline">{children}</div>
    </div>
  );
}

export function Select({ value, onChange, options, style, className = '' }) {
  return (
    <select className={`select ${className}`} style={style} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => {
        const [v, l, disabled] = Array.isArray(o) ? o : [o, o];
        return (
          <option key={v} value={v} disabled={disabled}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

export function TextInput({ value, onChange, placeholder, className = '', mono, onCommit, ...rest }) {
  return (
    <input
      className={`input ${mono ? 'mono' : ''} ${className}`}
      value={value ?? ''}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        e.stopPropagation();
      }}
      {...rest}
    />
  );
}

/** Numeric field with Resolve-style horizontal drag scrubbing on the label. */
export function NumberField({ value, onChange, min = -Infinity, max = Infinity, step = 1, precision = 1, unit, label = '⟷', style }) {
  const [text, setText] = useState(null);
  const clamp = (v) => Math.min(max, Math.max(min, v));
  const fmt = (v) => (Number.isFinite(v) ? Number(v).toFixed(precision).replace(/\.0+$/, '') : '');
  const startDrag = (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = Number(value) || 0;
    const move = (ev) => {
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = clamp(v0 + Math.round((ev.clientX - x0) / 2) * step * mult);
      onChange(Number(v.toFixed(Math.max(precision, 3))));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'ew-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const commit = () => {
    if (text === null) return;
    const v = parseFloat(text);
    if (Number.isFinite(v)) onChange(clamp(v));
    setText(null);
  };
  return (
    <div className="num" style={style}>
      <span className="scrub" onMouseDown={startDrag} title="Drag to adjust (Shift ×10, Alt ×0.1)">
        {label}
      </span>
      <input
        value={text ?? fmt(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onChange(clamp((Number(value) || 0) + d));
            setText(null);
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

export function Slider({ value, onChange, min = 0, max = 1, step = 0.01, display = (v) => v, parse = (v) => v, unit, precision = 0, numStep }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider" style={{ flex: 1 }}>
      <input type="range" min={min} max={max} step={step} value={value} style={{ '--pct': `${pct}%` }} onChange={(e) => onChange(Number(e.target.value))} />
      <NumberField value={display(value)} onChange={(v) => onChange(Math.min(max, Math.max(min, parse(v))))} precision={precision} unit={unit} step={numStep ?? 1} label="" />
    </div>
  );
}

export function Check({ checked, onChange, children }) {
  return (
    <label className="check" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="box">
        <I.check />
      </span>
      {children}
    </label>
  );
}

export function Toggle({ on, onChange, title }) {
  return <button className={`toggle ${on ? 'on' : ''}`} title={title} onClick={() => onChange(!on)} />;
}

export function Seg({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map(([v, l, title]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)} title={title}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function ColorField({ value, onChange }) {
  const [text, setText] = useState(null);
  return (
    <div className="color">
      <label className="swatch">
        <div style={{ background: value }} />
        <input type="color" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      </label>
      <input
        className="input"
        value={text ?? value}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null && /^#?[0-9a-f]{6}$/i.test(text.trim())) onChange('#' + text.trim().replace('#', '').toLowerCase());
          setText(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        spellCheck={false}
      />
    </div>
  );
}

export function Modal({ title, onClose, children, footer, width }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }}>
        <header className="panel-head">
          <h2>{title}</h2>
          <span className="grow" />
          <button className="icon-btn" onClick={onClose}>
            <I.x />
          </button>
        </header>
        <div className="panel-body">{children}</div>
        {footer && <div className="foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Rotation dial: drag around to set angle. */
export function Dial({ value, onChange }) {
  const ref = useRef();
  const down = (e) => {
    e.preventDefault();
    const r = ref.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const move = (ev) => {
      let a = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
      if (a > 180) a -= 360;
      if (ev.shiftKey) a = Math.round(a / 15) * 15;
      onChange(Math.round(a * 10) / 10);
    };
    move(e);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return <div ref={ref} className="dial" style={{ '--rot': `${value || 0}deg` }} onMouseDown={down} onDoubleClick={() => onChange(0)} title="Drag to rotate · Shift snaps 15° · Double-click resets" />;
}

export function useDropFiles(onPaths) {
  const [over, setOver] = useState(false);
  const counter = useRef(0);
  return [
    over,
    {
      onDragEnter: (e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        counter.current++;
        setOver(true);
      },
      onDragLeave: () => {
        counter.current = Math.max(0, counter.current - 1);
        if (!counter.current) setOver(false);
      },
      onDragOver: (e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      },
      onDrop: (e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        counter.current = 0;
        setOver(false);
        const paths = [...e.dataTransfer.files].map((f) => window.wm.pathForFile(f)).filter(Boolean);
        if (paths.length) onPaths(paths);
      },
    },
  ];
}
