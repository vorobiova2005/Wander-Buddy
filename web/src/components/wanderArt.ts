/**
 * Вандер, the companion - the same drawing as the Figma component "Вандер" (page 🧑‍🚀 Вандер): one body, and per
 * mood the arms, the face and the props. Generated from code so the 11 moods stay consistent; viewBox 0 0 200 260.
 * The wrist gadget turns with the forearm (rotation = forearm angle ± 90°).
 */
export type WanderMood =
  | 'happy'
  | 'excited'
  | 'thoughtful'
  | 'worried'
  | 'sleepy'
  | 'rainy'
  | 'cold'
  | 'hungry'
  | 'lost'
  | 'waiting'
  | 'celebrating'

type Pt = [number, number]

const INK = '#1B2A41', SKIN = '#F6C9A0', TEAL = '#127C7A', TEAL_D = '#0E5E5C', ORANGE = '#F2994A', SUN = '#F2C94C', SCREEN = '#6EE7B7', RED = '#D9534F', CREAM = '#FCEBD0';
const deg = (r: number) => r * 180 / Math.PI;

// ---- parts
const body = `
<rect x="56" y="110" width="88" height="98" rx="22" fill="${TEAL}" stroke="${INK}" stroke-width="3"/>
<line x1="134" y1="112" x2="164" y2="40" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
<circle cx="166" cy="34" r="15" fill="${SUN}" opacity="0.35"/>
<circle cx="166" cy="34" r="8" fill="${SUN}" stroke="${INK}" stroke-width="3"/>
<rect x="78" y="196" width="18" height="40" rx="7" fill="${INK}"/>
<rect x="104" y="196" width="18" height="40" rx="7" fill="${INK}"/>
<rect x="70" y="230" width="30" height="16" rx="8" fill="#6B4430" stroke="${INK}" stroke-width="2.5"/>
<rect x="100" y="230" width="30" height="16" rx="8" fill="#6B4430" stroke="${INK}" stroke-width="2.5"/>
<rect x="68" y="126" width="64" height="82" rx="24" fill="${ORANGE}" stroke="${INK}" stroke-width="3"/>
<rect x="74" y="132" width="8" height="62" rx="4" fill="${TEAL_D}"/>
<rect x="118" y="132" width="8" height="62" rx="4" fill="${TEAL_D}"/>
<path d="M84 128 L100 146 L116 128 Z" fill="${TEAL}" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
<line x1="100" y1="148" x2="100" y2="204" stroke="#C9742F" stroke-width="3" stroke-linecap="round"/>
<rect x="104" y="154" width="12" height="9" rx="2" fill="${SUN}" stroke="${INK}" stroke-width="2"/>`;
const head = `
<circle cx="60" cy="90" r="9" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
<circle cx="140" cy="90" r="9" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
<circle cx="100" cy="88" r="40" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>
<path d="M62 80 Q66 64 78 66 L74 82 Z" fill="#5A3B2A"/>
<path d="M138 80 Q134 64 122 66 L126 82 Z" fill="#5A3B2A"/>
<path d="M58 74 Q100 26 142 74 Z" fill="${TEAL}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
<rect x="54" y="68" width="92" height="11" rx="5.5" fill="${TEAL_D}" stroke="${INK}" stroke-width="3"/>
<line x1="95" y1="54" x2="105" y2="54" stroke="${INK}" stroke-width="4"/>
<circle cx="84" cy="54" r="11" fill="${SUN}" stroke="${INK}" stroke-width="4"/>
<circle cx="116" cy="54" r="11" fill="${SUN}" stroke="${INK}" stroke-width="4"/>
<ellipse cx="80" cy="50" rx="3" ry="2" fill="#FFFFFF"/>
<ellipse cx="112" cy="50" rx="3" ry="2" fill="#FFFFFF"/>`;
const cheeks = (c = ORANGE, o = 0.4) => `<circle cx="76" cy="102" r="6" fill="${c}" opacity="${o}"/><circle cx="124" cy="102" r="6" fill="${c}" opacity="${o}"/>`;

/** An arm from shoulder to hand; the hand is drawn on top. */
const arm = ([sx, sy]: Pt, [hx, hy]: Pt) => `<line x1="${sx}" y1="${sy}" x2="${hx}" y2="${hy}" stroke="${ORANGE}" stroke-width="16" stroke-linecap="round"/>`;
const hand = ([hx, hy]: Pt) => `<circle cx="${hx}" cy="${hy}" r="8" fill="${SKIN}" stroke="${INK}" stroke-width="3"/>`;
/**
 * The wrist gadget sits on the forearm near the wrist and turns with it: its long side across the arm,
 * the screen facing up whether the arm points down or up. A mini antenna with an LED on top.
 */
