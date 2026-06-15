# CLAUDE.md — pokyny pro tento projekt (TČ Expert PRO)

## Pravidla pro vypisování kódu (VŽDY dodržovat)

Při vypisování kódu této aplikace se **vždy** řiď těmito pravidly:

1. **Kompletnost kódu** — vždy vypisuj celý kód nebo kompletní modul. Nikdy
   nepoužívej zkrácené úryvky, vynechané části (např. „zbytek kódu zde") ani
   náhrady malých úseků bez výslovného požádání.

2. **Hlavní kostra** — při generování hlavní kostry nevkládej kód přímo do
   modulů. Obsah tagů `<style>` a `<script>` nahraď zástupným textem
   (např. `<script id="module-ui" data-module="UI">UI</script>`). Kostru
   generuj striktně od `<html>` do `</html>` (v souboru jí předchází
   `<!DOCTYPE html>`).

3. **Vše najednou jako soubory** — u projektů s více částmi NEVYPISUJ moduly
   postupně jeden po druhém a nečekej na pokyn. Vlož všechny části najednou
   jako samostatné soubory (kostru + každý modul zvlášť) a doruč je uživateli.

4. **Absence obalovacích tagů** — u konkrétních modulů (souborů) nepiš
   obalovací HTML tagy (`<script>`, `<style>`). Obsahem souboru je pouze
   samotný vnitřní kód (čisté JS nebo CSS). Kostra zůstává s placeholdery.

5. **Automatická analýza** — pokud je zaslán pouze kód bez dalšího dotazu,
   automaticky ho zanalyzuj a poskytni názor na jeho strukturu, fungování
   a účel.

### Pořadí modulů
Kostra → `CSS` → `WORKER` → `STATE` → `UTILS` → `API` → `CHARTS` → `UI`

## Struktura projektu
- `index.html` — sestavená jednosouborová aplikace (výstup buildu).
- `modules/` — zdrojové moduly: `skeleton.html` (kostra s placeholdery),
  `module-css.css`, `module-worker.js`, `module-state.js`, `module-utils.js`,
  `module-api.js`, `module-charts.js`, `module-ui.js`.
- `build.js` — složí `modules/` zpět do `index.html` (`node build.js`).
  Po úpravě modulů vždy znovu sestav `index.html`.
- `VYLEPSENI-PLAN.md` — roadmapa vylepšení. `OPRAVY.md` — historie oprav.

## Styl kódu
- Komentáře a UI texty česky. Zachovávej stávající styl (`let`/`const`/
  `function`, odsazení). Změny preferuj additivní a defenzivní.
