import Link from "next/link";

/** PillPal mark: a lime capsule whose dark half ends in a speech-bubble tail — medicine + conversation. */
export function Mark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect x="2" y="11" width="36" height="18" rx="9" fill="#A3E635" />
      <path d="M20 11h9a9 9 0 0 1 0 18h-9z" fill="#1E271C" />
      <path d="M29 29l2 6 -6.5 -6z" fill="#1E271C" />
      <circle cx="11" cy="20" r="2.4" fill="#1E271C" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-lg" aria-label="PillPal home">
      <Mark />
      <span className="font-display text-[26px] font-bold tracking-[-0.03em] text-ink">pillpal</span>
    </Link>
  );
}

/** Decorative blister pack + capsules for the hero banner. */
export function BlisterArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 220" className={className} aria-hidden>
      <g transform="rotate(-24 210 110)">
        <rect x="60" y="20" width="230" height="170" rx="30" fill="#BEF264" />
        {[0, 1, 2].map((r) =>
          [0, 1, 2].map((c) => (
            <g key={`${r}-${c}`}>
              <rect x={86 + c * 66} y={44 + r * 48} width="48" height="30" rx="15" fill="#A3E635" />
              <rect x={98 + c * 66} y={54 + r * 48} width="24" height="10" rx="5" fill="#3F6212" opacity="0.85" />
            </g>
          )),
        )}
        <rect x="300" y="-10" width="150" height="130" rx="28" fill="#BEF264" />
        <circle cx="345" cy="35" r="20" fill="#A3E635" />
        <circle cx="345" cy="35" r="11" fill="#3F6212" opacity="0.8" />
        <circle cx="400" cy="65" r="20" fill="#A3E635" />
        <circle cx="400" cy="65" r="11" fill="#3F6212" opacity="0.8" />
      </g>
      <circle cx="390" cy="190" r="26" fill="#BEF264" />
      <path d="M372 172 L408 208" stroke="#84CC16" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
