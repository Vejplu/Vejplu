
// ─── 1. INICIALIZACE WEB WORKERU ────────────────────────────────────────────
workerBlob = new Blob([document.getElementById('workerScript').textContent], { type: "text/javascript" });
worker = new Worker(window.URL.createObjectURL(workerBlob));

// ─── 1a. WATCHDOG STAV ──────────────────────────────────────────────────────
// Hlídací časovač pro „zaseknuté" joby. Klíčujeme podle jobId, aby se
// překrývající se joby nerušily navzájem (např. prefetch vs. hlavní výpočet).
window.__tcWatchdogs = window.__tcWatchdogs || {};
const WATCHDOG_TIMEOUT_MS = 30000; // ~30 s na dokončení těžkého výpočtu

// Spustí hlídací časovač pro daný jobId. Pokud nedorazí terminální zpráva
// (RESULT/NO_DATA/ERROR) pro tento job včas, odblokujeme UI a upozorníme.
function startWatchdog(jobId) {
    try {
        clearWatchdog(jobId);
        window.__tcWatchdogs[jobId] = setTimeout(function () {
            // Reagujeme jen pokud je tento job stále aktuální
            if (jobId === currentJobId) {
                if (typeof App !== 'undefined' && App) {
                    if (typeof App.setLoading === 'function') App.setLoading(false);
                    if (typeof App.showError === 'function') App.showError('Analýza trvá neobvykle dlouho…');
                    if (typeof App.handleNoData === 'function') App.handleNoData();
                }
            }
            delete window.__tcWatchdogs[jobId];
        }, WATCHDOG_TIMEOUT_MS);
    } catch (e) {
        console.error('startWatchdog: nepodařilo se spustit hlídací časovač', e);
    }
}

// Zruší hlídací časovač pro daný jobId (po doručení terminální zprávy).
function clearWatchdog(jobId) {
    try {
        if (window.__tcWatchdogs && window.__tcWatchdogs[jobId] !== undefined) {
            clearTimeout(window.__tcWatchdogs[jobId]);
            delete window.__tcWatchdogs[jobId];
        }
    } catch (e) {
        console.error('clearWatchdog: nepodařilo se zrušit hlídací časovač', e);
    }
}

// ─── 1c. GLOBÁLNÍ ODCHYT NEOŠETŘENÝCH CHYB ──────────────────────────────────
// Surfacujeme neodchycené výjimky a odmítnuté promisy přes App.showError,
// aby UI nezůstalo viset bez zpětné vazby. Chráníme se proti smyčce vlastní chyby.
window.__tcInGlobalErrorHandler = false;
window.addEventListener('error', function (ev) {
    if (window.__tcInGlobalErrorHandler) return;
    window.__tcInGlobalErrorHandler = true;
    try {
        const m = (ev && ev.message) || (ev && ev.error && ev.error.message) || 'neznámá chyba';
        console.error('Neodchycená chyba:', (ev && ev.error) || m);
        if (typeof App !== 'undefined' && App && typeof App.showError === 'function') {
            App.showError('Došlo k neočekávané chybě: ' + m);
        }
    } catch (e) {
        console.error('window.onerror handler selhal', e);
    } finally {
        window.__tcInGlobalErrorHandler = false;
    }
});
window.addEventListener('unhandledrejection', function (ev) {
    if (window.__tcInGlobalErrorHandler) return;
    window.__tcInGlobalErrorHandler = true;
    try {
        const reason = ev && ev.reason;
        const m = (reason && reason.message) || (typeof reason === 'string' ? reason : 'neznámá chyba');
        console.error('Neošetřený odmítnutý promise:', reason);
        if (typeof App !== 'undefined' && App && typeof App.showError === 'function') {
            App.showError('Došlo k neočekávané chybě: ' + m);
        }
    } catch (e) {
        console.error('window.onunhandledrejection handler selhal', e);
    } finally {
        window.__tcInGlobalErrorHandler = false;
    }
});

