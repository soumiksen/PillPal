import Link from "next/link";

/** PillPal mark: a lime capsule whose dark half ends in a speech-bubble tail — medicine + conversation. */
export function Mark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect x="2" y="11" width="36" height="18" rx="9" fill="#E8C97A" />
      <path d="M20 11h9a9 9 0 0 1 0 18h-9z" fill="#102F46" />
      <path d="M29 29l2 6 -6.5 -6z" fill="#102F46" />
      <circle cx="11" cy="20" r="2.4" fill="#102F46" />
      {/* Outline in the surrounding text colour, so the navy half still reads on the night-sea panels. */}
      <rect x="2" y="11" width="36" height="18" rx="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-lg" aria-label="PillPal home">
      <Mark />
      <span className="font-display text-[24px] font-bold text-ink">pillpal</span>
    </Link>
  );
}

/** Greek key frieze (decorative). Colour follows `currentColor`, e.g. className="text-lime". */
export function Meander({ className = "" }: { className?: string }) {
  return <div className={`meander w-full ${className}`} aria-hidden />;
}

/**
 * Decorative Odyssey scene for dark panels, after the HackUTA 2026 site: a galley under a square sail
 * crossing a swelling sea. Waves drift slowly (paused for reduced motion).
 */
export function Voyage({ className = "" }: { className?: string }) {
  // One wave period is 120 px; the path runs past the edge so the drift loops without a seam.
  const wave = (y: number, amp: number) => {
    let d = `M0 ${y}`;
    for (let x = 0; x < 1080; x += 120) d += ` q30 ${-amp} 60 0 t60 0`;
    return `${d} V200 H0 Z`;
  };
  return (
    <svg viewBox="0 0 960 200" preserveAspectRatio="xMidYMax slice" className={className} aria-hidden>
      <g transform="translate(330 18)" fill="#EEE3D2">
        <path d="M70 0v96" stroke="#EEE3D2" strokeWidth="3" />
        <path d="M70 2l26 7-26 7z" />
        <path d="M30 22h80l-6 62H36z" fillOpacity="0.92" />
        <path d="M70 34l12 18-12 18-12-18z" fill="#102F46" />
        <path d="M70 41l7 11-7 11-7-11z" />
        <path d="M30 22L4 98M110 22l28 74" stroke="#EEE3D2" strokeWidth="1.5" fill="none" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={i} cx={34 + i * 15} cy="90" r="5" />
        ))}
        <path d="M-10 92c40 6 120 8 176-4l14-16 2 6-10 22c-60 20-140 18-182 2z" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={`o${i}`} d={`M${20 + i * 18} 104l-12 22`} stroke="#EEE3D2" strokeWidth="2.5" strokeLinecap="round" />
        ))}
      </g>
      <g className="swell">
        <path d={wave(150, 16)} fill="#305873" />
      </g>
      <g className="swell" style={{ animationDuration: "13s", animationDirection: "reverse" }}>
        <path d={wave(170, 12)} fill="#1A3A52" />
      </g>
      <path d={wave(188, 8)} fill="#0B2234" />
    </svg>
  );
}

/** Decorative blister pack + capsules for the hero banner. */
export function BlisterArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 220" className={className} aria-hidden>
      <g transform="rotate(-24 210 110)">
        <rect x="60" y="20" width="230" height="170" rx="30" fill="#F0DCA4" />
        {[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) => (
            <g key={`${r}-${c}`}>
              <rect x={86 + c * 66} y={44 + r * 48} width="48" height="30" rx="15" fill="#E8C97A" />
              <rect x={98 + c * 66} y={54 + r * 48} width="24" height="10" rx="5" fill="#305873" opacity="0.85" />
            </g>
          )),
        )}
        <rect x="300" y="-10" width="150" height="130" rx="28" fill="#F0DCA4" />
        <circle cx="345" cy="35" r="20" fill="#E8C97A" />
        <circle cx="345" cy="35" r="11" fill="#305873" opacity="0.8" />
        <circle cx="400" cy="65" r="20" fill="#E8C97A" />
        <circle cx="400" cy="65" r="11" fill="#305873" opacity="0.8" />
      </g>
      <circle cx="390" cy="190" r="26" fill="#F0DCA4" />
      <path d="M372 172 L408 208" stroke="#305873" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
