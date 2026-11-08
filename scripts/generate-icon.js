const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;

const outDir = path.resolve(__dirname, '../build');
const pngDir = path.join(outDir, 'icons');
fs.mkdirSync(pngDir, { recursive: true });

const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1" />
      <stop offset="0.55" stop-color="#4f46e5" />
      <stop offset="1" stop-color="#7c3aed" />
    </linearGradient>
    <radialGradient id="glow" cx="0.18" cy="0.08" r="0.95">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.3" />
      <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
    </radialGradient>
  </defs>

  <rect width="1024" height="1024" rx="232" fill="url(#bg)" />
  <rect width="1024" height="1024" rx="232" fill="url(#glow)" />
  <rect x="26" y="26" width="972" height="972" rx="208" fill="none"
        stroke="#ffffff" stroke-opacity="0.16" stroke-width="4" />

  <circle cx="512" cy="512" r="288" fill="#ffffff" />

  <path d="M512 234 A278 278 0 0 1 790 512" fill="none"
        stroke="#fbbf24" stroke-width="34" stroke-linecap="round" />

  <path d="M452 368 L452 656 L680 512 Z" fill="#4338ca"
        stroke="#4338ca" stroke-width="56" stroke-linejoin="round" />
</svg>
`;

(async () => {
  const svgBuffer = Buffer.from(svg);
  const sizes = [1024, 512, 256, 128, 64, 48, 32, 16];
  const pngPaths = {};

  for (const size of sizes) {
    const target = path.join(pngDir, `icon-${size}.png`);
    await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(target);
    pngPaths[size] = target;
  }

  await sharp(svgBuffer, { density: 384 }).resize(1024, 1024).png().toFile(path.join(outDir, 'icon.png'));

  const ico = await pngToIco([pngPaths[256], pngPaths[128], pngPaths[64], pngPaths[48], pngPaths[32], pngPaths[16]]);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);

  console.log('Wrote build/icon.ico, build/icon.png and build/icons/*.png');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