const gadget = ([sx, sy]: Pt, [hx, hy]: Pt, { screen = SCREEN, inside = '', glow = false } = {}) => {
  const cx = sx + (hx - sx) * 0.7, cy = sy + (hy - sy) * 0.7;
  const theta = deg(Math.atan2(hy - sy, hx - sx));
  const rot = (hy < sy ? theta + 90 : theta - 90).toFixed(1);
  return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${rot})">
${glow ? `<circle cx="0" cy="0" r="18" fill="${SCREEN}" opacity="0.35"/>` : ''}
<line x1="8" y1="-8" x2="11" y2="-15" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
<circle cx="11.5" cy="-16.5" r="2.6" fill="${SUN}" stroke="${INK}" stroke-width="1.2"/>
<rect x="-12" y="-8" width="24" height="16" rx="4" fill="${INK}"/>
<rect x="-9" y="-5" width="18" height="10" rx="2" fill="${screen}"/>
${inside}
</g>`;
};
const eyes = `<ellipse cx="86" cy="92" rx="4.5" ry="5.5" fill="${INK}"/><ellipse cx="114" cy="92" rx="4.5" ry="5.5" fill="${INK}"/>
<circle cx="87.5" cy="90" r="1.5" fill="#FFFFFF"/><circle cx="115.5" cy="90" r="1.5" fill="#FFFFFF"/>`;
const happyEyes = `<path d="M80 94 Q86 85 92 94" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><path d="M108 94 Q114 85 120 94" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;
const bigGrin = `<path d="M86 103 Q100 124 114 103 Z" fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><ellipse cx="100" cy="113" rx="6" ry="3.5" fill="#E07A6A"/>`;
const sparkle = (x: number, y: number, s: number, c = SUN) => `<path d="M${x} ${y - s} L${x + s * 0.3} ${y - s * 0.3} L${x + s} ${y} L${x + s * 0.3} ${y + s * 0.3} L${x} ${y + s} L${x - s * 0.3} ${y + s * 0.3} L${x - s} ${y} L${x - s * 0.3} ${y - s * 0.3} Z" fill="${c}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
const svg = (inner: string) => inner;

const L_DOWN: [Pt, Pt] = [[72, 140], [62, 186]], R_DOWN: [Pt, Pt] = [[128, 140], [138, 186]];
const R_UP: [Pt, Pt] = [[128, 140], [154, 96]], L_UP: [Pt, Pt] = [[72, 140], [46, 96]];

export const WANDER_ART: Record<WanderMood, string> = {
  // ---- the four moods the AI chooses
  happy: svg(body + arm(...L_DOWN) + hand(L_DOWN[1]) + arm(...R_DOWN) + gadget(...R_DOWN) + hand(R_DOWN[1]) + head + cheeks() + eyes
    + `<path d="M88 106 Q100 116 112 106" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`),
  excited: svg(body + arm(...L_DOWN) + hand(L_DOWN[1]) + arm(...R_UP) + gadget(...R_UP, { glow: true }) + hand(R_UP[1]) + head + cheeks() + happyEyes + bigGrin
    + sparkle(184, 84, 9) + sparkle(30, 120, 7) + sparkle(176, 134, 6)),
  thoughtful: svg(body + arm(...L_DOWN) + hand(L_DOWN[1]) + arm([128, 142], [112, 124]) + gadget([128, 142], [112, 124]) + head + cheeks()
    + `<ellipse cx="89" cy="89" rx="4.5" ry="5.5" fill="${INK}"/><ellipse cx="117" cy="89" rx="4.5" ry="5.5" fill="${INK}"/>
