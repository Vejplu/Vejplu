# Oprava chyb — TČ Expert PRO

Revize jednosouborové aplikace `index.html` (~8 440 řádků, HTML + CSS + JS,
Web Worker + Chart.js). Níže seznam nalezených chyb a přesné změny kódu.

---

## ✅ Opravené chyby (ověřené, vysoká jistota)

### Oprava A — Tooltip grafu zobrazuje „NaN W"

**Místo:** CHARTS modul, ř. 6145 a 6147 (callback tooltipu)

**Problém:** `Math.round(d.p)` a `Math.round(d.tp)` nemají null-guard, zatímco
sousední pole ve stejném tooltipu ano (`d.cop`, `d.v`, `d.temp`). Když chybí
elektrický/tepelný příkon (mezera v datech, standby tik),
`Math.round(null/undefined)` vrátí `NaN` a v tooltipu se vykreslí doslova
„NaN W".

**Před:**
```js
<div class="ct-item" style="color:var(--accent)">⚡ ${Math.round(d.p)} W</div>
<div class="ct-div"></div>
<div class="ct-item" style="color:var(--success)">🔥 ${Math.round(d.tp)} W</div>
```

**Po:**
```js
<div class="ct-item" style="color:var(--accent)">⚡ ${d.p != null ? Math.round(d.p) : '-'} W</div>
<div class="ct-div"></div>
<div class="ct-item" style="color:var(--success)">🔥 ${d.tp != null ? Math.round(d.tp) : '-'} W</div>
```

---

### Oprava B — Chybějící `worker.onerror` → tichý zásek UI

**Místo:** API modul, inicializace workeru ř. ~5636

**Problém:** Worker hlásí očekávané chyby přes `postMessage({type:'ERROR'})`
jen z vnitřních `try/catch` bloků. `self.onmessage` je `async` (ř. 2384) a
neexistoval žádný `worker.onerror`. Při neodchycené výjimce (mimo try/catch
nebo odmítnutý promise) se nepošle žádná zpráva → hlavní vlákno zůstane viset
s loading overlayem („Zpracovávám data…") a uživatel nedostane zpětnou vazbu.

**Přidaný kód** (využívá existující zotavovací cestu — stejnou jako větev
`ERROR` na ř. 5670–5681; funkce `setLoading`, `showError`, `handleNoData`
existují na ř. 5604/5620/5574):
```js
worker = new Worker(window.URL.createObjectURL(workerBlob));

// ─── 1b. NEODCHYCENÉ CHYBY WORKERU ──────────────────────────────────────────
// Worker hlásí očekávané chyby přes postMessage({type:'ERROR'}), ale
// neodchycená výjimka (mimo try/catch nebo odmítnutý promise v async onmessage)
// by jinak nechala UI viset na loading overlayi bez zpětné vazby.
worker.onerror = function (err) {
    if (typeof App !== 'undefined' && App) {
        if (typeof App.setLoading === 'function') App.setLoading(false);
        if (typeof App.showError === 'function') App.showError('Chyba výpočetního jádra: ' + ((err && err.message) || 'neznámá chyba'));
        if (typeof App.handleNoData === 'function') App.handleNoData();
    }
};
```

---

## ❌ Zamítnuté nálezy (false-positive — ověřeno, neměněno)

- **`firstValid` `i > 0`** (ř. 1306): korektní — index 0 je teplotní hlavička
  řádku, COP hodnoty začínají od indexu 1.
- **`get95` percentil** (ř. 3068): korektní — záměrně hledá nejteplejší topný
  den bez horních 5 % outlierů (hranice topení), ne nejchladnější.
- **`mujGrafKrivky` „nedeklarovaná"**: deklarovaná na ř. 5305 (`let … = null`).
- **Modal close `className === 'modal-close'`** (ř. 7350 ad.): tlačítka volají
  `App.closeX(null)` → větev `!e` zavírá; striktní porovnání je nanejvýš
  redundantní, ne chyba.
- **Parsování data** `new Date(parts[0], parts[1]-1, parts[2])` (ř. 5708):
  vstup jsou řízené ISO klíče, ne uživatelský text — nízké riziko.

---

## ⚪ Vědomě vynecháno (mimo zvolený záběr „jen ověřené chyby")

Reálné, ale nízká priorita / pouze obranné — k případnému dořešení:

- Dělení nulou v ekvitermní interpolaci LWT při `tOutMax === tOutMin`
  (ř. 6129 a obdobně ve workeru ~1876) — nastane jen při chybné konfiguraci.
- Off-by-one v detekci odmrazu `for (k = run.end …)` vs `run.end + 1`
  (ř. 4208) — zahrnuje poslední bod cyklu.
- Prázdné `catch {}` bloky (ř. 5552, 5581, 6230 ad.) — tichá selhání, vhodné
  alespoň logovat.

---

## Verifikace

- Soubor je čistý HTML bez build kroku — otevřít `index.html` v prohlížeči.
- **Oprava A:** najet na bod grafu bez příkonu → tooltip ukáže „-" místo
  „NaN W".
- **Oprava B:** vyvolat výjimku ve workeru → místo trvalého „Zpracovávám
  data…" se zobrazí chybová hláška a UI se odemkne.
