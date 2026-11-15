/** Helen's face rig: a small set of numbers the renderer draws from, plus named expression presets. */
export interface Rig {
  eyeOpen: number; // 0 closed … 1 open
  gazeX: number; // -1 left … 1 right
  gazeY: number; // -1 up … 1 down
  browRaise: number; // -1 … 1
  browWorry: number; // 0 … 1, inner ends rise (concern)
  smile: number; // -1 … 1
  mouthOpen: number; // 0 … 1
  mouthWide: number; // -1 pursed … 1 wide
  tilt: number; // -1 … 1 head tilt
  nod: number; // -1 … 1 head dip
  lean: number; // 0 … 1 slight zoom in
  breath: number; // 0 … 1 idle breathing
}

export type ExpressionName =
  | "neutral"
  | "smile"
  | "listening"
  | "thinking"
  | "looking"
  | "pleased"
  | "concerned"
  | "serious"
  | "surprised"
  | "goodbye";

export const NEUTRAL: Rig = {
  eyeOpen: 1, gazeX: 0, gazeY: 0, browRaise: 0, browWorry: 0, smile: 0.25,
  mouthOpen: 0, mouthWide: 0, tilt: 0, nod: 0, lean: 0, breath: 0,
};

const P = (o: Partial<Rig>): Rig => ({ ...NEUTRAL, ...o });

export const PRESETS: Record<ExpressionName, Rig> = {
  neutral: P({}),
  smile: P({ smile: 0.8, browRaise: 0.1, eyeOpen: 0.88 }),
  listening: P({ smile: 0.3, browRaise: 0.2, tilt: 0.45 }),
  thinking: P({ smile: 0.05, browRaise: 0.25, gazeX: -0.45, gazeY: -0.5, tilt: -0.3 }),
  looking: P({ smile: 0.1, browRaise: 0.35, lean: 1, gazeY: 0.1 }),
  pleased: P({ smile: 1, browRaise: 0.3, eyeOpen: 0.8, nod: 0.5 }),
  concerned: P({ smile: -0.35, browRaise: 0.15, browWorry: 0.9, tilt: 0.3 }),
  serious: P({ smile: 0, browWorry: 0.35 }),
  surprised: P({ smile: 0.1, browRaise: 1, mouthOpen: 0.25 }),
  goodbye: P({ smile: 1, browRaise: 0.2, tilt: 0.3, eyeOpen: 0.85 }),
};