// ─── 1b. NEODCHYCENÉ CHYBY WORKERU ──────────────────────────────────────────
// Worker hlásí očekávané chyby přes postMessage({type:'ERROR'}), ale
// neodchycená výjimka (mimo try/catch nebo odmítnutý promise v async onmessage)
// by jinak nechala UI viset na loading overlayi bez zpětné vazby.
worker.onerror = function (err) {
    // Neodchycená chyba workeru je terminální pro běžící job — zrušíme jeho
    // hlídací časovač, ať se za ~30 s zbytečně nespustí znovu a nepřepíše UI.
    try { clearWatchdog(currentJobId); } catch (e) { console.error('worker.onerror: clearWatchdog selhal', e); }
    if (typeof App !== 'undefined' && App) {
        if (typeof App.setLoading === 'function') App.setLoading(false);
        if (typeof App.showError === 'function') App.showError('Chyba výpočetního jádra: ' + ((err && err.message) || 'neznámá chyba'));
        if (typeof App.handleNoData === 'function') App.handleNoData();
    }
};

// ─── 2. PŘÍJEM ZPRÁV Z WORKERU (onmessage) ──────────────────────────────────
worker.onmessage = function (e) {
    const msg = e ? e.data : null;
    // Validace tvaru zprávy: musí to být objekt s textovým polem `type`.
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
        console.error('worker.onmessage: ignoruji neplatnou zprávu z workeru', msg);
        return;
    }

    // --- Zpracování výsledku exportu z Workeru ---
    if (msg.type === 'EXPORT_RESULT') {
        const ta = document.getElementById('exportTextarea');
        if (ta) {
            ta.value = msg.textDisplay || msg.text || 'Chyba při sestavování dat.';
        }
        App.lastExportClipboard = msg.textClipboard || msg.text || '';
        App.lastExportCsv = msg.textCsv || msg.text || '';
        return;
    }
 
    if (msg.jobId !== currentJobId) return;
 
    const statusEl = document.getElementById('statusFreq');

    // --- Průběžný status ---
    if (msg.type === 'STATUS') {
        App.setLoading(true, msg.textDisplay);
        if (statusEl) {
            statusEl.innerText = msg.textDisplay;
            statusEl.style.borderLeftColor = "var(--accent)";
            statusEl.style.color = "var(--accent)";
        }
        return;
    }
 
    // --- Chyba ---
    if (msg.type === 'ERROR') {
        clearWatchdog(msg.jobId); // terminální zpráva — hlídací časovač už není třeba
        App.setLoading(false);
        if (typeof App.showError === 'function') App.showError("Chyba analýzy: " + (msg.error || "Neznámá chyba"));
        
        if (statusEl) {
            statusEl.innerText = "Chyba analýzy: " + (msg.error || "neznámá chyba");
            statusEl.style.borderLeftColor = "var(--danger)";
            statusEl.style.color = "var(--danger)";
        }
        if (typeof App.handleNoData === 'function') App.handleNoData();
        return;
    }
 
    // --- Přednačtená data (Prefetch) ---
    if (msg.type === 'CACHE_RESULT') {
        dayCache[msg.dateKey] = msg; 
        return;
    }
 
    // --- HLAVNÍ VÝSLEDEK (RESULT) ---
    if (msg.type === 'RESULT') {
        clearWatchdog(msg.jobId); // terminální zpráva — hlídací časovač už není třeba
        App.setLoading(false);
        
        const noData = document.getElementById('noDataMsg');
        if (noData) noData.style.display = 'none';
 
        if (statusEl) {
            statusEl.innerText = "Analýza hotova";
            statusEl.style.borderLeftColor = "var(--success)";
            statusEl.style.color = "var(--success)";
        }
 
        // Auto-přeskok na poslední dostupný den, pokud dnešek nemá data
        if (msg.windowData.length === 0 && isTodayMode && currentSelectionMode === 'day') {
            const dates = Object.keys(msg.dailyHealth || {}).sort();
            const lastDateStr = dates[dates.length - 1];
            if (lastDateStr) {
                const parts = lastDateStr.split('-');
                currentSelectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
                isTodayMode = false;
                if (App.updateDateLabel) App.updateDateLabel();
                App.runPipeline();
                return;
            }
        }
 
        // Uložení globálních stavů (pro Analytiku i Uživatelské simulátory)
        if (msg.seasonalStats) seasonalStats = msg.seasonalStats;
        if (msg.dailyStats) dailyStatsGlobal = msg.dailyStats;
        if (msg.monthlyStats) monthlyStatsGlobal = msg.monthlyStats;
        if (msg.dailyHealth) dailyHealthMap = msg.dailyHealth;
        if (msg.dynamicMonthlyCop) window.dynamicMonthlyCop = msg.dynamicMonthlyCop;
        
        // Uložení křivky bivalence a expertního skóre
        if (msg.maxTcCurve)     window.maxTcCurveGlobal     = msg.maxTcCurve;
        if (msg.thermoMetrics)  window.thermoMetricsGlobal  = msg.thermoMetrics;
        if (msg.financeMetrics) window.financeMetricsGlobal = msg.financeMetrics;
        if (msg.expertScore)    window.expertScoreGlobal    = msg.expertScore;
        // Globální hodnoty topné sezóny a modulace — ukládáme zvlášť mimo dayCache,
        // protože CACHE_RESULT (prefetch) je neobsahuje a dayCache[cacheKeys[0]]
        // může vrátit prefetchovaný den bez těchto polí
        if (msg.heatingBoundary    !== undefined) window.heatingBoundaryGlobal        = msg.heatingBoundary;
        if (msg.heatingBoundaryAutumn !== undefined) window.heatingBoundaryAutumnGlobal = msg.heatingBoundaryAutumn;
        if (msg.heatingBoundarySpring !== undefined) window.heatingBoundarySpringGlobal = msg.heatingBoundarySpring;
        if (msg.avgNormCopLongTerm !== undefined) window.avgNormCopLongTermGlobal      = msg.avgNormCopLongTerm;
        if (msg.copCurveWarning    !== undefined) window.copCurveWarningGlobal         = msg.copCurveWarning;
        if (msg.minModulationEl    !== undefined) window.minModulationElGlobal         = msg.minModulationEl;
        if (msg.minModulationTh    !== undefined) window.minModulationThGlobal         = msg.minModulationTh;

        // Uložíme aktuální výběr do cache
        let dKey = "TODAY";
        if (currentSelectionMode === 'day' && !isTodayMode) {
            dKey = `DAY_${currentSelectedDate.getFullYear()}-${String(currentSelectedDate.getMonth() + 1).padStart(2, '0')}-${String(currentSelectedDate.getDate()).padStart(2, '0')}`;
        } else if (currentSelectionMode === 'month') {
            dKey = `MONTH_${currentSelectedDate.getFullYear()}-${String(currentSelectedDate.getMonth() + 1).padStart(2, '0')}`;
        } else if (currentSelectionMode === 'year') {
            dKey = `YEAR_${currentSelectedDate.getFullYear()}`;
        }
        
        dayCache[dKey] = msg;
 
        App.applyDayData(msg);
        return;
    }
 
    if (msg.type === 'NO_DATA') {
        clearWatchdog(msg.jobId); // terminální zpráva — hlídací časovač už není třeba
        App.setLoading(false);
        if (statusEl) {
            statusEl.innerText = "Žádná data pro zvolené období";
            statusEl.style.borderLeftColor = "var(--warning)";
            statusEl.style.color = "var(--warning)";
        }
        if (typeof App.handleNoData === 'function') App.handleNoData();
        return;
    }
};

