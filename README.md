# TČ Expert PRO

Jednosouborová webová aplikace pro **analýzu chodu tepelného čerpadla (TČ)**
z exportního logu — efektivita (COP/SCOP), ekonomika, dlouhodobá
termodynamika budovy, zdraví/opotřebení a simulace úspor. Běží plně
v prohlížeči, bez serveru; těžké výpočty jdou do Web Workeru.

## Spuštění
Otevři `index.html` v prohlížeči. Žádný build pro běh není potřeba — je to
sestavený jednosoubor. Pro vývoj viz níže.

1. Klikni **„📂 Načíst LOG"** (nebo přetáhni soubor do okna) a nahraj
   exportní `.txt`/`.csv` log z TČ.
2. Přepínej **Jednoduchý / Expertní** režim (přepínač 🤓/😎).
3. Procházej záložky: Přehled, Termo, Grafy, Simulace, Finance.

## Struktura projektu
- `index.html` — **sestavená** aplikace (výstup buildu, needituj ručně).
- `modules/` — **zdrojové** moduly:
  - `skeleton.html` — kostra `<html>`→`</html>` s placeholdery (`CSS`,
    `WORKER`, `STATE`, `UTILS`, `API`, `CHARTS`, `UI`).
  - `module-css.css` — styly.
  - `module-worker.js` — výpočetní jádro (Web Worker).
  - `module-state.js` — stav, konfigurace, persistence.
  - `module-utils.js` — pomocné funkce, formátování (Intl cs-CZ).
  - `module-api.js` — komunikace s workerem, import, robustnost.
  - `module-charts.js` — grafy (Chart.js v4).
  - `module-ui.js` — DOM, UX, události.
- `build.js` — složí `modules/` zpět do `index.html`.
- `manifest.json`, `sw.js`, `icon.svg` — PWA (instalace + offline).
- `VYLEPSENI-PLAN.md` — roadmapa vylepšení. `OPRAVY.md` — historie oprav.
- `CLAUDE.md` — konvence pro generování/vypisování kódu.

## Vývoj a build
Po úpravě čehokoli v `modules/` vždy znovu sestav `index.html`:

```bash
node build.js
```

Build nahradí zástupné texty v `skeleton.html` obsahem modulových souborů.
Doporučená kontrola JS modulů před buildem:

```bash
for f in modules/module-*.js; do node --check "$f"; done
```

## PWA / offline
Appka má `manifest.json` + service worker (`sw.js`), takže ji lze
**nainstalovat na plochu** a po prvním online načtení funguje i offline
(app-shell se precachuje, ostatní zdroje se cachují za běhu).

> Pozn.: Chart.js a fonty se zatím tahají z CDN. Offline proto funguje
> až po prvním načtení s připojením (SW je oportunisticky uloží). Plné
> offline „od nuly" vyžaduje vendorování Chart.js/fontů lokálně
> (plán #38/#39) — připraveno k doplnění.

## Co bylo vylepšeno (přehled)
Vývoj probíhal v iteracích s revizí:
- **Opravy:** ošetření chyb tooltipu (NaN), `worker.onerror`, prázdné
  `catch` bloky, dělení nulou v ekvitermní křivce, off-by-one u odmrazu.
- **Robustnost:** validace zpráv workeru, watchdog timeout, globální
  error handlery, limit velikosti souboru, verzování konfigurace.
- **UX (uživatelský režim):** barevná skóre + verdikt + vysvětlení,
  souhrnné skóre, akce „Co dělat teď", trendy skóre, akční „Příběh",
  verdikt + servisní připomínka opotřebení kompresoru, drag&drop import.
- **Grafy:** zjednodušená legenda v user módu, tlačítko Reset zoom,
  hezčí prázdné stavy.
- **Simulátory:** porovnání před/po + předvolby opatření.
- **Přístupnost:** větší dotykové cíle, `:focus-visible`, silnější
  kontrast, rozšířené `prefers-reduced-motion`.
- **Infrastruktura:** modularizace + `build.js`, PWA app-shell.

Podrobná roadmapa a stav: viz `VYLEPSENI-PLAN.md`.
