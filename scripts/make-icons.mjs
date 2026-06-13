// Generates the app icons from one SVG source (a footprint inside a WhatsApp-
// style speech-bubble ring on green). Run: node scripts/make-icons.mjs
import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#46c655"/>
  <circle cx="256" cy="250" r="150" fill="none" stroke="#ffffff" stroke-width="36"/>
  <path d="M150 352 L104 420 L196 392 Z" fill="#ffffff"/>
  <g fill="#ffffff">
    <ellipse cx="254" cy="256" rx="60" ry="50"/>
    <ellipse cx="250" cy="322" rx="42" ry="46"/>
    <ellipse cx="212" cy="176" rx="23" ry="27"/>
    <ellipse cx="256" cy="161" rx="18" ry="22"/>
    <ellipse cx="294" cy="169" rx="15" ry="18"/>
    <ellipse cx="325" cy="186" rx="12.5" ry="15"/>
    <ellipse cx="351" cy="208" rx="10.5" ry="13"/>
  </g>
</svg>`;

const buf = Buffer.from(svg);
const targets = [
  { file: "public/icon-192.png", size: 192 },
  { file: "public/icon-512.png", size: 512 },
  { file: "src/app/apple-icon.png", size: 180 },
];

await writeFile("src/app/icon.svg", svg);
for (const t of targets) {
  await sharp(buf, { density: 384 })
    .resize(t.size, t.size)
    .png()
    .toFile(t.file);
  console.log("wrote", t.file);
}
console.log("wrote src/app/icon.svg");
