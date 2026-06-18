#!/usr/bin/env node
/**
 * build.js — složí modulární zdroje z modules/ zpět do jediného index.html.
 *
 * Vezme modules/skeleton.html (kostra od <html> po </html> se zástupnými
 * texty CSS/WORKER/STATE/... uvnitř <style>/<script> tagů) a nahradí vnitřek
 * každého tagu obsahem odpovídajícího modulového souboru.
 *
 * Použití:  node build.js
 * Výstup:   index.html v kořeni projektu.
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MOD = path.join(ROOT, 'modules');

// Mapování: id tagu v kostře -> soubor s vnitřním kódem
const MODULES = [
  { id: 'module-style', file: 'module-css.css' },
  { id: 'workerScript', file: 'module-worker.js' },
  { id: 'module-state', file: 'module-state.js' },
  { id: 'module-utils', file: 'module-utils.js' },
  { id: 'module-api', file: 'module-api.js' },
  { id: 'module-charts', file: 'module-charts.js' },
  { id: 'module-ui', file: 'module-ui.js' },
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function build() {
  const skeletonPath = path.join(MOD, 'skeleton.html');
  let html = fs.readFileSync(skeletonPath, 'utf8');

  for (const { id, file } of MODULES) {
    const code = fs.readFileSync(path.join(MOD, file), 'utf8');
    // Najdi <style|script ... id="ID" ...>VNITŘEK</style|script> a nahraď vnitřek.
    const re = new RegExp(
      '(<(?:style|script)[^>]*\\bid="' + escapeRegExp(id) + '"[^>]*>)([\\s\\S]*?)(</(?:style|script)>)'
    );
    if (!re.test(html)) {
      throw new Error('Kostra neobsahuje tag s id="' + id + '"');
    }
    // Vlož obsah modulu jako celý řádek mezi otevírací a zavírací tag.
    html = html.replace(re, (_m, open, _inner, close) => open + '\n' + code + '\n' + close);
  }

  const outPath = path.join(ROOT, 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('OK: index.html sestaven (' + html.split('\n').length + ' řádků).');
}

build();
