// Construit un fichier HTML unique (sans doctype/html/head/body) pour publication en page hébergée.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const assets = readdirSync('dist/assets');
const css = readFileSync('dist/assets/' + assets.find((f) => f.endsWith('.css')), 'utf8');
let js = readFileSync('dist/assets/' + assets.find((f) => f.endsWith('.js')), 'utf8');
if (/\bimport\s*\(/.test(js) || /^import\s/m.test(js)) throw new Error('le bundle contient des imports');
js = js.replace(/<\/script/gi, '<\\/script');
const html = `<title>AI Fighter 2</title>
<style>
:root { color-scheme: dark; }
${css}
</style>
<script>window.__AIF2_NO_NET = true;</script>
<canvas id="game"></canvas>
<div id="ui"></div>
<div id="toast"></div>
<script type="module">
${js}
</script>
`;
writeFileSync(process.argv[2] ?? 'dist/ai-fighter-2.html', html);
console.log('fichier unique :', (html.length / 1024).toFixed(0), 'Ko');
