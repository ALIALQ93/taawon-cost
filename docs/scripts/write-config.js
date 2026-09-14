const fs = require('fs');
const path = require('path');

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

const out = `window.TAAWON_CONFIG = {
  supabaseUrl: ${JSON.stringify(url)},
  supabaseAnonKey: ${JSON.stringify(key)},
};
`;

const target = path.join(__dirname, '..', 'config.js');
fs.writeFileSync(target, out, 'utf8');
console.log('Wrote', target);
