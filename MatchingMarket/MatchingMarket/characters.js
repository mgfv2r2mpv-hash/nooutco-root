'use strict';

/* ══════════════════════════════════════════════════════════════════
   PROCEDURAL CUSTOMER SVG
   buildCustomer(seed) → SVGElement (viewBox 0 0 200 360)
   Flat-color cartoon person. Deterministic from integer seed.
   ══════════════════════════════════════════════════════════════════ */

const SVG_NS = 'http://www.w3.org/2000/svg';

const SKIN  = ['#f7d6b4', '#e8b48a', '#c98d68', '#a36b48', '#7a4a32', '#523223'];
const HAIR  = ['#1a1a1a', '#3b2417', '#6b4423', '#a76b3a', '#d8a64a', '#e9d7a3', '#9a9a9a', '#c84d3a'];
const SHIRT = ['#3a8dde', '#e84a4a', '#3aaf6e', '#d97a2c', '#7a4ad6', '#2c8a8a', '#d4498a', '#5a6b78', '#c9b04a', '#1a3a6e'];
const HAT   = ['#2c3e50', '#c0392b', '#16a085', '#e67e22', '#34495e', '#8e44ad'];

// Mulberry32 PRNG — seed → reproducible random
function makeRng(seed) {
  let s = (seed | 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/**
 * Build a customer SVG. Returns an <svg> element.
 * viewBox is 200×360 — head at top, feet at bottom-ish (we cut at the waist
 * actually; feet hidden behind counter when in scene).
 */
function buildCustomer(seed) {
  const rng = makeRng(seed);

  const skin  = pick(rng, SKIN);
  const hair  = pick(rng, HAIR);
  const shirt = pick(rng, SHIRT);

  const hairStyle = Math.floor(rng() * 6); // 0..5
  const hasHat    = rng() < 0.22;
  const hatColor  = pick(rng, HAT);
  const hasGlasses = rng() < 0.28;
  const hasEarring = rng() < 0.18;
  const hasScarf   = rng() < 0.20;
  const scarfColor = pick(rng, SHIRT);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 360');
  svg.setAttribute('xmlns', SVG_NS);
  svg.classList.add('customer-svg');

  const NS = (tag, attrs = {}) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  // Body / shirt — trapezoid
  // shoulders y=180, waist y=340, neck y=160
  const body = NS('path', {
    d: 'M 50 340 L 60 200 Q 100 178 140 200 L 150 340 Z',
    fill: shirt,
    stroke: '#1a1a1a',
    'stroke-width': '3',
    'stroke-linejoin': 'round',
  });
  svg.appendChild(body);

  // Arms (simple)
  svg.appendChild(NS('path', {
    d: 'M 60 200 Q 40 250 46 320',
    fill: 'none', stroke: '#1a1a1a', 'stroke-width': '3', 'stroke-linecap': 'round',
  }));
  svg.appendChild(NS('path', {
    d: 'M 140 200 Q 160 250 154 320',
    fill: 'none', stroke: '#1a1a1a', 'stroke-width': '3', 'stroke-linecap': 'round',
  }));

  // Hands (skin circles at end of arms)
  svg.appendChild(NS('circle', { cx: 46, cy: 322, r: 9, fill: skin, stroke: '#1a1a1a', 'stroke-width': '2.5' }));
  svg.appendChild(NS('circle', { cx: 154, cy: 322, r: 9, fill: skin, stroke: '#1a1a1a', 'stroke-width': '2.5' }));

  // Scarf (optional, sits over the neck/shoulders)
  if (hasScarf) {
    svg.appendChild(NS('path', {
      d: 'M 65 180 Q 100 200 135 180 L 130 200 Q 100 215 70 200 Z',
      fill: scarfColor, stroke: '#1a1a1a', 'stroke-width': '2.5', 'stroke-linejoin': 'round',
    }));
    svg.appendChild(NS('path', {
      d: 'M 70 200 L 60 240 L 72 238 L 80 205 Z',
      fill: scarfColor, stroke: '#1a1a1a', 'stroke-width': '2', 'stroke-linejoin': 'round',
    }));
  }

  // Neck
  svg.appendChild(NS('rect', { x: 88, y: 158, width: 24, height: 28, fill: skin, stroke: '#1a1a1a', 'stroke-width': '2.5' }));

  // Head
  svg.appendChild(NS('ellipse', { cx: 100, cy: 110, rx: 50, ry: 56, fill: skin, stroke: '#1a1a1a', 'stroke-width': '3' }));

  // Ears
  svg.appendChild(NS('ellipse', { cx: 50, cy: 115, rx: 7, ry: 12, fill: skin, stroke: '#1a1a1a', 'stroke-width': '2.5' }));
  svg.appendChild(NS('ellipse', { cx: 150, cy: 115, rx: 7, ry: 12, fill: skin, stroke: '#1a1a1a', 'stroke-width': '2.5' }));

  // Earring (right ear)
  if (hasEarring) {
    svg.appendChild(NS('circle', { cx: 152, cy: 125, r: 3, fill: '#f1c40f', stroke: '#1a1a1a', 'stroke-width': '1.5' }));
  }

  // Hair (varies by style)
  if (!hasHat) {
    switch (hairStyle) {
      case 0: // short / cropped
        svg.appendChild(NS('path', {
          d: 'M 50 92 Q 60 56 100 54 Q 140 56 150 92 Q 144 78 100 76 Q 56 78 50 92 Z',
          fill: hair, stroke: '#1a1a1a', 'stroke-width': '2.5', 'stroke-linejoin': 'round',
        }));
        break;
      case 1: // bob
        svg.appendChild(NS('path', {
          d: 'M 46 130 Q 44 60 100 54 Q 156 60 154 130 L 148 130 Q 148 80 100 76 Q 52 80 52 130 Z',
          fill: hair, stroke: '#1a1a1a', 'stroke-width': '2.5', 'stroke-linejoin': 'round',
        }));
        break;
      case 2: // ponytail (bun side)
        svg.appendChild(NS('path', {
          d: 'M 50 90 Q 56 56 100 54 Q 144 56 150 90 Q 142 78 100 76 Q 58 78 50 90 Z',
          fill: hair, stroke: '#1a1a1a', 'stroke-width': '2.5', 'stroke-linejoin': 'round',
        }));
        svg.appendChild(NS('circle', { cx: 156, cy: 92, r: 14, fill: hair, stroke: '#1a1a1a', 'stroke-width': '2.5' }));
        break;
      case 3: // bald — nothing
        break;
      case 4: // bun (top)
        svg.appendChild(NS('path', {
          d: 'M 50 95 Q 56 60 100 58 Q 144 60 150 95 Q 142 80 100 78 Q 58 80 50 95 Z',
          fill: hair, stroke: '#1a1a1a', 'stroke-width': '2.5', 'stroke-linejoin': 'round',
        }));
        svg.appendChild(NS('circle', { cx: 100, cy: 46, r: 16, fill: hair, stroke: '#1a1a1a', 'stroke-width': '2.5' }));
        break;
      case 5: // long / shoulder length
        svg.appendChild(NS('path', {
          d: 'M 42 160 Q 36 60 100 54 Q 164 60 158 160 L 150 160 Q 150 80 100 76 Q 50 80 50 160 Z',
          fill: hair, stroke: '#1a1a1a', 'stroke-width': '2.5', 'stroke-linejoin': 'round',
        }));
        break;
    }
  } else {
    // Hat (beanie / cap) covers hairline area
    svg.appendChild(NS('path', {
      d: 'M 46 92 Q 50 50 100 48 Q 150 50 154 92 L 150 100 Q 100 86 50 100 Z',
      fill: hatColor, stroke: '#1a1a1a', 'stroke-width': '2.5', 'stroke-linejoin': 'round',
    }));
    // band
    svg.appendChild(NS('rect', { x: 46, y: 90, width: 108, height: 10, fill: hatColor, stroke: '#1a1a1a', 'stroke-width': '2.5' }));
  }

  // Eyes
  const eyeY = 112;
  svg.appendChild(NS('circle', { cx: 80,  cy: eyeY, r: 5, fill: '#1a1a1a' }));
  svg.appendChild(NS('circle', { cx: 120, cy: eyeY, r: 5, fill: '#1a1a1a' }));
  // Eye glints
  svg.appendChild(NS('circle', { cx: 82,  cy: eyeY - 2, r: 1.5, fill: '#fff' }));
  svg.appendChild(NS('circle', { cx: 122, cy: eyeY - 2, r: 1.5, fill: '#fff' }));

  // Glasses
  if (hasGlasses) {
    svg.appendChild(NS('circle', { cx: 80,  cy: eyeY, r: 11, fill: 'none', stroke: '#1a1a1a', 'stroke-width': '2.5' }));
    svg.appendChild(NS('circle', { cx: 120, cy: eyeY, r: 11, fill: 'none', stroke: '#1a1a1a', 'stroke-width': '2.5' }));
    svg.appendChild(NS('line', { x1: 91, y1: eyeY, x2: 109, y2: eyeY, stroke: '#1a1a1a', 'stroke-width': '2.5' }));
  }

  // Nose
  svg.appendChild(NS('path', {
    d: 'M 100 122 Q 96 134 100 138 Q 104 138 104 134',
    fill: 'none', stroke: '#1a1a1a', 'stroke-width': '2', 'stroke-linecap': 'round',
  }));

  // Mouth — neutral smile, class 'mouth' so we can swap on grin
  const mouth = NS('path', {
    class: 'mouth',
    d: 'M 88 148 Q 100 156 112 148',
    fill: 'none', stroke: '#1a1a1a', 'stroke-width': '2.5', 'stroke-linecap': 'round',
  });
  svg.appendChild(mouth);

  return svg;
}

/** Swap the customer's mouth to a big grin. */
function setCustomerGrin(svg, grinning) {
  const mouth = svg.querySelector('.mouth');
  if (!mouth) return;
  if (grinning) {
    mouth.setAttribute('d', 'M 84 144 Q 100 168 116 144 Q 100 156 84 144 Z');
    mouth.setAttribute('fill', '#7a2c2c');
  } else {
    mouth.setAttribute('d', 'M 88 148 Q 100 156 112 148');
    mouth.setAttribute('fill', 'none');
  }
}

window.MMCharacters = { buildCustomer, setCustomerGrin };
