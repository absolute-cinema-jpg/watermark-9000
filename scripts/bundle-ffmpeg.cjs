// Copies the self-contained ffmpeg/ffprobe binaries into build/bin so they ship inside the .app
// (Contents/Resources/bin). They link only macOS system frameworks, so no Homebrew is needed.
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'build', 'bin');
fs.mkdirSync(out, { recursive: true });

const sources = {
  ffmpeg: require('ffmpeg-static'),
  ffprobe: require.resolve('@ffprobe-installer/darwin-arm64/ffprobe'),
};

for (const [name, src] of Object.entries(sources)) {
  if (!src || !fs.existsSync(src)) throw new Error(`Missing ${name} binary (${src}) — run npm install`);
  const dest = path.join(out, name);
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  console.log(`bundled ${name} → ${path.relative(process.cwd(), dest)}`);
}
