// Generates the Budget Up duck icons (SVG + PNGs). Run: npm run icons
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/icons');

// A "$" drawn as paths (no fonts needed) centred on (0,0), roughly 1 unit tall radius.
const dollar = (cx, cy, s) => `
  <g transform="translate(${cx} ${cy}) scale(${s})" fill="none" stroke="#12a150" stroke-linecap="round" stroke-linejoin="round" stroke-width="0.17">
    <path d="M0.36,-0.40 C0.20,-0.64 -0.44,-0.60 -0.41,-0.22 C-0.38,0.12 0.41,0.06 0.43,0.38 C0.44,0.68 -0.22,0.70 -0.38,0.42"/>
    <path d="M0,-0.80 L0,0.80"/>
  </g>`;

// The duck on a 512x512 canvas, no background.
const duck = `
  <ellipse cx="256" cy="452" rx="150" ry="22" fill="#ffffff" opacity="0.28"/>
  <path d="M96 330 C70 300 62 262 84 236 C98 252 112 262 132 266 Z" fill="#f6b800"/>
  <ellipse cx="256" cy="352" rx="158" ry="104" fill="#ffd21f" stroke="#e5a400" stroke-width="7"/>
  <ellipse cx="150" cy="350" rx="38" ry="58" fill="#f6b800" transform="rotate(14 150 350)"/>
  <ellipse cx="362" cy="350" rx="38" ry="58" fill="#f6b800" transform="rotate(-14 362 350)"/>
  <circle cx="256" cy="204" r="122" fill="#ffd21f" stroke="#e5a400" stroke-width="7"/>
  <path d="M244 84 C232 58 258 44 270 58 C262 66 266 76 258 90 Z" fill="#ffd21f" stroke="#e5a400" stroke-width="6" stroke-linejoin="round"/>
  <ellipse cx="256" cy="262" rx="62" ry="36" fill="#ff8a1c" stroke="#d96a00" stroke-width="6"/>
  <path d="M206 258 Q256 280 306 258" fill="none" stroke="#d96a00" stroke-width="6" stroke-linecap="round"/>
  <circle cx="204" cy="190" r="45" fill="#ffffff" stroke="#e5a400" stroke-width="5"/>
  <circle cx="308" cy="190" r="45" fill="#ffffff" stroke="#e5a400" stroke-width="5"/>
  ${dollar(204, 190, 34)}
  ${dollar(308, 190, 34)}
  <ellipse cx="160" cy="246" rx="16" ry="9" fill="#ff9f6b" opacity="0.55"/>
  <ellipse cx="352" cy="246" rx="16" ry="9" fill="#ff9f6b" opacity="0.55"/>`;

const bg = (r) => `
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2b6cf0"/><stop offset="1" stop-color="#14367e"/></linearGradient></defs>
  <rect width="512" height="512" rx="${r}" fill="url(#g)"/>`;

const wrap = (inner, scale = 1) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${inner}</g></svg>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`;

const files = {
  // Duck only (transparent) - used in the app header and as the favicon.
  'duck.svg': svg(duck),
  // Rounded app icon with background.
  'icon.svg': svg(bg(112) + `<g transform="translate(256 262) scale(0.88) translate(-256 -256)">${duck}</g>`),
};
for (const [name, content] of Object.entries(files)) writeFileSync(path.join(out, name), content);

const png = async (name, size, body) => {
  await sharp(Buffer.from(body), { density: 384 }).resize(size, size).png().toFile(path.join(out, name));
  console.log('wrote', name);
};
const rounded = svg(bg(112) + `<g transform="translate(256 262) scale(0.88) translate(-256 -256)">${duck}</g>`);
const fullBleed = (scale) => svg(bg(0) + `<g transform="translate(256 262) scale(${scale}) translate(-256 -256)">${duck}</g>`);

await png('icon-192.png', 192, rounded);
await png('icon-512.png', 512, rounded);
await png('icon-maskable-512.png', 512, fullBleed(0.66)); // keeps the duck inside the maskable safe zone
await png('apple-touch-icon.png', 180, fullBleed(0.8));
await png('favicon-32.png', 32, rounded);
