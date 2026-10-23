#!/usr/bin/env bash
# Compile le jeu en WebAssembly et produit :
#  - web/lumen.wasm              (pour servir le dossier web/)
#  - dist/lumen-requiem.html     (version autonome, un seul fichier)
set -euo pipefail
cd "$(dirname "$0")"
rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
cargo build -p lumen_core --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/lumen_core.wasm web/lumen.wasm
mkdir -p dist
python3 - <<'PY'
import base64, re
w = open("web/lumen.wasm", "rb").read()
html = open("web/index.html", encoding="utf-8").read()
css = open("web/style.css", encoding="utf-8").read()
js = open("web/main.js", encoding="utf-8").read()
html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "\n</style>")
inline = "<script>window.LUMEN_WASM_B64=\"" + base64.b64encode(w).decode() + "\";</script>\n<script>\n" + js + "\n</script>"
html = html.replace('<script src="main.js"></script>', inline)
open("dist/lumen-requiem.html", "w", encoding="utf-8").write(html)
print("dist/lumen-requiem.html", len(html) // 1024, "Ko")
PY
# Variante « Artifact » (claude.ai) : sans balises doctype/html/head/body.
python3 - <<'PY'
import re
s = open("dist/lumen-requiem.html", encoding="utf-8").read()
s = re.sub(r"<!doctype html>\s*", "", s, flags=re.I)
s = re.sub(r"</?(html|head|body)[^>]*>\s*", "", s)
s = re.sub(r'<meta (charset|name="viewport"|name="theme-color")[^>]*>\s*', "", s)
open("dist/lumen-requiem-artifact.html", "w", encoding="utf-8").write(s)
PY