// ─── 3. NAČÍTÁNÍ LOGŮ, PIPELINE A EXPORT ────────────────────────────────────
App.handleFileUpload = async function (input) {
    if (!input || !input.files || input.files.length === 0) return;

    const files = Array.from(input.files);
    const statusEl = document.getElementById('statusFreq');
    const textParts = [];

    // ── Pojistka na velikost: u velmi velkých logů varujeme uživatele ──
    try {
        let totalSize = 0;
        for (let i = 0; i < files.length; i++) {
            totalSize += (files[i] && files[i].size) || 0;
        }
        const LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB
        if (totalSize > LIMIT_BYTES) {
            const mb = (totalSize / (1024 * 1024)).toFixed(0);
            const proceed = (typeof window.confirm === 'function')
                ? window.confirm('Vybrané soubory jsou velmi velké (' + mb + ' MB). Zpracování může být pomalé nebo selhat. Pokračovat?')
                : true;
            if (!proceed) {
                if (statusEl) {
                    statusEl.innerText = "Načítání zrušeno";
                    statusEl.style.borderLeftColor = "var(--warning)";
                    statusEl.style.color = "var(--warning)";
                }
                input.value = ''; // Reset file inputu
                return;
            }
        }
    } catch (e) {
        console.error('handleFileUpload: kontrola velikosti souborů selhala', e);
    }

    try {
        // TVRDÝ RESET PAMĚTI
        dayCache = {};
        workerHasData = false;
        
        // Smazání globálních proměnných
        currentStats = null;
        seasonalStats = {};
        dailyStatsGlobal = [];
        monthlyStatsGlobal = [];
        dailyHealthMap = {};
        selectedSeason = null;
        lastWindowData = [];
        lastColors = [];
        lastDescriptions = [];
        window.thermoMetricsGlobal = null;
        window.financeMetricsGlobal = null;
        window.expertScoreGlobal = null;
        window.currentNoobScore = null;
        window.maxTcCurveGlobal = [];
        window.dynamicMonthlyCop = [];

        // Okamžité promazání UI
        if (typeof App.handleNoData === 'function') App.handleNoData();
        App.emit('updateStats', null);
        // Pozn.: tyto pohledy nemusí být inicializované při prvním nahrání — chybu jen logujeme
        try { App.updateFinanceView(); } catch(e){ console.error('handleFileUpload: updateFinanceView selhal', e); }
        try { App.updateThermoTab(); } catch(e){ console.error('handleFileUpload: updateThermoTab selhal', e); }
        
        // Reset do výchozího stavu času, aby aplikace sama skočila na nová data
        currentSelectionMode = 'day';
        isTodayMode = true;
        currentSelectedDate = new Date();
        App.updateDateLabel();

        worker.postMessage({ type: 'CLEAR_CACHE' });

        for (let i = 0; i < files.length; i++) {
            if (i % 5 === 0) {
                if (statusEl) {
                    statusEl.innerText = `Načítám ${i + 1}/${files.length}`;
                    statusEl.style.borderLeftColor = "var(--accent)";
                    statusEl.style.color = "var(--accent)";
                }
                await new Promise(r => setTimeout(r, 0));
            }
            textParts.push(await files[i].text());
        }

        if (statusEl) {
            statusEl.innerText = "Skládám data a stahuji počasí...";
            statusEl.style.borderLeftColor = "var(--accent)";
            statusEl.style.color = "var(--accent)";
        }

        // ULOŽENÍ DO PAMĚTI A ZAPOMENUTÍ TEXTAREA "A"
        App.uploadedFileText = textParts.join("\n");

        // ── Rychlá kontrola formátu: prázdný nebo zjevně neparsovatelný log ──
        // Platný log z TČ je oddělený (např. ';' nebo ',') a má více řádků.
        const _trimmed = (App.uploadedFileText || "").trim();
        const _looksLikeLog = _trimmed.length > 5
            && /[\r\n]/.test(_trimmed)
            && /[;,\t]/.test(_trimmed);
        if (!_looksLikeLog) {
            console.error('handleFileUpload: nahraný soubor nevypadá jako platný log z TČ (délka=' + _trimmed.length + ')');
            App.uploadedFileText = "";
            if (statusEl) {
                statusEl.innerText = "Neplatný formát logu";
                statusEl.style.borderLeftColor = "var(--danger)";
                statusEl.style.color = "var(--danger)";
            }
            if (typeof App.showError === 'function') App.showError('Soubor nevypadá jako platný log z TČ. Zkontrolujte, zda nahráváte správný exportní soubor.');
            if (typeof App.handleNoData === 'function') App.handleNoData();
            input.value = ''; // Reset file inputu
            textParts.length = 0;
            return;
        }

        const dataInput = document.getElementById('dataInput');
        if (dataInput) {
            dataInput.value = "A"; // Natvrdo přepíšeme stará data ze zkratky
        }

        input.value = ''; // Reset file inputu
        textParts.length = 0;

        App.runPipeline();
    } catch (err) {
        if (statusEl) {
            statusEl.innerText = "Chyba souboru";
            statusEl.style.borderLeftColor = "var(--danger)";
            statusEl.style.color = "var(--danger)";
        }
        if (typeof App.showError === 'function') App.showError("Nepodařilo se načíst soubor.");
    }
};

