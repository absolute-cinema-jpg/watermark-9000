const S = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props} />
);

export const I = {
  queue: (p) => (
    <S {...p}>
      <rect x="3" y="4" width="18" height="4" rx="1.2" />
      <rect x="3" y="10" width="18" height="4" rx="1.2" />
      <rect x="3" y="16" width="11" height="4" rx="1.2" />
      <path d="M17.5 16.5l3 1.5-3 1.5z" fill="currentColor" />
    </S>
  ),
  watermark: (p) => (
    <S {...p}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="M6 16l3-4 2.5 3 2-2.5L18 16" opacity=".5" />
      <path d="M13.5 8.5h4.5M15.75 8.5v4" />
    </S>
  ),
  settings: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </S>
  ),
  plus: (p) => (
    <S {...p}>
      <path d="M12 5v14M5 12h14" />
    </S>
  ),
  minus: (p) => (
    <S {...p}>
      <path d="M5 12h14" />
    </S>
  ),
  import: (p) => (
    <S {...p}>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </S>
  ),
  trash: (p) => (
    <S {...p}>
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3" />
    </S>
  ),
  play: (p) => (
    <S {...p}>
      <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
    </S>
  ),
  pause: (p) => (
    <S {...p}>
      <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    </S>
  ),
  stop: (p) => (
    <S {...p}>
      <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" fill="currentColor" stroke="none" />
    </S>
  ),
  x: (p) => (
    <S {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </S>
  ),
  check: (p) => (
    <S {...p} strokeWidth="3">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </S>
  ),
  checkCircle: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.8 2.8L16.5 9.5" />
    </S>
  ),
  alert: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </S>
  ),
  clock: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </S>
  ),
  loader: (p) => (
    <S {...p} className="spin">
      <path d="M12 3a9 9 0 109 9" />
    </S>
  ),
  ban: (p) => (
    <S {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </S>
  ),
  retry: (p) => (
    <S {...p}>
      <path d="M3 12a9 9 0 0115.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 01-15.5 6.2L3 16M3 21v-5h5" />
    </S>
  ),
  folder: (p) => (
    <S {...p}>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    </S>
  ),
  reveal: (p) => (
    <S {...p}>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <path d="M12 10v5M9.5 12.5L12 15l2.5-2.5" />
    </S>
  ),
  film: (p) => (
    <S {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </S>
  ),
  text: (p) => (
    <S {...p}>
      <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />
    </S>
  ),
  tc: (p) => (
    <S {...p}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10.5v3M9 10.5v3M12 11v.01M12 13v.01M15 10.5v3M18 10.5v3" />
    </S>
  ),
  file: (p) => (
    <S {...p}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </S>
  ),
  counter: (p) => (
    <S {...p}>
      <path d="M4 9h16M4 15h16M10 4L8 20M16 4l-2 16" />
    </S>
  ),
  image: (p) => (
    <S {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.7" />
      <path d="M21 16l-5-5-8 9" />
    </S>
  ),
  eye: (p) => (
    <S {...p}>
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </S>
  ),
  eyeOff: (p) => (
    <S {...p}>
      <path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10.5 7 10.5 7a17 17 0 01-3.2 3.9M6.6 6.6A17 17 0 001.5 12s4 7 10.5 7a9.6 9.6 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2" />
    </S>
  ),
  copy: (p) => (
    <S {...p}>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3" />
    </S>
  ),
  up: (p) => (
    <S {...p}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </S>
  ),
  down: (p) => (
    <S {...p}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </S>
  ),
  alignL: (p) => (
    <S {...p}>
      <path d="M4 5h16M4 10h10M4 15h16M4 20h10" />
    </S>
  ),
  alignC: (p) => (
    <S {...p}>
      <path d="M4 5h16M7 10h10M4 15h16M7 20h10" />
    </S>
  ),
  alignR: (p) => (
    <S {...p}>
      <path d="M4 5h16M10 10h10M4 15h16M10 20h10" />
    </S>
  ),
  grid: (p) => (
    <S {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <rect x="6" y="6" width="12" height="12" rx="1" strokeDasharray="2 2" />
    </S>
  ),
  sparkle: (p) => (
    <S {...p}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
    </S>
  ),
  export: (p) => (
    <S {...p}>
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
    </S>
  ),
  italic: (p) => (
    <S {...p}>
      <path d="M19 4h-9M14 20H5M15 4L9 20" />
    </S>
  ),
  bold: (p) => (
    <S {...p} strokeWidth="2.2">
      <path d="M6 4h8a4 4 0 010 8H6zM6 12h9a4 4 0 010 8H6z" />
    </S>
  ),
  bolt: (p) => (
    <S {...p}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </S>
  ),
  dots: (p) => (
    <S {...p}>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </S>
  ),
};
