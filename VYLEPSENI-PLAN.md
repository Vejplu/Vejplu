# TČ Expert PRO — Plán vylepšení (150+ bodů)

Souhrnný, prioritizovaný plán napříč uživatelskou částí i technickým jádrem.
Body jsou číslované průběžně a seskupené podle oblastí. Značky priority:
**[P1]** vysoká / rychlá výhra, **[P2]** střední, **[P3]** nice-to-have.

---

## A. Robustnost a zpracování chyb
1. **[P1]** Nahradit prázdné `catch {}` bloky logováním (`console.error`) + vizuálním fallbackem (api ~5552/5581, charts ~6230, ui `openCurveModal`/`renderCalendar`).
2. **[P1]** Ošetřit dělení nulou v ekvitermní interpolaci LWT při `tOutMax === tOutMin` (charts ~6129, worker ~1876).
3. **[P1]** Validovat všechna číselná pole v Nastavení (clamp na rozumný rozsah, odmítnout NaN/prázdné, vizuální chyba).
4. **[P2]** Jednotná validace tvaru zpráv z workeru (kontrola `type`, povinných polí) na jednom místě.
5. **[P2]** Timeout + retry pro `worker.postMessage` ↔ odpověď (detekce „worker neodpovídá").
6. **[P2]** Globální `window.onerror` / `onunhandledrejection` v hlavním vlákně → toast s chybou.
7. **[P2]** Obalit inicializaci workeru `try/catch` (chybějící `#workerScript` element).
8. **[P3]** Sentinel hodnoty (`9999999999`, `-1`) nahradit `null` + explicitními guardy.
9. **[P2]** Po chybě umožnit „Zkusit znovu" bez reloadu stránky.
10. **[P3]** Rozlišit typy chyb (data / síť / konfigurace) a zobrazit odpovídající radu.

## B. Výpočetní jádro a přesnost algoritmů
11. **[P2]** Opravit off-by-one v detekci odmrazu (`for (k = run.end …)` → `run.end + 1`, worker ~4208).
12. **[P2]** Magické konstanty (`2400 W`, `145 W`, `COP 3.0`, `4.0`…) přesunout do pojmenovaných defaultů v configu.
13. **[P2]** Oddělit `hddCustom` (cílová teplota) od `hddStd` (18 °C Eurostat) v denních metrikách, ať se nepletou.
14. **[P3]** Dokumentovat (komentářem) zdroj všech korekčních faktorů (Jensen, ztráty TUV…).
15. **[P3]** Citlivostní analýza: ukázat, jak moc výsledek závisí na klíčových konfiguračních hodnotách.
16. **[P3]** Kontrola fyzikální smysluplnosti výsledků (COP > 0, ztráty ≥ 0) s upozorněním.
17. **[P2]** Sjednotit jednotky v názvech proměnných (W vs Wh) — prevence záměn.
18. **[P3]** Umožnit volbu prahu HDD (15/18/21 °C) pro srovnání s benchmarky.

## C. Architektura a údržba
19. **[P1]** **Build skript** (`node build.js`), který složí `modules/*` zpět do `index.html` (placeholder → obsah).
20. **[P1]** `npm run build` + `npm run dev` (watch režim).
21. **[P2]** Postupně nahradit inline `onclick="App.x()"` za `addEventListener` / event delegaci.
22. **[P2]** Zapouzdřit globální stav (`worker`, `myChart`, `CONFIG`) do modulu s jasným API.
23. **[P2]** Zavést ESLint + Prettier (jednotný styl, chytání chyb).
24. **[P3]** Migrovat na ES moduly (`import`/`export`) místo globálního `App`.
25. **[P3]** TypeScript (nebo JSDoc typy) pro výpočetní jádro.
26. **[P2]** Definovat datové schéma vstupního logu na jednom místě.
27. **[P3]** Oddělit „čistou logiku" od DOM (testovatelnost).
28. **[P3]** Verzování konfigurace + migrace při změně schématu v `localStorage`.

## D. Výkon
29. **[P2]** Profilovat parsování velkých logů; zvážit streamované zpracování.
30. **[P3]** Přesunout těžké smyčky do typed arrays.
31. **[P2]** Debounce u slideru ceny/teploty/zateplení (přepočet až po doznění).
32. **[P3]** Virtualizace dlouhých tabulek v exportu.
33. **[P2]** Cache výsledků workeru podle hashe dat+configu (přeskočit přepočet).
34. **[P3]** Lazy-load Chart.js až při otevření záložky Grafy.
35. **[P3]** Omezit překreslování grafů (`update('none')` kde stačí).

## E. PWA a offline
36. **[P1]** Přidat **Web App Manifest** (název, ikony, barvy) — máš už meta tagy, chybí manifest.
37. **[P1]** **Service Worker** pro offline běh.
38. **[P1]** Hostovat **Chart.js lokálně** (teď CDN → bez netu appka spadne).
39. **[P1]** Hostovat fonty lokálně (Inter) místo Google Fonts.
40. **[P2]** Cache historických dat o počasí (offline + úspora API volání).
41. **[P2]** „Přidat na plochu" výzva (A2HS) na mobilu.
42. **[P3]** Offline indikátor + fronta akcí.
43. **[P3]** Verzování SW + upozornění „Dostupná nová verze".

## F. Bezpečnost
44. **[P2]** Dynamický obsah přes `textContent`/escapování místo `innerHTML` (např. „story" v `userInsightsBox`).
45. **[P2]** Content Security Policy (po odstranění inline handlerů).
46. **[P3]** Sanitizace importovaných CSV/textů před zobrazením.
47. **[P3]** Omezit oprávnění (žádné zbytečné `eval`, externí skripty).
48. **[P3]** Kontrola velikosti/typu nahrávaného souboru (ochrana před zamrznutím).
49. **[P3]** Subresource Integrity (SRI), dokud zůstává CDN.

## G. Testování a CI
50. **[P1]** Unit testy výpočetního jádra (COP, SCOP, bivalence, HDD, ztráty) na vzorovém logu.
51. **[P2]** Snapshot testy exportů (cykly/denní/měsíční/servisní zpráva).
52. **[P2]** Testy hraničních případů (prázdná data, 1 den, chybějící pole).
53. **[P2]** GitHub Actions: build + testy + lint na každý push.
54. **[P3]** E2E test (Playwright): načtení logu → vykreslení dashboardu.
55. **[P3]** Vizuální regrese grafů.
56. **[P3]** Fixture sada reálných (anonymizovaných) logů.
57. **[P3]** Badge se stavem CI v README.

## H. Uživatelský režim — první dojem a onboarding
58. **[P1]** Onboarding obrazovka: co appka umí + výrazné **„📂 Načíst LOG"** (teď schované v hlavičce).
59. **[P1]** Tlačítko **„Vyzkoušet na vzorových datech"** (demo log).
60. **[P2]** Prázdný stav každé záložky s vysvětlením místo holého `-`.
61. **[P2]** Krátký průvodce („3 kroky: nahraj log → nastav dům → koukni na úspory").
62. **[P3]** Uvítací tip dne / náhodný insight.
63. **[P2]** Po prvním načtení zvýraznit nejdůležitější číslo (roční účet / verdikt).
64. **[P3]** Uložit poslední nahraný log do `localStorage` (rychlý návrat).
65. **[P3]** Drag & drop souboru kamkoli na plochu.
66. **[P2]** Jasná hláška při špatném formátu logu („Tohle nevypadá jako log z…").

## I. Navigace a režimy
67. **[P1]** V `mode-user` skrýt/zjednodušit technické záložky (Termo, případně Grafy).
68. **[P1]** U přepínače 🤓/😎 popisek „Jednoduchý / Expertní režim".
69. **[P2]** Zapamatovat zvolený režim mezi návštěvami.
70. **[P2]** Plynulý přechod (animace) mezi režimy.
71. **[P3]** Hlubší odkazy (sdílení konkrétní záložky/data URL).
72. **[P3]** Gesto swipe mezi záložkami na mobilu.
73. **[P3]** Zvýraznit aktivní záložku výrazněji (a11y i vizuálně).

## J. Skóre a hodnocení (4 kolečka)
74. **[P1]** Barevné kódování koleček (zelená/žlutá/červená) dle hodnoty.
75. **[P1]** Jednoslovný verdikt pod kolečkem („Výborné / OK / Pozor").
76. **[P1]** Tap-to-explain: po klepnutí lidské vysvětlení, co skóre znamená.
77. **[P2]** Trend u skóre (↑/↓ vs minulé období).
78. **[P2]** Celkové souhrnné skóre (jedno číslo) + smajlík.
79. **[P3]** Animovaný „count-up" číselník při načtení.
80. **[P3]** Porovnání s typickou domácností (benchmark).
81. **[P2]** Co konkrétně skóre zhoršuje + odkaz na nápravu.
82. **[P3]** Historie skóre v čase (mini sparkline).

## K. Příběh a doporučení
83. **[P1]** Posunout „Příběh" od popisu k **akci s číslem** („−1 °C ⇒ ušetříte ~X Kč/rok").
84. **[P1]** Provázat doporučení přímo se **simulátory** („Vyzkoušet →").
85. **[P2]** Prioritizovat doporučení dle dopadu (Kč) a snadnosti.
86. **[P2]** Sekce „Co dělat teď" (max 3 kroky).
87. **[P3]** Detekce anomálií („tento týden vyšší spotřeba než obvykle").
88. **[P3]** Sezónní tipy (před zimou / přechodné období).
89. **[P3]** Možnost skrýt/odložit doporučení.

## L. Laboratoř úspor (simulátory)
90. **[P1]** Zvýraznit Laboratoř — pro uživatele hodnotnější než Termo.
91. **[P1]** Porovnání **před/po** vedle sebe, ne jen výsledná částka.
92. **[P2]** Předvolby místo abstraktních % („Zateplit fasádu", „Vyměnit okna", „Nová sazba elektřiny").
93. **[P2]** Kombinovat více opatření najednou a vidět souhrnnou úsporu.
94. **[P2]** Návratnost investice (zadám cenu opatření → roky do návratu).
95. **[P3]** Posuvník „cílová teplota TUV" a jeho dopad na COP/účet.
96. **[P3]** Uložit a pojmenovat scénáře, porovnat je.
97. **[P3]** Sdílet výsledek simulace (obrázek/odkaz).

## M. Opotřebení kompresoru a servis
98. **[P1]** Jasný verdikt: „TČ je v kondici, odhad životnosti ~X let".
99. **[P2]** Vysvětlit, proč na počtu startů záleží (lidsky).
100. **[P2]** Upozornění na servisní intervaly (odmrazování, tlaky, napětí).
101. **[P3]** Predikce opotřebení do budoucna (trend startů).
102. **[P3]** Připomínka pravidelného servisu (datum instalace už máš).
103. **[P3]** Export servisní zprávy přímo z uživatelského režimu (PDF).

## N. Grafy a vizualizace
104. **[P2]** Zjednodušená legenda v `mode-user` (8 barev je moc).
105. **[P2]** Přednastavené pohledy („Dnes", „Týden", „Sezóna") místo ruční navigace.
106. **[P2]** Vysvětlivky barev přímo v grafu (po klepnutí).
107. **[P3]** Anotace událostí (odmraz, výpadek) přímo v grafu.
108. **[P2]** Lepší tooltip pro dotyk (větší, čitelnější) — navazuje na opravu „NaN W".
109. **[P3]** Tlačítko reset zoomu/scrollu.
110. **[P3]** Export grafu jako obrázek.
111. **[P2]** Stav „žádná data" v grafu hezčí než holé „Žádná data".
112. **[P3]** Tmavý/světlý motiv.

## O. Finance
113. **[P2]** Sjednotit zaokrouhlování a formát měny (Kč) přes `Intl.NumberFormat`.
114. **[P2]** Vysvětlit rozdíl „Model" vs „Reálný odhad" lidsky.
115. **[P3]** Rozpad nákladů koláčovým grafem (Topení/TUV/Standby).
116. **[P3]** Porovnání s předchozí sezónou.
117. **[P3]** Nastavení tarifu (VT/NT, distribuce) pro přesnější účet.

## P. Termo (analytický režim)
118. **[P2]** Inline „?" vysvětlivky i u klíčových termo-metrik (jako v Nastavení).
119. **[P3]** Zvýraznit varovné stavy (bivalence příliš vysoko, COP nízký).
120. **[P3]** Srovnání naměřeného SPF s projekcí (přehledně).

## Q. Nastavení a konfigurace
121. **[P2]** Sdružit nastavení do „Základní" (pro uživatele) vs „Pokročilé" (analytik).
122. **[P2]** Reset na výchozí hodnoty + reset jednotlivé sekce.
123. **[P2]** Indikace neuložených/nevalidních hodnot.
124. **[P3]** Import/export konfigurace (JSON).
125. **[P3]** Předvyplnění lokality přes geolokaci (se souhlasem).
126. **[P3]** Našeptávač modelu TČ podle výrobce.

## R. Prezentace, formátování, lokalizace
127. **[P2]** Velké W/Wh přepočítat na uživatelsky čitelné kWh/Kč/%/°C.
128. **[P2]** Centralizovat formátování čísel (`Intl.NumberFormat('cs-CZ')`) místo `replace('.', ',')`.
129. **[P3]** Připravit i18n (en) — texty do jednoho slovníku.
130. **[P3]** Konzistentní zaokrouhlování napříč appkou.
131. **[P3]** Relativní časy („před 2 dny") tam, kde dávají smysl.

## S. Přístupnost (a11y)
132. **[P1]** `aria-label` u emoji tlačítek (📥 ⚙️ ❮ ❯) a ikon.
133. **[P2]** Focus-trap a `Esc` pro zavření modálů.
134. **[P2]** Klávesová ovladatelnost (Tab pořadí, viditelný focus).
135. **[P2]** Dostatečný kontrast textu (zvl. `--text-dim`).
136. **[P2]** Větší dotykové cíle (min. 44×44 px).
137. **[P3]** `prefers-reduced-motion` i pro přechody (máš jen pro bloby).
138. **[P3]** Role/ARIA pro taby a nav.
139. **[P3]** Podpora čteček u grafů (textová alternativa hodnot).

## T. Export a sdílení
140. **[P2]** Náhled exportu před zkopírováním.
141. **[P3]** Export do PDF (servisní zpráva) i pro uživatele.
142. **[P3]** Sdílení souhrnu jako obrázek (Web Share API).
143. **[P3]** Šablony exportu (servis / účetnictví / vlastní).
144. **[P3]** Stažení i jako XLSX, nejen CSV.
145. **[P3]** Kopírování jednotlivých metrik z dashboardu.

## U. Import dat a kompatibilita
146. **[P2]** Podpora více formátů logů (autodetekce oddělovače/sloupců).
147. **[P2]** Náhled a mapování sloupců při importu.
148. **[P2]** Slučování více logů s deduplikací (částečně už řešeno).
149. **[P3]** Import přímo z cloudu/URL.
150. **[P3]** Validace časové osy (díry, překryvy) s reportem.
151. **[P3]** Ukázkový/anonymizovaný log přibalený v appce.

## V. Dokumentace a komunita
152. **[P2]** README s popisem, screenshoty a návodem.
153. **[P2]** Slovníček pojmů (COP, SCOP, bivalence, HDD, LWT) dostupný z appky.
154. **[P3]** FAQ / nejčastější problémy s logy.
155. **[P3]** Changelog a verzování releasů.
156. **[P3]** Krátké video/GIF s ukázkou.

---

## Doporučené pořadí realizace (první vlna)
1. **Build skript** (#19–20) — jinak se `modules/` a `index.html` rozejdou.
2. **Skóre: barvy + verdikt + vysvětlení** (#74–76) — rychlá, viditelná výhra.
3. **Skrýt technické záložky v `mode-user`** (#67) — méně zmatku.
4. **Akční „Příběh" + provázání se simulátory** (#83–84).
5. **PWA/offline + lokální Chart.js a fonty** (#36–39) — největší skok pro mobil.
6. **Ošetřit catch/div-by-zero/off-by-one** (#1, #2, #11) — nízké riziko.
7. **Unit testy jádra** (#50) — pojistka proti regresím.