App.runPipeline = function () {
    let text = "";
    
    // 1. Priorita: Uživatelsky nahraný soubor přes tlačítko
    if (App.uploadedFileText && App.uploadedFileText.length > 5) {
        text = App.uploadedFileText;
    } else {
        // 2. Priorita: Vložená data přes iOS zkratku (textarea "A")
        const dataInput = document.getElementById('dataInput');
        if (dataInput) {
            text = (dataInput.value || "").trim();
        }
    }

    if (!text || text === "A") return;

    const scroller = document.getElementById('scrollContainerMain');
    if (scroller) {
        scroller.style.overflowX = 'hidden';
        requestAnimationFrame(() => { scroller.style.overflowX = 'auto'; });
    }

    clearTimeout(pipelineTimeout);
    pipelineTimeout = setTimeout(() => {
        currentJobId++;
        
        let sTs, eTs, dateKey;
        let baseDate = new Date(currentSelectedDate);
        
        if (currentSelectionMode === 'day') {
            if (isTodayMode) {
                sTs = Math.floor(Date.now() / 1000) - 86400;
                eTs = Math.floor(Date.now() / 1000);
                dateKey = "TODAY";
            } else {
                baseDate.setHours(0, 0, 0, 0);
                sTs = Math.floor(baseDate.getTime() / 1000);
                eTs = sTs + 86400;
                dateKey = `DAY_${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
            }
        } else if (currentSelectionMode === 'month') {
            baseDate.setDate(1);
            baseDate.setHours(0, 0, 0, 0);
            sTs = Math.floor(baseDate.getTime() / 1000);
            
            let nextMonth = new Date(baseDate);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            eTs = Math.floor(nextMonth.getTime() / 1000);
            
            dateKey = `MONTH_${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}`;
        } else if (currentSelectionMode === 'year') {
            baseDate.setMonth(0, 1);
            baseDate.setHours(0, 0, 0, 0);
            sTs = Math.floor(baseDate.getTime() / 1000);
            
            let nextYear = new Date(baseDate);
            nextYear.setFullYear(nextYear.getFullYear() + 1);
            eTs = Math.floor(nextYear.getTime() / 1000);
            
            dateKey = `YEAR_${baseDate.getFullYear()}`;
        }

        let prefetchDates = [];
        if (currentSelectionMode === 'day') {
            let cacheBase = new Date(baseDate);
            cacheBase.setHours(0, 0, 0, 0);

            for (let offset of [-2, -1, 1, 2]) {
                let pd = new Date(cacheBase);
                pd.setDate(pd.getDate() + offset);
                
                if (pd > new Date()) continue;
                
                let p_sTs = Math.floor(pd.getTime() / 1000);
                let p_eTs = p_sTs + 86400;
                let p_key = `DAY_${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}-${String(pd.getDate()).padStart(2, '0')}`;
                
                if (!dayCache[p_key]) {
                    prefetchDates.push({ key: p_key, sTs: p_sTs, eTs: p_eTs });
                }
            }
        }

        const statusEl = document.getElementById('statusFreq');
        
        if (dayCache[dateKey]) {
            App.setLoading(false);
            if (statusEl) {
                statusEl.innerText = "Načteno z paměti";
                statusEl.style.borderLeftColor = "var(--success)";
                statusEl.style.color = "var(--success)";
            }
            
            App.applyDayData(dayCache[dateKey]);
            if (prefetchDates.length === 0) return;
        } else {
            App.setLoading(true, "Analyzuji a připravuji cache...");
            if (statusEl) {
                statusEl.innerText = "Analyzuji...";
                statusEl.style.borderLeftColor = "var(--accent)";
                statusEl.style.color = "var(--accent)";
            }
        }

        try {
            worker.postMessage({
                type: 'PROCESS',
                jobId: currentJobId,
                text: workerHasData ? "A" : text, 
                config: CONFIG,
                startTs: sTs,
                endTs: eTs,
                prefetchDates: prefetchDates
            });
            workerHasData = true;
            // Spustíme hlídací časovač — pokud worker do ~30 s nepošle terminální
            // zprávu pro tento job, odblokujeme UI a upozorníme uživatele.
            startWatchdog(currentJobId);
        } catch (err) {
            App.setLoading(false);
            if (statusEl) {
                statusEl.innerText = "Chyba: nelze spustit worker";
                statusEl.style.borderLeftColor = "var(--danger)";
                statusEl.style.color = "var(--danger)";
            }
            if (typeof App.showError === 'function') App.showError("Chyba spuštění analýzy.");
            if (typeof App.handleNoData === 'function') App.handleNoData();
        }
    }, 15);
};


App.generateExport = function() {
    const type = document.getElementById('exportType').value;
    const startStr = document.getElementById('exportStart').value;
    const endStr = document.getElementById('exportEnd').value;
    
    const cbSummary = document.getElementById('exportIncludeSummary');
    const includeSummary = cbSummary ? cbSummary.checked : true;
    
    const ta = document.getElementById('exportTextarea');
    if (ta) ta.value = 'Generuji export, čekejte prosím...';

    let startTs = 0;
    let endTs = 2000000000;

    if (startStr) {
        const sd = new Date(startStr);
        sd.setHours(0, 0, 0, 0);
        startTs = Math.floor(sd.getTime() / 1000);
    }
    if (endStr) {
        const ed = new Date(endStr);
        ed.setHours(23, 59, 59, 999);
        endTs = Math.floor(ed.getTime() / 1000);
    }

    if (typeof worker !== 'undefined' && worker) {
        worker.postMessage({
            type: 'GENERATE_EXPORT',
            jobId: currentJobId,
            exportType: type,
            includeSummary: includeSummary,
            startTs: startTs,
            endTs: endTs,
            config: CONFIG
        });
    } else {
        if (ta) ta.value = 'Chyba: Proces na pozadí (Worker) není dostupný.';
    }
};

// ─── AUTOMATICKÁ AKTUALIZACE evanTemps Z OPEN-METEO (síťové volání) ──────────
// Přesunuto z module-ui.js do API vrstvy. Volá se z App.updateConfig().
// ─── AUTOMATICKÁ AKTUALIZACE evanTemps Z OPEN-METEO ───────────────────────
// Volá se z updateConfig() pokud uživatel změní locLat/locLon.
// Stáhne průměrné měsíční teploty za posledních 5 let pro novou lokaci.
App.updateEvanTemps = async function(lat, lon) {
    const statusEl = document.getElementById('statusFreq');
    try {
        const endYear  = new Date().getFullYear();
        const startYear = endYear - 5;
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startYear}-01-01&end_date=${endYear}-12-31&daily=temperature_2m_mean&timeformat=unixtime`;

        if (statusEl) { statusEl.innerText = 'Stahuji průměrné teploty pro novou lokaci…'; statusEl.style.color = 'var(--accent)'; }

        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        if (!data.daily || !data.daily.time) throw new Error('Prázdná odpověď');

        const sums   = new Array(12).fill(0);
        const counts = new Array(12).fill(0);
        data.daily.time.forEach((ts, i) => {
            const m = new Date(ts * 1000).getMonth();
            const t = data.daily.temperature_2m_mean[i];
            if (t !== null && Number.isFinite(t)) { sums[m] += t; counts[m]++; }
        });

        CONFIG.evanTemps = sums.map((s, i) =>
            counts[i] > 0 ? Math.round(s / counts[i] * 10) / 10 : CONFIG.evanTemps[i]
        );

        // Aktualizuj input pokud existuje
        const evanEl = document.getElementById('evanTemps');
        if (evanEl) evanEl.value = CONFIG.evanTemps.join(', ');

        if (statusEl) { statusEl.innerText = 'Teploty lokace aktualizovány — přepočítávám…'; statusEl.style.color = 'var(--success)'; }

        // Invaliduj cache a přepočítej
        if (typeof dayCache !== 'undefined') dayCache = {};
        if (typeof worker !== 'undefined' && worker) {
            workerHasData = false;
            worker.postMessage({ type: 'CLEAR_CACHE' });
        }
        App.runPipeline();
    } catch(e) {
        console.warn('updateEvanTemps selhalo:', e);
        if (statusEl) { statusEl.innerText = 'Lokace změněna — teploty nelze stáhnout, pokračuji s původními.'; statusEl.style.color = 'var(--warning)'; }
        App.runPipeline(); // pokračuj i bez nových evanTemps
    }
};
