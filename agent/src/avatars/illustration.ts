import type { Avatar } from "./catalog.js";

export const AVATAR_WIDTH = 368;
export const AVATAR_HEIGHT = 560;
export type AvatarState = "initializing" | "idle" | "listening" | "thinking" | "speaking";

/** Original layered vector rig. Time is explicit so previews and tests are deterministic.
 * Mouth motion follows speaking state, not phonemes; this is deliberately not called lip sync.
 */
export function avatarSvg(avatar: Avatar, seconds: number, state: AvatarState = "listening"): string {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const blinkPhase = t % 4.7;
  const blink = blinkPhase > 4.35 ? Math.sin((blinkPhase - 4.35) / .35 * Math.PI) : 0;
  const eyeScale = Math.max(.08, 1 - blink);
  const speaking = state === "speaking";
  const mouth = speaking ? 3 + 10 * Math.pow((Math.sin(t * 17) + 1) / 2, .7) : 0;
  const bob = Math.sin(t * 1.8) * 1.5;
  const tilt = Math.sin(t * .8) * (state === "thinking" ? 2.1 : .7);
  const gaze = state === "thinking" ? 2 : Math.sin(t * .6) * .7;
  const female = avatar.id === "helen";
  const cyclops = avatar.id === "cyclops";
  const { skin, hair, mantle, accent } = avatar;
  const outline = "#493e39";
  const eye = (x: number, y: number, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale} ${scale * eyeScale})">
    <path d="M-17 0 Q0-17 17 0 Q0 14-17 0" fill="#fff9e9" stroke="${outline}" stroke-width="2"/>
    <ellipse cx="${gaze}" cy="0" rx="6.5" ry="8" fill="#61765d"/><circle cx="${gaze}" cy="0" r="3.6" fill="${outline}"/>
    <circle cx="${gaze + 2}" cy="-3" r="1.7" fill="#fff"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${AVATAR_WIDTH}" height="${AVATAR_HEIGHT}" viewBox="0 0 368 560">
    <defs>
      <radialGradient id="wall"><stop stop-color="#f8f3df"/><stop offset="1" stop-color="#e1e5d4"/></radialGradient>
      <linearGradient id="skin" x2=".8" y2="1"><stop stop-color="${skin}"/><stop offset="1" stop-color="#c88e6b"/></linearGradient>
      <linearGradient id="robe" x2="1" y2="1"><stop stop-color="${mantle}"/><stop offset="1" stop-color="${outline}"/></linearGradient>
    </defs>
    <rect width="368" height="560" fill="url(#wall)"/>
    <path d="M38 560V195a146 146 0 0 1 292 0v365" fill="#f8f4e7" opacity=".65"/>
    <path d="M26 560V193a158 158 0 0 1 316 0v367M41 560V196a143 143 0 0 1 286 0v364" fill="none" stroke="#c8cdbb" stroke-width="2" opacity=".55"/>
    <g stroke="#83947c" stroke-width="2" fill="#a9b69a" opacity=".8">
      <path d="M17 528Q42 465 21 404M350 530Q326 465 347 412" fill="none"/>
      <path d="M28 480Q1 470 8 451Q32 457 28 480M29 452Q48 428 41 420Q22 430 29 452M337 483Q363 469 359 452Q334 459 337 483M337 452Q315 435 322 421Q343 429 337 452"/>
    </g>
    <ellipse cx="184" cy="545" rx="147" ry="17" fill="#b4bda5" opacity=".3"/>
    <g transform="translate(0 ${bob * .4})">
      <path d="M46 560L55 446Q69 399 147 386L221 386Q301 397 315 446L326 560" fill="#eee4cc" stroke="${outline}" stroke-width="2.5"/>
      <path d="M78 423Q116 427 158 402L283 414Q312 444 326 560H68Q106 511 78 423" fill="url(#robe)"/>
      <path d="M100 435Q187 492 284 437M87 477Q172 525 311 472M95 531Q203 560 315 509" fill="none" stroke="${accent}" stroke-width="3" opacity=".3"/>
      <path d="M156 346L150 400Q182 430 218 400L211 345" fill="url(#skin)" stroke="${outline}" stroke-width="2.5"/>
      <path d="M157 378Q185 397 212 376" fill="none" stroke="#ac7359" stroke-width="3" opacity=".5"/>
      <circle cx="${female ? 98 : 274}" cy="426" r="15" fill="${accent}" stroke="${outline}" stroke-width="2"/>
      <circle cx="${female ? 98 : 274}" cy="426" r="9" fill="none" stroke="#f6dd9f" stroke-width="2"/>
    </g>
    <g transform="translate(184 ${284 + bob}) rotate(${tilt}) translate(-184 -284)">
      ${female ? `<path d="M91 231Q80 145 118 123Q174 83 235 127Q279 158 274 237L286 394Q263 421 225 395L133 403Q82 409 83 380Z" fill="${hair}" stroke="${outline}" stroke-width="3"/>` : ""}
      <ellipse cx="101" cy="275" rx="15" ry="24" fill="${skin}" stroke="${outline}" stroke-width="2.5"/>
      <ellipse cx="267" cy="275" rx="15" ry="24" fill="${skin}" stroke="${outline}" stroke-width="2.5"/>
      <path d="M106 221Q112 147 184 149Q254 147 263 222L257 304Q253 369 184 389Q115 370 110 305Z" fill="url(#skin)" stroke="${outline}" stroke-width="2.5"/>
      ${!female ? `<path d="M111 294Q125 316 137 305Q158 320 184 314Q210 320 232 305Q246 316 257 294L250 342Q230 382 184 395Q138 382 118 345Z" fill="${hair}"/>
        <path d="M126 337Q148 365 159 367M209 366Q231 357 243 337M171 378L175 385M193 378L190 385" stroke="#c6bbab" opacity=".65" stroke-width="3" fill="none"/>` : ""}
      <g fill="${hair}" stroke="${outline}" stroke-width="2.5">
        <path d="M102 242Q83 200 108 168Q104 135 140 131Q164 105 193 125Q227 111 247 146Q281 153 266 235L253 218Q247 186 225 178Q199 194 176 164Q153 193 124 193L115 238Z"/>
        <path d="M114 177Q125 150 151 147M158 143Q187 124 206 148M213 154Q241 150 250 178" fill="none" stroke="${female ? "#9c7152" : "#a69a87"}" stroke-width="4" opacity=".65"/>
      </g>
      ${avatar.id === "agamemnon" || female ? `<path d="M112 186Q185 158 254 186L252 196Q185 176 115 197Z" fill="${accent}" stroke="${outline}" stroke-width="2"/>
        <g fill="#e1c682"><path d="M127 183q-20-16-13-25q19 4 13 25M146 178q-15-20-5-26q15 9 5 26M222 179q16-20 7-26q-16 8-7 26M241 185q20-15 14-25q-20 4-14 25"/></g>
        ${!female ? `<ellipse cx="184" cy="177" rx="9" ry="12" fill="#984c4c" stroke="#ead197" stroke-width="3"/>` : ""}` : ""}
      <g fill="none" stroke="${hair}" stroke-width="7" stroke-linecap="round">
        ${cyclops ? '<path d="M148 227Q183 210 219 227"/>' : '<path d="M124 239Q141 228 159 237M209 237Q227 228 244 239"/>'}
      </g>
      ${cyclops ? eye(184, 253, 1.65) : eye(142, 257) + eye(226, 257)}
      <path d="M182 270Q171 294 179 300Q187 305 195 299" fill="none" stroke="#aa7357" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="133" cy="294" rx="15" ry="8" fill="#ce7b65" opacity=".24"/>
      <ellipse cx="235" cy="294" rx="15" ry="8" fill="#ce7b65" opacity=".24"/>
      ${speaking ? `<ellipse cx="184" cy="330" rx="${12 + mouth * .25}" ry="${mouth}" fill="#59392f" stroke="#a96957" stroke-width="2"/>
        <path d="M173 ${325 - mouth * .15}Q184 ${328 - mouth * .15}195 ${325 - mouth * .15}" stroke="#fff0d6" stroke-width="3" fill="none"/>` : '<path d="M166 327Q184 340 202 327" fill="none" stroke="#a36653" stroke-width="3.5" stroke-linecap="round"/>'}
      ${female ? `<g fill="${accent}" stroke="#8e7043" stroke-width="1.5"><path d="M101 292q-11 20 0 24q11-4 0-24M267 292q-11 20 0 24q11-4 0-24"/></g>` : ""}
    </g>
  </svg>`;
}
