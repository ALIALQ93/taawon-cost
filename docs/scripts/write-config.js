const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pub = path.join(root, 'public');

const url = process.env.SUPABASE_URL || '';
const key =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

if (!url || !key) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in environment.'
  );
  process.exit(1);
}

fs.rmSync(pub, { recursive: true, force: true });
fs.mkdirSync(path.join(pub, 'data'), { recursive: true });

fs.writeFileSync(
  path.join(pub, 'config.js'),
  `window.TAAWON_CONFIG = {
  supabaseUrl: ${JSON.stringify(url)},
  supabaseAnonKey: ${JSON.stringify(key)},
};
`,
  'utf8'
);

for (const name of ['index.html', 'app.js', 'styles.css']) {
  const src = path.join(root, name);
  if (!fs.existsSync(src)) {
    console.error('Missing file:', name);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(pub, name));
}

const dataDir = path.join(root, 'data');
if (fs.existsSync(dataDir)) {
  for (const name of fs.readdirSync(dataDir)) {
    fs.copyFileSync(path.join(dataDir, name), path.join(pub, 'data', name));
  }
} else {
  console.warn('Warning: docs/data/ not found — app will load without JSON data.');
}

console.log('Built static site into', pub);