<path d="M81 80 L93 79" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M108 77 L120 80" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<path d="M93 109 Q101 106 108 109" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>` + hand([110, 124])
    + `<circle cx="40" cy="44" r="4" fill="#FFFFFF" stroke="${INK}" stroke-width="2"/><circle cx="30" cy="32" r="6" fill="#FFFFFF" stroke="${INK}" stroke-width="2"/><circle cx="18" cy="16" r="9" fill="#FFFFFF" stroke="${INK}" stroke-width="2"/>`),
  worried: svg(body + arm(...L_DOWN) + hand(L_DOWN[1]) + arm(...R_DOWN) + gadget(...R_DOWN) + hand(R_DOWN[1]) + head + cheeks() + eyes
    + `<path d="M79 84 Q85 79 91 79" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M121 84 Q115 79 109 79" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<path d="M88 110 Q94 105 100 110 Q106 115 112 110" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M146 66 Q152 76 146 82 Q140 76 146 66 Z" fill="#8EC9F0" stroke="${INK}" stroke-width="2"/>`),

  // ---- situational moods the app picks from the data
  // early departure: yawning, coffee in hand, Zzz
  sleepy: svg(body + arm([72, 140], [64, 178]) + arm(...R_DOWN) + gadget(...R_DOWN) + hand(R_DOWN[1]) + head + cheeks('#B9C3D6', 0.5)
    + `<path d="M80 92 Q86 97 92 92" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/><path d="M108 92 Q114 97 120 92" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
<ellipse cx="100" cy="111" rx="6" ry="8" fill="${INK}"/>
<rect x="50" y="170" width="20" height="22" rx="4" fill="#FFFFFF" stroke="${INK}" stroke-width="3"/><path d="M50 176 Q42 181 50 186" stroke="${INK}" stroke-width="3"/>
<path d="M55 164 Q52 158 56 152 M63 164 Q60 158 64 152" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>` + hand([64, 180])
    + `<path d="M148 64 h12 l-12 14 h12" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M166 42 h9 l-9 10 h9" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M180 24 h6 l-6 7 h6" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  // heavy rain: the umbrella turned inside out by the wind, unamused face
  rainy: svg(`<g stroke="#8EC9F0" stroke-width="3" stroke-linecap="round"><path d="M20 120 l-6 14"/><path d="M178 110 l-6 14"/><path d="M160 170 l-6 14"/><path d="M30 190 l-6 14"/><path d="M186 60 l-6 14"/><path d="M98 6 l-6 14"/></g>`
    + body + arm(...R_DOWN) + gadget(...R_DOWN) + hand(R_DOWN[1]) + arm([72, 140], [48, 96])
    + `<line x1="46" y1="98" x2="40" y2="40" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
<path d="M10 20 Q40 56 72 20 Q58 30 50 22 Q40 32 32 22 Q22 30 10 20 Z" fill="${TEAL}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
<path d="M40 40 L32 22 M40 40 L50 22" stroke="${INK}" stroke-width="2"/>` + hand([48, 98]) + head + cheeks()
    + `<ellipse cx="86" cy="93" rx="4.5" ry="4" fill="${INK}"/><ellipse cx="114" cy="93" rx="4.5" ry="4" fill="${INK}"/>
<path d="M80 88 L92 88 M108 88 L120 88" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<path d="M90 109 L110 109" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M64 84 Q68 92 64 96 Q60 92 64 84 Z" fill="#8EC9F0" stroke="${INK}" stroke-width="1.5"/>`),
  // cold: scarf, red nose, chattering teeth, hugging himself, shivering
  cold: svg(body + arm([72, 140], [112, 166]) + arm([128, 140], [88, 166]) + gadget([128, 140], [88, 166]) + hand([112, 166]) + hand([88, 166]) + head + cheeks('#8EC9F0', 0.6)
    + `<rect x="74" y="118" width="52" height="13" rx="6.5" fill="${RED}" stroke="${INK}" stroke-width="3"/><rect x="108" y="124" width="12" height="30" rx="5" fill="${RED}" stroke="${INK}" stroke-width="3"/>
<path d="M86 118 v13 M98 118 v13 M110 124 h10 M110 136 h10" stroke="#FFFFFF" stroke-width="2.5"/>`
    + eyes + `<path d="M79 84 Q85 79 91 79" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M121 84 Q115 79 109 79" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<circle cx="100" cy="99" r="5.5" fill="#E07A6A" stroke="${INK}" stroke-width="2"/>
<path d="M88 110 L92 106 L96 110 L100 106 L104 110 L108 106 L112 110" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M44 96 q-6 6 0 12 q6 6 0 12 M156 96 q6 6 0 12 q-6 6 0 12" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`),
  // lunch step: a giant pretzel and a drool
  hungry: svg(body + arm([72, 140], [86, 172]) + arm([128, 140], [114, 172]) + gadget([128, 140], [114, 172])
    + `<path d="M62 180 C50 150 96 146 100 168 C104 146 150 150 138 180 C130 200 70 200 62 180 Z M80 182 L120 160 M120 182 L80 160" stroke="#B0703A" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M62 180 C50 150 96 146 100 168 C104 146 150 150 138 180 C130 200 70 200 62 180 Z" stroke="${INK}" stroke-width="1.5" fill="none"/>
<g fill="#FFFFFF"><circle cx="70" cy="166" r="1.8"/><circle cx="90" cy="158" r="1.8"/><circle cx="112" cy="158" r="1.8"/><circle cx="130" cy="168" r="1.8"/><circle cx="100" cy="188" r="1.8"/></g>`
    + hand([86, 172]) + hand([114, 172]) + head + cheeks()
    + `<ellipse cx="86" cy="91" rx="6" ry="7" fill="${INK}"/><ellipse cx="114" cy="91" rx="6" ry="7" fill="${INK}"/>
<circle cx="88" cy="88" r="2.4" fill="#FFFFFF"/><circle cx="116" cy="88" r="2.4" fill="#FFFFFF"/><circle cx="84" cy="94" r="1.2" fill="#FFFFFF"/><circle cx="112" cy="94" r="1.2" fill="#FFFFFF"/>
<path d="M88 104 Q100 118 112 104 Z" fill="${INK}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
<path d="M108 112 Q111 120 108 124 Q105 120 108 112 Z" fill="#8EC9F0" stroke="${INK}" stroke-width="1.5"/>`),
  // nothing found / error: the map upside down, question marks
  lost: svg(body + arm([72, 140], [76, 170]) + arm([128, 140], [124, 170]) + gadget([128, 140], [124, 170])
    + `<rect x="62" y="150" width="76" height="50" rx="3" fill="${CREAM}" stroke="${INK}" stroke-width="3"/>
<path d="M70 190 Q90 160 110 180 T132 158" stroke="${RED}" stroke-width="2.5" stroke-dasharray="4 4" fill="none"/>
<path d="M126 192 l4 -8 l4 8 z" fill="${INK}" transform="rotate(180 130 188)"/>
<path d="M76 158 l4 6 l-4 6 l-4 -6 z" fill="${RED}"/>` + hand([76, 170]) + hand([124, 170]) + head + cheeks()
    + `<circle cx="86" cy="92" r="3" fill="${INK}"/><ellipse cx="114" cy="91" rx="6" ry="7" fill="${INK}"/><circle cx="116" cy="88" r="2" fill="#FFFFFF"/>
<path d="M80 84 L92 86" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M108 78 Q114 74 120 78" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<path d="M90 110 Q95 106 100 110 Q105 114 110 108" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<path d="M148 28 q0 -10 10 -10 q10 0 10 10 q0 7 -9 10 v6" stroke="${INK}" stroke-width="3.5" stroke-linecap="round" fill="none"/><circle cx="159" cy="52" r="2.5" fill="${INK}"/>
<path d="M26 40 q0 -7 7 -7 q7 0 7 7 q0 5 -6 7 v4" stroke="${INK}" stroke-width="3" stroke-linecap="round" fill="none"/><circle cx="34" cy="57" r="2" fill="${INK}"/>`),
  // waiting for a train or the AI: staring at the gadget showing --:--, tapping a foot
  waiting: svg(body + arm(...L_DOWN) + hand(L_DOWN[1]) + arm([128, 140], [118, 110])
    + gadget([128, 140], [118, 110], { screen: '#F87171', inside: `<rect x="-6" y="-1" width="4" height="2" fill="${INK}"/><rect x="2" y="-1" width="4" height="2" fill="${INK}"/><circle cx="0" cy="-2.5" r="0.9" fill="${INK}"/><circle cx="0" cy="2.5" r="0.9" fill="${INK}"/>` })
    + head + hand([118, 110]) + cheeks()
    + `<ellipse cx="90" cy="94" rx="4.5" ry="5.5" fill="${INK}"/><ellipse cx="118" cy="94" rx="4.5" ry="5.5" fill="${INK}"/>
<path d="M80 84 L92 86 M108 86 L120 84" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
<path d="M90 111 L108 108" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>
<path d="M134 232 l10 -6 M134 240 l12 0 M134 248 l10 6" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>
<circle cx="40" cy="44" r="16" fill="#FFFFFF" stroke="${INK}" stroke-width="3"/><path d="M40 34 V44 L48 48" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`),
  // level up: both arms up, confetti
  celebrating: svg(`<g stroke="${INK}" stroke-width="1.5"><rect x="20" y="40" width="10" height="6" fill="${RED}" transform="rotate(30 25 43)"/><rect x="170" y="70" width="10" height="6" fill="${SCREEN}" transform="rotate(-20 175 73)"/><rect x="34" y="150" width="9" height="6" fill="${SUN}" transform="rotate(50 38 153)"/><rect x="164" y="160" width="9" height="6" fill="${ORANGE}" transform="rotate(-40 168 163)"/><rect x="96" y="2" width="9" height="6" fill="${TEAL}" transform="rotate(15 100 5)"/><rect x="140" y="14" width="8" height="5" fill="${RED}" transform="rotate(-30 144 16)"/></g>`
    + body + arm(...L_UP) + hand(L_UP[1]) + arm(...R_UP) + gadget(...R_UP, { glow: true }) + hand(R_UP[1]) + head + cheeks() + happyEyes + bigGrin
    + sparkle(186, 110, 8) + sparkle(14, 100, 8, SCREEN)),
};
