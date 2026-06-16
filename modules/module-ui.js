








// ─── 1. ZPRACOVÁNÍ DAT Z WORKERU ────────────────────────────────────────────
App.applyDayData = function(data) {
    currentStats = data.stats;
    lastWindowData = data.windowData || [];
    lastColors = data.colors || [];
    lastDescriptions = data.descriptions || [];

    // Uložení nových expertních modelů do globálního okna pro UI
    if (data.noobScore) window.currentNoobScore = data.noobScore;
    // expertScoreGlobal je nastaven v module-api (worker.onmessage RESULT) — zde redundantní

    if (window.App && typeof App.refreshColors === 'function') {
        try { App.refreshColors(); } catch (e) { }
    }

    App.emit('updateStats', data.stats);
    App.emit('renderCharts', { windowData: data.windowData, colors: data.colors, descriptions: data.descriptions });

    const calModal = document.getElementById('calendarModal');
    if (calModal && calModal.classList.contains('open')) {
        App.emit('renderCalendar');
    }

    const finTab = document.getElementById('tab-finance');
    if (finTab && finTab.classList.contains('active')) {
        App.emit('updateFinanceView');
    }
};

// ─── 2. NAVIGACE, MODÁLNÍ OKNA A AKTUALIZACE DOM ────────────────────────────

App.updateStats = function (s) {
    if (!s) return;
    const safeNum = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

    // --- ANALYST: Horní Status ---
    const sF = document.getElementById('statusFreq');
    if (sF) {
        let healthClass = s.health ? s.health.class : 'st-ideal'; 

        if (currentSelectionMode === 'day' && !isTodayMode) {
            const isoKey = `${currentSelectedDate.getFullYear()}-${String(currentSelectedDate.getMonth() + 1).padStart(2, '0')}-${String(currentSelectedDate.getDate()).padStart(2, '0')}`;
            const globalDayStat = dailyStatsGlobal.find(d => d.dateStr === isoKey);
            // netStarts čteme z globalDayStat bez mutace s (currentStats)
            const displayStarts = globalDayStat ? globalDayStat.netStarts : s.netStarts;
            
            if (dailyHealthMap[isoKey]) {
                const mapObj = dailyHealthMap[isoKey];
                healthClass = mapObj.class ? mapObj.class : mapObj; 
            }
        }

        sF.className = 'status-badge ' + healthClass;
        const label = (currentSelectionMode === 'day') ? 'Starty' : 'Prům. starty/den';
        const val = (currentSelectionMode === 'day') ? (typeof displayStarts !== 'undefined' ? displayStarts : s.netStarts) : (s.totalHours > 0 ? (s.netStarts / (s.totalHours/24)).toFixed(1) : 0);
        
        sF.innerText = `✓ ${label} - ${val}x (${s.tuv}x TUV, ${s.pauses}x Pauza)`;
        
        if (healthClass === 'st-crit' || healthClass === 'red') { sF.style.borderLeftColor = 'var(--danger)'; sF.style.color = 'var(--danger)'; }
        else if (healthClass === 'st-orange' || healthClass === 'orange') { sF.style.borderLeftColor = '#f97316'; sF.style.color = '#f97316'; }
        else if (healthClass === 'st-warn' || healthClass === 'yellow') { sF.style.borderLeftColor = '#eab308'; sF.style.color = '#eab308'; }
        else { sF.style.borderLeftColor = 'var(--success)'; sF.style.color = 'var(--success)'; }
    }

    // --- ANALYST: Grid Karet ---
    const cardKwh = document.getElementById('cardKwh');
    if (cardKwh) {
        const valEl = cardKwh.querySelector('.stat-value');
        const subEl = cardKwh.querySelector('.stat-sub');
        if (valEl) valEl.innerText = `${(safeNum(s.totalKwh) * CONFIG.priceKwh).toFixed(0)} Kč`;
        if (subEl) subEl.innerHTML = `<span style="color:var(--accent)">${safeNum(s.heatKwh).toFixed(1)}</span> | <span style="color:var(--tuv)">${safeNum(s.tuvKwh).toFixed(1)}</span> <small>kWh</small>`;
    }

    const cardCop = document.getElementById('cardCop');
    if (cardCop) {
        const lblEl = cardCop.querySelector('.stat-label');
        const valEl = cardCop.querySelector('.stat-value');
        let prefix = "COP";
        let labelText = "Efektivita (Mix)";
        
        if (currentSelectionMode === 'month') { prefix = "Ø COP"; labelText = "Efektivita (Měsíc)"; } 
        else if (currentSelectionMode === 'year') { prefix = "SCOP"; labelText = "Efektivita (Rok)"; }
        
        if (lblEl) lblEl.innerText = labelText;
        if (valEl) valEl.innerText = safeNum(s.avgCop) > 0 ? `${prefix} ${safeNum(s.avgCop).toFixed(2)}` : "-";
    }

    const cardLoss = document.getElementById('cardLoss');
    if (cardLoss) {
        const lblEl = cardLoss.querySelector('.stat-label');
        const valEl = cardLoss.querySelector('.stat-value');
        const hkEl = document.getElementById('statHouseK');
        const wm2El = document.getElementById('statWm2');
        
        if (lblEl) lblEl.innerText = `Ztráta domu (${CONFIG.designTemp}°C)`;
        
        let globalHouseK = window.thermoMetricsGlobal ? window.thermoMetricsGlobal.houseK.all : 0;
        let totalDesignLoss = globalHouseK > 0 ? globalHouseK * (CONFIG.targetIndoorTemp - CONFIG.designTemp) : 0;
        let area = (CONFIG && CONFIG.floorArea > 0) ? CONFIG.floorArea : 100;
        let totalWm2 = totalDesignLoss > 0 ? totalDesignLoss / area : 0;

        if (totalDesignLoss > 0) {
            if (valEl) valEl.innerText = `${Math.round(totalDesignLoss)} W`;
            if (hkEl) hkEl.innerText = `${Math.round(globalHouseK)} W/K`;
            if (wm2El) wm2El.innerText = ` | ${totalWm2.toFixed(1)} W/m²`;
        } else {
            if (valEl) valEl.innerText = "-";
            if (hkEl) hkEl.innerText = "Málo dat";
            if (wm2El) wm2El.innerText = "";
        }
    }

    const updateSimpleCard = (id, val, modFn = null) => {
        const c = document.getElementById(id);
        if (c) {
            const vEl = c.querySelector('.stat-value');
            if (vEl) {
                vEl.innerHTML = val;
                if (modFn) modFn(vEl);
            }
        }
    };

    updateSimpleCard('cardFatigue', `${safeNum(s.maxStartsPerHour)} <small>×/h</small>`, el => {
        const v = safeNum(s.maxStartsPerHour);
        el.style.color = (v > 3) ? 'var(--danger)' : ((v > 2) ? 'var(--warning)' : 'var(--accent)');
    });

    updateSimpleCard('cardDuty', `${Math.round(safeNum(s.runTimePercent))}%`);
    const cDuty = document.getElementById('cardDuty');
    if (cDuty) {
        const sub = cDuty.querySelector('.stat-sub');
        if (sub) {
            const eH = Math.floor(safeNum(s.totalRunHours));
            const eM = Math.round((safeNum(s.totalRunHours) - eH) * 60);
            sub.innerText = `${eH}h ${String(eM).padStart(2, '0')}m`;
        }
    }

    const cOil = document.getElementById('cardOil');
    if (cOil) {
        const split = cOil.querySelector('.service-split');
        if (split) {
            split.innerHTML = `<div class="service-row border-b" style="color:#fff;">Defrost ${safeNum(s.defrosts)}x</div><div class="service-row" style="color:var(--oil);">Oil ${safeNum(s.oil)}x</div>`;
        }
    }

    updateSimpleCard('cardSmooth', `${Math.round(safeNum(s.lowModPercent))}%`, el => el.style.color = safeNum(s.lowModPercent) > 50 ? 'var(--success)' : 'var(--text-main)');
    
    const eco = Math.round(safeNum(s.ecoPercent));
    updateSimpleCard('cardEco', `${eco}%`, el => el.style.color = eco > 50 ? 'var(--success)' : 'var(--text-main)');
    const cEco = document.getElementById('cardEco');
    if (cEco) {
        const sub = cEco.querySelector('.stat-sub');
        const ecoH = Math.floor(safeNum(s.totalRunHours) * (eco / 100));
        const ecoM = Math.round((safeNum(s.totalRunHours) * (eco / 100) - ecoH) * 60);
        if (sub) sub.innerText = `${ecoH}h ${String(ecoM).padStart(2, '0')}m`;
    }

    updateSimpleCard('cardPower', `${Math.round(safeNum(s.avgPower))} W`);
    
    updateSimpleCard('cardWeather', (s.avgTemp !== null && Number.isFinite(s.avgTemp)) ? `${s.avgTemp.toFixed(1)} °C` : "-");
    const cWeather = document.getElementById('cardWeather');
    if (cWeather) {
        const sub = cWeather.querySelector('.stat-sub');
        if (sub) sub.innerHTML = s.isOfflineWeather ? `<span style="color: red; font-size: 0.65rem; font-weight: bold;">Offline průměr</span>` : "";
    }

    updateSimpleCard('cardRun', `${Math.round(safeNum(s.avgRun))} <small>min</small>`);
    updateSimpleCard('cardPause', `${Math.round(safeNum(s.avgPause))} <small>min</small>`);

    const sS = document.getElementById('statusStability');
    if (sS) {
        sS.style.display = 'block';
        sS.innerText = safeNum(s.short) >= 1 ? `⚠️ Krátké cykly ${safeNum(s.short)}x` : "✓ TČ běží optimálně";
        sS.style.borderLeftColor = safeNum(s.short) >= 1 ? 'var(--danger)' : 'var(--success)';
        sS.style.color = sS.style.borderLeftColor;
        sS.className = 'status-badge'; 
    }

    try { App.updateThermoTab(); } catch(e) {}
};

// ─── 4. TERMO, SIMULACE A EXPERTNÍ SKÓRE ────────────────────────────────────
App.updateThermoTab = function() {
    const thermo = window.thermoMetricsGlobal;
    if (!thermo) return;

    const { all, recent, older, houseK, lossHP, wm2HP, bivExact, kwhHdd, gains } = thermo;
    const setVal = (id, val) => { const e = document.getElementById(id); if(e) e.innerText = val; };
    const setTrend = (id, diff, unit, invert = false) => {
        const e = document.getElementById(id);
        if(!e) return;
        if(older.days === 0) { e.innerText = 'Málo dat pro trend'; e.style.color = 'var(--text-dim)'; return; }
        if(isNaN(diff) || !isFinite(diff)) { e.innerText = '-'; return; }
        
        let color = 'var(--text-dim)';
        if (diff !== 0) {
            const isGood = invert ? (diff < 0) : (diff > 0);
            color = isGood ? 'var(--success)' : 'var(--danger)';
        }
        const sign = diff > 0 ? '▲ +' : (diff < 0 ? '▼ ' : '');
        e.innerHTML = `<span style="color:${color}">${sign}${diff === 0 ? '0' : diff.toFixed(2)} ${unit}</span>`;
    };

    let tempDiff = (CONFIG.targetIndoorTemp - CONFIG.designTemp);
    let hpK_all = lossHP.all > 0 ? lossHP.all / tempDiff : 0;
    let hpK_recent = lossHP.recent > 0 ? lossHP.recent / tempDiff : 0;
    let hpK_older = lossHP.older > 0 ? lossHP.older / tempDiff : 0;

    const thLossTitle = document.querySelector('#th_loss');
    if (thLossTitle && thLossTitle.previousElementSibling) thLossTitle.previousElementSibling.innerText = `Zátěž pro TČ (${CONFIG.designTemp} °C)`;

    setVal('th_loss', houseK.all > 0 ? Math.round(lossHP.all) + ' W' : '-');
    setTrend('th_loss_t', lossHP.recent - lossHP.older, 'W', true); 

    setVal('th_wm2', houseK.all > 0 ? wm2HP.all.toFixed(1) + ' W/m²' : '-');
    setTrend('th_wm2_t', wm2HP.recent - wm2HP.older, 'W/m²', true);

    setVal('th_houseK', hpK_all > 0 ? Math.round(hpK_all) + ' W/K' : '-');
    setTrend('th_houseK_t', hpK_recent - hpK_older, 'W/K', true);

    setVal('th_biv', bivExact !== null ? bivExact.toFixed(1) + ' °C' : 'Nezjištěno');
    
    if (gains) {
        setVal('th_gain_zima', Math.round(gains.zima) + ' W');
        setVal('th_gain_prechod', Math.round(gains.prechod) + ' W');
    }

    setVal('th_hdd', all.hdd.toFixed(1));
    setTrend('th_hdd_t', (recent.hdd/recent.days) - (older.hdd/older.days), '/ den', true);

    setVal('th_kwhHdd', kwhHdd.all > 0 ? kwhHdd.all.toFixed(2) : '-');
    setTrend('th_kwhHdd_t', kwhHdd.recent - kwhHdd.older, '', true);

    setVal('th_copHeat', (all.heatWh > 0 ? all.heatTpWh / all.heatWh : 0).toFixed(2));
    setTrend('th_copHeat_t', (recent.heatWh > 0 ? recent.heatTpWh/recent.heatWh : 0) - (older.heatWh > 0 ? older.heatTpWh/older.heatWh : 0), '', false);

    setVal('th_heatTpWh', (all.heatTpWh/1000).toFixed(1) + ' kWh');
    setTrend('th_heatTpWh_t', (recent.heatTpWh/1000/recent.days) - (older.heatTpWh/1000/older.days), 'kWh/den', false);

    setVal('th_heatKwh', (all.heatWh/1000).toFixed(1) + ' kWh');
    setTrend('th_heatKwh_t', (recent.heatWh/1000/recent.days) - (older.heatWh/1000/older.days), 'kWh/den', true);

    setVal('th_copTuv', (all.tuvWh > 0 ? all.tuvTpWh / all.tuvWh : 0).toFixed(2));
    setTrend('th_copTuv_t', (recent.tuvWh > 0 ? recent.tuvTpWh/recent.tuvWh : 0) - (older.tuvWh > 0 ? older.tuvTpWh/older.tuvWh : 0), '', false);

    setVal('th_tuvTpWh', (all.tuvTpWh/1000).toFixed(1) + ' kWh');
    setTrend('th_tuvTpWh_t', (recent.tuvTpWh/1000/recent.days) - (older.tuvTpWh/1000/older.days), 'kWh/den', false);

    setVal('th_tuvKwh', (all.tuvWh/1000).toFixed(1) + ' kWh');
    setTrend('th_tuvKwh_t', (recent.tuvWh/1000/recent.days) - (older.tuvWh/1000/older.days), 'kWh/den', true);

    setVal('th_copMix', (all.tWh > 0 ? (all.heatTpWh + all.tuvTpWh) / all.tWh : 0).toFixed(2));
    setTrend('th_copMix_t', (recent.tWh > 0 ? (recent.heatTpWh + recent.tuvTpWh)/recent.tWh : 0) - (older.tWh > 0 ? (older.heatTpWh + older.tuvTpWh)/older.tWh : 0), '', false);

    setVal('th_defrostWh', (all.defrostWh/1000).toFixed(1) + ' kWh');
    setTrend('th_defrostWh_t', (recent.defrostWh/1000/recent.days) - (older.defrostWh/1000/older.days), 'kWh/den', true);

    setVal('th_minVolt', all.minVolt !== 999 && all.minVolt !== null ? all.minVolt.toFixed(1) + ' V' : '-');
    setTrend('th_minVolt_t', all.minVolt !== 999 && all.minVolt !== null ? (recent.minVolt - older.minVolt) : NaN, 'V', false); 

    // Globální hodnoty jsou uloženy v dedikovaných proměnných (ne v dayCache),
    // protože CACHE_RESULT prefetch tyto pole neobsahuje
    const hb          = window.heatingBoundaryGlobal        || null;
    const hbAutumn    = window.heatingBoundaryAutumnGlobal   || null;
    const hbSpring    = window.heatingBoundarySpringGlobal   || null;
    const avgNormCop  = window.avgNormCopLongTermGlobal      || null;
    const copCurveWarn= window.copCurveWarningGlobal         || false;
    const minEl       = window.minModulationElGlobal         || null;
    const minTh       = window.minModulationThGlobal         || null;

    const hbEl = document.getElementById('th_heatingBoundary');
    if (hbEl) {
        if (hbAutumn !== null && hbSpring !== null) {
            hbEl.innerHTML =
                `Podzim: <b>${hbAutumn.toFixed(1).replace('.', ',')} °C</b>` +
                ` &nbsp;|&nbsp; Jaro: <b>${hbSpring.toFixed(1).replace('.', ',')} °C</b>`;
        } else {
            hbEl.innerText = hb !== null && hb !== undefined ? hb.toFixed(1).replace('.', ',') + ' °C' : '-';
        }
    }
    const ncWarnEl = document.getElementById('th_normCopWarning');
    if (ncWarnEl) {
        if (copCurveWarn && avgNormCop !== null) {
            const dir = avgNormCop < 0.75 ? 'příliš vysoko (LWT nadměrná)' : 'příliš nízko (LWT poddimenzovaná)';
            ncWarnEl.style.display = 'block';
            ncWarnEl.innerHTML = `⚠️ Ekvitermní křivka pravděpodobně ${dir} — průměrný normCop ${avgNormCop.toFixed(2)} (očekáváno 0.82–1.10).`;
        } else {
            ncWarnEl.style.display = 'none';
        }
    }

    const minModEl = document.getElementById('th_minModulation');
    const minModThEl = document.getElementById('th_minModulationHeat');
    if (minEl !== null && minEl !== undefined && minModEl && minModThEl) {
        minModEl.innerText = Math.round(minEl) + ' W el.';
        minModThEl.innerText = '≈ ' + Math.round(minTh) + ' W teplo';
    } else if (minModEl && minModThEl) {
        minModEl.innerText = '-';
        minModThEl.innerText = 'Nedostatek plynulých dat';
    }

    App.updateExpertScore();
};

App.generateExpertMessage = function(score) {
    if (!score) return '';
    const total      = Math.round(score.total);
    const insul      = Math.round(score.insulation);
    const effic      = Math.round(score.efficiency);
    const health     = Math.round(score.health);
    const accum      = Math.round(score.accumulation);

    // --- Základ věty podle celkového skóre (0–1000 bodů) ---
    let intro = '';
    // Pásma calibrována na reálná data: Fraunhofer ISE (průměr ASHP SPF=3.4),
    // ETH Zurich 2025 (17% instalací nesplňuje standard), UK/IE průměr SPF=2.59
    if      (total >= 880) intro = 'Výjimečný výsledek — systém patří do absolutní špičky. Takto vyladěných instalací je méně než 5 %.';
    else if (total >= 750) intro = 'Výborný výkon. Váš systém výrazně překračuje průměr měřených instalací v střední Evropě.';
    else if (total >= 620) intro = 'Nadprůměrný výsledek. Systém funguje lépe než většina reálných instalací.';
    else if (total >= 500) intro = 'Průměrný výsledek — systém pracuje, ale má viditelné rezervy, které stojí za pozornost.';
    else if (total >= 370) intro = 'Podprůměrný výsledek. Systém funguje, ale neefektivně — pravděpodobně špatné nastavení nebo nevhodné podmínky.';
    else if (total >= 220) intro = 'Slabý výsledek. Systém vykazuje závažné nedostatky — doporučujeme revizi nastavení nebo odbornou prohlídku.';
    else                   intro = 'Varování: systém pracuje velmi neefektivně. Jde pravděpodobně o chybu projektu, nastavení nebo závadu.';

    // --- Komentář k izolaci ---
    let insulNote = '';
    if      (insul >= 88) insulNote = 'Tepelný obal budovy je výborný — dům drží teplo bez zbytečných ztrát.';
    else if (insul >= 70) insulNote = 'Izolace budovy je nadstandardní. Tepelné ztráty jsou nízké.';
    else if (insul >= 50) insulNote = 'Tepelné ztráty odpovídají běžné novostavbě.';
    else if (insul >= 30) insulNote = 'Budova má vyšší tepelné ztráty — pravděpodobně starší zástavba nebo nedostatečné zateplení.';
    else                   insulNote = 'Tepelné ztráty jsou velmi vysoké. Zateplení nebo hydraulické vyvážení by výrazně pomohlo.';

    // --- Komentář k účinnosti TČ ---
    let efficNote = '';
    if      (effic >= 85) efficNote = 'Tepelné čerpadlo dosahuje vynikajícího COP — topná křivka je nastavena přesně.';
    else if (effic >= 68) efficNote = 'Účinnost TČ je výborná. Výstupní teplota vody je pravděpodobně dobře nastavena.';
    else if (effic >= 50) efficNote = 'Účinnost je v normě, ale snížení výstupní teploty vody o 2–3 °C by mohlo COP viditelně zvýšit.';
    else if (effic >= 32) efficNote = 'Účinnost TČ je nižší. Zkontrolujte ekvitermní křivku a nastavení LWT.';
    else                   efficNote = 'Velmi nízká účinnost — TČ pracuje s nevhodně vysokou výstupní teplotou nebo má technický problém.';

    // --- Komentář ke zdraví ---
    let healthNote = '';
    if      (health >= 88) healthNote = 'Dynamika provozu je vzorová — žádné zbytečné cyklování, kompresor pracuje plynule.';
    else if (health >= 70) healthNote = 'Zdraví systému je dobré. Starty jsou v normě, defrosty přiměřené.';
    else if (health >= 50) healthNote = 'Cyklování je mírně zvýšené. Hydraulická akumulace nebo úprava hystereze by pomohla.';
    else if (health >= 30) healthNote = 'Zvýšené cyklování zkracuje životnost kompresoru. Doporučujeme revizi nastavení nebo přidání akumulační nádoby.';
    else                   healthNote = 'Kritické cyklování — kompresor se spouští a vypíná příliš často. Okamžitá intervence je na místě.';

    // --- Komentář k akumulaci ---
    let accumNote = '';
    if      (accum >= 80) accumNote = 'Budova má vysokou tepelnou setrvačnost — ideální pro efektivní provoz TČ.';
    else if (accum >= 55) accumNote = 'Tepelná setrvačnost budovy je průměrná.';
    else                   accumNote = 'Budova rychle chladne. Kratší topné cykly jsou přirozené, ale hydraulická akumulace by stabilizovala provoz.';

    // --- Závěrečné doporučení ---
    let tip = '';
    // Najdi nejslabší článek a navrhni konkrétní krok
    const minScore = Math.min(insul, effic, health, accum);
    if      (minScore === insul  && insul  < 50) tip = '➜ Největší rezerva je v tepelné obálce budovy.';
    else if (minScore === effic  && effic  < 50) tip = '➜ Největší rezerva je v nastavení topné křivky — zkuste snížit LWT.';
    else if (minScore === health && health < 50) tip = '➜ Největší rezerva je v dynamice provozu — zvažte hydraulickou akumulaci.';
    else if (minScore === accum  && accum  < 40) tip = '➜ Přidání akumulační nádoby by výrazně zlepšilo stabilitu provozu.';
    else if (total >= 75)                        tip = '➜ Systém je naladěn — stačí sledovat sezónní trendy a čistit filtr výparníku.';
    else                                         tip = '➜ Doporučujeme konzultaci s technikem nebo revizi nastavení.';

    return `<span style="line-height:1.7;">
        ${intro}<br>
        <span style="color:var(--text-dim); font-size:0.72rem;">
        📐 ${insulNote} &nbsp;|&nbsp;
        ⚡ ${efficNote}<br>
        🛡️ ${healthNote} &nbsp;|&nbsp;
        🏠 ${accumNote}
        </span><br>
        <span style="color:var(--accent); font-weight:600;">${tip}</span>
    </span>`;
};

App.updateExpertScore = function() {
    const score = window.expertScoreGlobal;
    const container = document.getElementById('expertScoreContainer');
    
    if (!container) return;
    if (!score || !score.hasEnoughData) {
        container.style.display = 'none';
        return;
    }

    if (!document.getElementById('exp_total')) {
        container.innerHTML = `
            <div class="expert-card" style="grid-column: 1 / -1; border-color: rgba(90, 184, 255, 0.4);">
                <div class="expert-header">
                    <h3 class="expert-title"><i>🎓</i> Celkové Expertní Skóre</h3>
                    <div class="expert-total" id="exp_total">0 %</div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                    <div>
                        <div class="score-row"><div class="score-labels"><span>Izolace budovy</span><span class="val" id="exp_insulation_val">0 %</span></div><div class="progress-track"><div class="progress-fill" id="exp_insulation_bar"></div></div></div>
                        <div class="score-row"><div class="score-labels"><span>Účinnost TČ</span><span class="val" id="exp_efficiency_val">0 %</span></div><div class="progress-track"><div class="progress-fill" id="exp_efficiency_bar"></div></div></div>
                    </div>
                    <div>
                        <div class="score-row"><div class="score-labels"><span>Zdraví a dynamika</span><span class="val" id="exp_health_val">0 %</span></div><div class="progress-track"><div class="progress-fill" id="exp_health_bar"></div></div></div>
                        <div class="score-row"><div class="score-labels"><span>Akumulace a zisky</span><span class="val" id="exp_accumulation_val">0 %</span></div><div class="progress-track"><div class="progress-fill" id="exp_accumulation_bar"></div></div></div>
                    </div>
                </div>
                <div id="exp_message" style="margin-top: 15px; font-size: 0.75rem; color: var(--text-dim); line-height: 1.4; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 10px; text-align: center; font-style: italic;"></div>
            </div>`;
    }
    
    container.style.display = 'block'; 
    
    const getRating = (prefix, val) => {
        if (prefix === 'insulation') {
            if (val >= 85) return { txt: 'Pasivní dům', col: 'var(--success)' };
            if (val >= 60) return { txt: 'Nízkoenergetický standard', col: 'var(--accent)' };
            if (val >= 35) return { txt: 'Běžná novostavba', col: 'var(--warning)' };
            return { txt: 'Starší / nezatepleno', col: 'var(--danger)' };
        }
        if (prefix === 'efficiency') {
            if (val >= 85) return { txt: 'Země-voda / Ideál', col: 'var(--success)' };
            if (val >= 60) return { txt: 'Špička (Vzduch-voda)', col: 'var(--accent)' };
            if (val >= 40) return { txt: 'Dobrý průměr', col: 'var(--warning)' };
            return { txt: 'Nízká účinnost', col: 'var(--danger)' };
        }
        if (prefix === 'health') {
            if (val >= 85) return { txt: 'Vzorová plynulost', col: 'var(--success)' };
            if (val >= 60) return { txt: 'Zdravý provoz', col: 'var(--accent)' };
            if (val >= 30) return { txt: 'Zvýšené cyklování', col: 'var(--warning)' };
            return { txt: 'Kritické cyklování', col: 'var(--danger)' };
        }
        if (prefix === 'accumulation') {
            if (val >= 80) return { txt: 'Vysoká setrvačnost', col: 'var(--success)' };
            if (val >= 50) return { txt: 'Standardní stavba', col: 'var(--accent)' };
            return { txt: 'Rychle chladne', col: 'var(--warning)' };
        }
        return { txt: '', col: 'var(--text-dim)' };
    };
    
    const updateBar = (prefix, value, maxPoints) => {
        const bar = document.getElementById(`exp_${prefix}_bar`);
        const valEl = document.getElementById(`exp_${prefix}_val`);
        if (!bar || !valEl) return;
        
        const rating = getRating(prefix, value);
        const pts = Math.round(value / 100 * maxPoints);
        valEl.innerHTML = `<span style="font-size:0.6rem; font-weight:400; color:var(--text-dim); margin-right:5px;">${rating.txt}</span> ${pts} <span style="font-size:0.6rem; color:var(--text-dim);">/ ${maxPoints}</span>`;
        
        requestAnimationFrame(() => {
            bar.style.width = `${Math.round(value)}%`;
            bar.style.backgroundColor = rating.col;
            valEl.style.color = rating.col;
        });
    };
    
    const totalEl = document.getElementById('exp_total');
    if (totalEl) {
        const total = score.total; // 0–1000 bodů
        totalEl.innerText = `${total} b`;
        
        let tColor = 'var(--danger)';
        if (total >= 800) tColor = 'var(--success)';
        else if (total >= 550) tColor = 'var(--accent)';
        else if (total >= 350) tColor = 'var(--warning)';
        
        totalEl.style.color = tColor;
        totalEl.style.textShadow = `0 0 15px ${tColor}80`;
    }
    
    updateBar('insulation',  score.insulation,  350);
    updateBar('efficiency',  score.efficiency,  300);
    updateBar('health',      score.health,      250);
    updateBar('accumulation',score.accumulation,100);
    
    const msgEl = document.getElementById('exp_message');
    if (msgEl) {
        msgEl.innerHTML = App.generateExpertMessage(score);
    }
};

// ─── 5. FINANCE A ODHADY ────────────────────────────────────────────────────
App.changeSeason = function (delta) {
    const keys = Object.keys(seasonalStats || {}).sort();
    if (keys.length === 0) return;
    if (selectedSeason === null) selectedSeason = delta > 0 ? keys[0] : keys[keys.length - 1];
    else {
        let idx = keys.indexOf(selectedSeason) + delta;
        selectedSeason = (idx < 0 || idx >= keys.length) ? null : keys[idx];
    }
    App.updateFinanceView();
};

App.updateFinanceView = function () {
    const fin = window.financeMetricsGlobal;
    if (!currentStats || !fin) return;
    
    const p = CONFIG.priceKwh;
    
    const safe = (x, fb = 0) => Number.isFinite(x) ? x : fb;

    const s = selectedSeason && fin.seasons[selectedSeason] ? fin.seasons[selectedSeason] : fin.total;
    if (!s) return;

    const setText = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };

    setText('win_L_Sum', "1 den (Ø)"); 
    setText('win_C_Sum', safe(s.avgTotalKwh).toFixed(1) + " kWh"); 
    setText('win_R_Sum', (safe(s.avgTotalKwh) * p).toFixed(0) + " Kč");
    setText('win_C_Heat', safe(s.avgHeatKwh).toFixed(1) + " kWh"); 
    setText('win_R_Heat', (safe(s.avgHeatKwh) * p).toFixed(0) + " Kč");
    setText('win_C_Tuv', safe(s.avgTuvKwh).toFixed(1) + " kWh"); 
    setText('win_R_Tuv', (safe(s.avgTuvKwh) * p).toFixed(0) + " Kč");
    setText('win_C_Standby', safe(s.avgStandbyKwh).toFixed(1) + " kWh"); 
    setText('win_R_Standby', (safe(s.avgStandbyKwh) * p).toFixed(0) + " Kč");

    setText('seasonLabel', selectedSeason || "CELKEM");

    setText('all_L_Sum', Math.round(s.days) + " dní"); 
    setText('all_C_Sum', safe(s.totalKwh).toFixed(0) + " kWh"); 
    setText('all_R_Sum', (safe(s.totalKwh) * p).toFixed(0) + " Kč");
    setText('all_C_Heat', safe(s.totalHeatKwh).toFixed(0) + " kWh"); 
    setText('all_R_Heat', (safe(s.totalHeatKwh) * p).toFixed(0) + " Kč");
    setText('all_C_Tuv', safe(s.totalTuvKwh).toFixed(0) + " kWh"); 
    setText('all_R_Tuv', (safe(s.totalTuvKwh) * p).toFixed(0) + " Kč");
    setText('all_C_Standby', safe(s.totalStandbyKwh).toFixed(0) + " kWh"); 
    setText('all_R_Standby', (safe(s.totalStandbyKwh) * p).toFixed(0) + " Kč");

    const scopEl = document.getElementById('est_SCOP');
    const scopHeatEl = document.getElementById('est_SCOP_Heat');
    if (scopEl) scopEl.innerText = s.isSummerData ? "-" : s.finalSCOP.toFixed(2);
    if (scopHeatEl) scopHeatEl.innerText = s.isSummerData ? "-" : s.finalScopHeat.toFixed(2);

    const invalidStyle = s.isSummerData ? 'text-decoration: line-through; opacity: 0.5;' : '';
    
    setText('est_C_Tuv', s.estTuvKwh.toFixed(0) + " kWh"); 
    setText('est_R_Tuv', (s.estTuvKwh * p).toFixed(0) + " Kč");

    const heatElKwh = document.getElementById('est_C_Heat');
    const heatElCost = document.getElementById('est_R_Heat');
    if (heatElKwh) { heatElKwh.innerText = (s.yearlyHeatWhEl / 1000).toFixed(0) + " kWh"; heatElKwh.style.cssText = invalidStyle; }
    if (heatElCost) { heatElCost.innerText = ((s.yearlyHeatWhEl / 1000) * p).toFixed(0) + " Kč"; heatElCost.style.cssText = invalidStyle; }

    const standbyElKwh = document.getElementById('est_C_Standby');
    const standbyElCost = document.getElementById('est_R_Standby');
    if (standbyElKwh) { standbyElKwh.innerText = safe(s.yearlyStandbyKwh).toFixed(0) + " kWh"; standbyElKwh.style.cssText = invalidStyle; }
    if (standbyElCost) { standbyElCost.innerText = (safe(s.yearlyStandbyKwh) * p).toFixed(0) + " Kč"; standbyElCost.style.cssText = invalidStyle; }

    const sumElKwh = document.getElementById('est_C_Sum');
    const sumElCost = document.getElementById('est_R_Sum');
    if (sumElKwh && sumElCost) {
        if (s.isSummerData) {
            sumElKwh.innerText = "> " + s.estTuvKwh.toFixed(0) + " kWh"; 
            sumElCost.innerText = "> " + (s.estTuvKwh * p).toFixed(0) + " Kč";
            sumElKwh.style.color = "var(--warning)"; sumElCost.style.color = "var(--warning)";
        } else {
            sumElKwh.innerText = s.totalEstElKwh.toFixed(0) + " kWh"; 
            sumElCost.innerText = (s.totalEstElKwh * p).toFixed(0) + " Kč";
            sumElKwh.style.color = ""; sumElCost.style.color = "";
        }
    }

    const realElKwh = document.getElementById('est_C_Real');
    const realElCost = document.getElementById('est_R_Real');
    if (realElKwh && realElCost) {
        if (s.isSummerData) {
            realElKwh.innerText = "-";
            realElCost.innerText = "-";
        } else {
            realElKwh.innerText = safe(s.realEstKwh).toFixed(0) + " kWh";
            realElCost.innerText = (safe(s.realEstKwh) * p).toFixed(0) + " Kč";
        }
    }
};

App.updateUserPrice = function() {
    const priceSlider = document.getElementById('userPriceSlider');
    if(!priceSlider) return;
    const newPrice = parseFloat(priceSlider.value);
    
    const displayEl = document.getElementById('userPriceDisplay');
    if (displayEl) displayEl.innerText = newPrice.toFixed(2) + ' Kč';
    
    if(window.financeMetricsGlobal && window.financeMetricsGlobal.total) {
        let yCost = window.financeMetricsGlobal.total.totalEstElKwh * newPrice;
        document.querySelectorAll('#userYearlyCost').forEach(el => el.innerText = Math.round(yCost).toLocaleString('cs-CZ') + ' Kč');
    }
    if(currentStats) {
        let pCost = currentStats.totalKwh * newPrice;
        document.querySelectorAll('#userPeriodCost').forEach(el => el.innerText = Math.round(pCost).toLocaleString('cs-CZ') + ' Kč');
    }

    let label = (currentSelectionMode === 'day') ? (isTodayMode ? 'Dnes' : currentSelectedDate.toLocaleDateString('cs-CZ')) : 
                ((currentSelectionMode === 'month') ? 'Tento měsíc' : 'Vybrané období');
    document.querySelectorAll('#userPeriodLabel').forEach(el => el.innerText = label);

    if (typeof App.updateSimulators === 'function') App.updateSimulators();
    
    if (currentView === 'cost' && lastWindowData) {
        App.setView('cost', true);
    }
};

App.switchTab = function (tabName, el) {
    const targetTab = document.getElementById('tab-' + tabName);
    if (!targetTab) return;

    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    targetTab.classList.add('active');
    if (el) el.classList.add('active');

    if (window.App && typeof App.refreshColors === 'function') {
        try { App.refreshColors(); } catch (e) { }
    }

    if (tabName === 'charts') {
        if (typeof App.updateChartButtons === 'function') App.updateChartButtons();
        setTimeout(() => {
            if (!myChart) {
                try {
                    App.initCharts(currentView);
                    isFirstChartRender = false;
                } catch (e) { }
            } else {
                try {
                    if (isFirstChartRender) {
                        App.initCharts(currentView);
                        isFirstChartRender = false;
                    } else {
                        myChart.resize();
                        if (voltChart) voltChart.resize();
                    }
                } catch (e) { }
            }

            if (lastWindowData && lastWindowData.length > 0) {
                try { App.renderCharts(lastWindowData, lastColors, lastDescriptions, false); } catch (e) { }
            }
        }, 10);
    }

    if (tabName === 'finance') {
        try { App.updateFinanceView(); } catch (e) { }
        try { App.updateUserPrice(); } catch (e) { }
    }
    
    if (tabName === 'simulators') {
        try { App.updateSimulators(); } catch (e) { }
        try { App.updateUserPrice(); } catch (e) { }
    }
};

App.openSettings = function () {
    const m = document.getElementById('settingsModal');
    if (m) m.classList.add('open');
};

App.closeSettings = function (e) {
    const m = document.getElementById('settingsModal');
    if (!m) return;
    if (!e || e.target.id === 'settingsModal' || e.target.className === 'modal-close') m.classList.remove('open');
};

App.openCurveModal = function () {
    setTimeout(() => {
        try { App.renderCurvePage(); } catch (e) { }
    }, 50);
    const m = document.getElementById('curveModal');
    if (m) m.classList.add('open');
};

App.closeCurveModal = function (e) {
    const m = document.getElementById('curveModal');
    if (!m) return;
    if (!e || e.target.id === 'curveModal' || e.target.className === 'modal-close') m.classList.remove('open');
};

App.openCalendar = function (target) {
    calendarTarget = target || 'main';
    
    if (calendarTarget === 'main' || calendarTarget === 'exportMonth') {
        calDate = new Date(currentSelectedDate);
    } else {
        const inputEl = document.getElementById(calendarTarget);
        if (inputEl && inputEl.value) {
            calDate = new Date(inputEl.value);
        } else {
            calDate = new Date(currentSelectedDate);
        }
    }

    try { App.renderCalendar(); } catch (e) { console.error("Chyba kalendáře:", e); }
    const m = document.getElementById('calendarModal');
    if (m) m.classList.add('open');
};

App.closeCalendar = function (e) {
    const m = document.getElementById('calendarModal');
    if (!m) return;
    if (!e || e.target.id === 'calendarModal' || e.target.className === 'modal-close') m.classList.remove('open');
};

App.updateChartButtons = function () {
    const btn1 = document.getElementById('btnGroup1');
    const btn2 = document.getElementById('btnGroup2');
    const btnCop = document.getElementById('btnCopView');
    const btnCost = document.getElementById('btnCostView');

    if (!btn1 || !btn2 || !btnCop || !btnCost) return;

    // Btn1 label — group1 views: line, bar, thermal (zachovej poslední použitý při jiném view)
    if (currentView === 'line') btn1.innerText = 'LINE';
    else if (currentView === 'bar') btn1.innerText = 'BAR';
    else if (currentView === 'thermal') btn1.innerText = 'TEPLO';
    // else: zachovej aktuální label (btn1 ukazuje poslední použitý group1 view)

    // Btn2 label — group2 views: agg_days, agg_months
    if (currentView === 'agg_months') btn2.innerText = 'MĚSÍCE';
    else btn2.innerText = 'DNY';

    // COP label
    btnCop.innerText = typeof copViewMode !== 'undefined' && copViewMode === 'monthly' ? 'COP (M)' : 'COP';

    // CENA label
    btnCost.innerText = typeof costViewMode !== 'undefined' && costViewMode === 'monthly' ? 'CENA (M)' : 'CENA';

    // Active states
    const allBtns = [btn1, btn2, btnCop, btnCost];
    allBtns.forEach(b => b.classList.remove('active'));

    if (['line', 'bar', 'thermal'].includes(currentView)) btn1.classList.add('active');
    else if (['agg_days', 'agg_months'].includes(currentView)) btn2.classList.add('active');
    else if (currentView === 'agg_cop') btnCop.classList.add('active');
    else if (currentView === 'cost') btnCost.classList.add('active');
};

// Cyklické přepínání btn1: line → bar → thermal → line
App.cycleGroup1 = function () {
    const order = ['line', 'bar', 'thermal'];
    const curIdx = order.indexOf(currentView);
    // Pokud jsme v group1, jdi na další; jinak začni od line
    const nextIdx = curIdx >= 0 ? (curIdx + 1) % order.length : 0;
    App.setView(order[nextIdx]);
};

// Cyklické přepínání btn2: agg_days → agg_months → agg_days
App.cycleGroup2 = function () {
    App.setView(currentView === 'agg_days' ? 'agg_months' : 'agg_days');
};

App.setUserChartView = function(type) {
    if (type === 'days') App.setView('agg_days');
    if (type === 'months') App.setView('agg_months');
    if (type === 'cop') {
        copViewMode = 'monthly';
        App.setView('agg_cop');
    }
    if (type === 'cost') {
        costViewMode = 'monthly';
        App.setView('cost');
    }
};

// ─── 6. KALENDÁŘ A ČASOVÁ OSA ───────────────────────────────────────────────
App.changeCalMonth = function (delta) {
    calDate.setDate(1);
    calDate.setMonth(calDate.getMonth() + delta);
    try { App.renderCalendar(); } catch (e) { }
};

App.setCalMode = function(mode, btn) {
    calendarDisplayMode = mode;
    document.querySelectorAll('.cal-modes .view-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    App.renderCalendar();
};

App.renderCalendar = function () {
    const label = document.getElementById('calMonthLabel');
    const grid = document.getElementById('calDays');
    if (!label || !grid) return;

    // Synchronizace aktivního tlačítka podle calendarDisplayMode
    document.querySelectorAll('.cal-modes .view-btn').forEach(b => {
        const m = b.getAttribute('onclick');
        b.classList.toggle('active', m && m.includes("'" + calendarDisplayMode + "'"));
    });

    const year = calDate.getFullYear(), month = calDate.getMonth();
    const monthNames = ["LEDEN", "ÚNOR", "BŘEZEN", "DUBEN", "KVĚTEN", "ČERVEN", "ČERVENEC", "SRPEN", "ZÁŘÍ", "ŘÍJEN", "LISTOPAD", "PROSINEC"];
    
    label.innerHTML = `<span style="cursor:pointer; text-decoration:underline;" onclick="App.selectMonthFromCalendar(${year}, ${month})">${monthNames[month]}</span> <span style="font-weight: 800;">${year}</span>`;

    const firstDay = new Date(year, month, 1).getDay();
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    grid.innerHTML = '';

    for (let i = 0; i < startOffset; i++) {
        const d = document.createElement('div');
        d.className = 'cal-day empty';
        grid.appendChild(d);
    }

    let selStr = "";
    if (calendarTarget === 'main') {
        if (currentSelectionMode === 'day') {
            selStr = `${currentSelectedDate.getFullYear()}-${String(currentSelectedDate.getMonth() + 1).padStart(2, '0')}-${String(currentSelectedDate.getDate()).padStart(2, '0')}`;
        }
    } else if (calendarTarget === 'exportMonth') {
        selStr = "";
    } else {
        const targetEl = document.getElementById(calendarTarget);
        if (targetEl && targetEl.value) {
            const d = new Date(targetEl.value);
            selStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }

    let maxCost = 0;
    if (calendarDisplayMode === 'cost' && typeof dailyStatsGlobal !== 'undefined') {
        dailyStatsGlobal.forEach(s => { if (s.value > maxCost) maxCost = s.value; });
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const d = document.createElement('div');
        d.className = 'cal-day';

        const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (key === selStr) d.classList.add('selected');

        let dayStat = (typeof dailyStatsGlobal !== 'undefined') ? dailyStatsGlobal.find(s => s.dateStr === key) : null;
        let hCode = (typeof dailyHealthMap !== 'undefined' && dailyHealthMap[key]) ? (dailyHealthMap[key].code || dailyHealthMap[key]) : null;

        let contentHtml = `<span class="cal-num">${day}</span>`;

        if (calendarDisplayMode === 'temp' && dayStat && dayStat.tempCount > 0) {
            let avgT = dayStat.tempSum / dayStat.tempCount;
            let r, g, b;
            if (avgT < 0) {
                let intensity = Math.max(0, 1 - (Math.abs(avgT) / 20));
                r = Math.round(150 + (105 * intensity));
                g = Math.round(200 + (55 * intensity));
                b = 255;
            } else {
                let intensity = Math.min(1, avgT / 25);
                r = 255;
                g = Math.round(255 - (200 * intensity));
                b = Math.round(255 - (200 * intensity));
            }
            d.style.background = `rgb(${r},${g},${b})`;
            d.style.borderColor = `rgba(0,0,0,0.1)`;
            let textColor = (avgT > 15) ? 'white' : '#0c0f17';
            
            contentHtml = `<span class="cal-num" style="color:${textColor}; text-shadow: 0 1px 3px rgba(0,0,0,0.3);">${day}</span>`;
            contentHtml += `<span style="font-size: 0.55rem; font-weight: 800; margin-top: 1px; color: ${textColor}; opacity: 0.8;">${avgT.toFixed(1)}°</span>`;

        } else if (calendarDisplayMode === 'cost' && dayStat) {
            let intensity = maxCost > 0 ? (dayStat.value / maxCost) : 0;
            let r = Math.round(34 + (10 * intensity));
            let g = Math.round(197 - (100 * intensity));
            let b = Math.round(94 + (20 * intensity));
            
            d.style.background = `rgba(${r},${g},${b}, ${0.2 + (0.8 * intensity)})`;
            d.style.borderColor = `rgba(${r},${g},${b}, 0.5)`;
            
            contentHtml = `<span class="cal-num" style="color:white;">${day}</span>`;
            contentHtml += `<span style="font-size: 0.5rem; font-weight: 800; margin-top: 1px; color: rgba(255,255,255,0.7);">${Math.round(dayStat.value)} Kč</span>`;
            
        } else if (calendarDisplayMode === 'health' && hCode) {
            let bgCol, txtCol = 'white';
            if (hCode === 'green') bgCol = 'rgba(34, 197, 94, 0.6)';
            else if (hCode === 'yellow') bgCol = 'rgba(234, 179, 8, 0.6)';
            else if (hCode === 'orange') bgCol = 'rgba(249, 115, 22, 0.6)';
            else if (hCode === 'red') bgCol = 'rgba(239, 68, 68, 0.6)';
            else { bgCol = 'transparent'; txtCol = 'rgba(238,241,247,0.58)'; }

            d.style.background = bgCol;
            d.style.borderColor = 'rgba(255,255,255,0.1)';
            
            contentHtml = `<span class="cal-num" style="color:${txtCol}; text-shadow: 0 1px 3px rgba(0,0,0,0.3);">${day}</span>`;
        } else {
            contentHtml = `<span class="cal-num">${day}</span>`;
        }

        if (key === selStr && (calendarDisplayMode === 'temp' || calendarDisplayMode === 'cost' || calendarDisplayMode === 'health')) {
            d.style.boxShadow = '0 0 15px rgba(255,255,255,0.8)';
            d.style.transform = 'scale(1.1)';
            d.style.zIndex = '10';
            d.style.borderColor = 'white';
        }

        d.innerHTML = contentHtml;
        d.onclick = () => { App.selectDateFromCalendar(year, month, day); };
        grid.appendChild(d);
    }
};

App.selectMonthFromCalendar = function(y, m) {
    if (calendarTarget === 'main') {
        currentSelectedDate = new Date(y, m, 1);
        currentSelectionMode = 'month';
        isTodayMode = false;
        App.updateDateLabel();
        
        App.updateChartButtons();
        
        App.closeCalendar(null);
        App.runPipeline();
    } else if (calendarTarget === 'exportMonth' || calendarTarget === 'exportStart' || calendarTarget === 'exportEnd') {
        const startCol = document.getElementById('exportStartBtn').parentElement;
        const endCol = document.getElementById('exportEndBtn').parentElement;
        const startLabel = startCol.querySelector('label');
        
        startLabel.innerText = 'MĚSÍC';
        endCol.style.display = 'none';
        document.getElementById('exportStartBtn').onclick = () => App.openCalendar('exportMonth');

        const startD = new Date(y, m, 1);
        const endD = new Date(y, m + 1, 0);
        
        const sStr = startD.getFullYear() + '-' + String(startD.getMonth() + 1).padStart(2, '0') + '-' + String(startD.getDate()).padStart(2, '0');
        const eStr = endD.getFullYear() + '-' + String(endD.getMonth() + 1).padStart(2, '0') + '-' + String(endD.getDate()).padStart(2, '0');
        
        document.getElementById('exportStart').value = sStr;
        document.getElementById('exportEnd').value = eStr;
        
        const mNames = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
        document.getElementById('exportStartBtn').innerText = `${mNames[m]} ${y}`;
        
        App.updateExportOptions();
        App.closeCalendar(null);
    }
};

App.selectDateFromCalendar = function (y, m, d) {
    if (calendarTarget === 'main') {
        currentSelectedDate = new Date(y, m, d);
        currentSelectionMode = 'day';
        const today = new Date(); today.setHours(0, 0, 0, 0);
        isTodayMode = currentSelectedDate.getTime() === today.getTime();
        App.updateDateLabel();
        
        App.updateChartButtons();
        
        App.closeCalendar(null);
        App.runPipeline();
    } else {
        const selectedStrIso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const displayStr = `${d}. ${m + 1}. ${y}`;

        if (calendarTarget === 'exportMonth') {
            const startCol = document.getElementById('exportStartBtn').parentElement;
            const endCol = document.getElementById('exportEndBtn').parentElement;
            const startLabel = startCol.querySelector('label');
            
            startLabel.innerText = 'OD';
            endCol.style.display = 'flex';
            document.getElementById('exportStartBtn').onclick = () => App.openCalendar('exportStart');
            
            document.getElementById('exportStart').value = selectedStrIso;
            document.getElementById('exportStartBtn').innerText = displayStr;
            document.getElementById('exportEnd').value = selectedStrIso;
            document.getElementById('exportEndBtn').innerText = displayStr;
            
        } else {
            const hiddenInput = document.getElementById(calendarTarget);
            const visibleBtn = document.getElementById(calendarTarget + 'Btn');
            
            if (hiddenInput) hiddenInput.value = selectedStrIso;
            if (visibleBtn) visibleBtn.innerText = displayStr;
        }
        
        App.updateExportOptions();
        App.closeCalendar(null);
    }
};

App.updateDateLabel = function () {
    const nav = document.getElementById('navLabel');
    const btnNext = document.getElementById('btnNextDay');
    const btnNow = document.getElementById('btnNowMini');

    if (nav) {
        if (currentSelectionMode === 'day') {
            nav.innerText = isTodayMode ? "DNES (24h)" : currentSelectedDate.toLocaleDateString('cs-CZ');
        } else if (currentSelectionMode === 'month') {
            const mNames = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
            nav.innerText = `${mNames[currentSelectedDate.getMonth()]} ${currentSelectedDate.getFullYear()}`;
        }
    }
    
    if (btnNext) {
        if (currentSelectionMode === 'day') {
            btnNext.disabled = isTodayMode;
        } else if (currentSelectionMode === 'month') {
            const today = new Date();
            btnNext.disabled = (currentSelectedDate.getFullYear() === today.getFullYear() && currentSelectedDate.getMonth() === today.getMonth());
        }
    }
    
    if (btnNow) {
        btnNow.style.display = (isTodayMode && currentSelectionMode === 'day') ? 'none' : 'inline-block';
    }
};

App.resetToToday = function () {
    currentSelectionMode = 'day';
    isTodayMode = true;
    currentSelectedDate = new Date();
    
    App.updateChartButtons();
    App.smartNav(0);
};

App.smartNav = function (delta) {
    if (currentSelectionMode === 'day') {
        if (isTodayMode && delta < 0) {
            isTodayMode = false;
            currentSelectedDate = new Date();
            currentSelectedDate.setHours(0, 0, 0, 0);
            currentSelectedDate.setDate(currentSelectedDate.getDate() - 1);
        } else if (!isTodayMode) {
            currentSelectedDate.setDate(currentSelectedDate.getDate() + delta);
            if (currentSelectedDate >= new Date().setHours(0, 0, 0, 0)) {
                isTodayMode = true;
                currentSelectedDate = new Date();
            }
        }
    } else if (currentSelectionMode === 'month') {
        currentSelectedDate.setMonth(currentSelectedDate.getMonth() + delta);
        const today = new Date();
        if (currentSelectedDate.getFullYear() > today.getFullYear() || (currentSelectedDate.getFullYear() === today.getFullYear() && currentSelectedDate.getMonth() > today.getMonth())) {
            currentSelectedDate = new Date(today.getFullYear(), today.getMonth(), 1);
        }
    }

    App.updateDateLabel();
    App.updateChartButtons();
    
    App.runPipeline();
};

// ─── 7. POKROČILÝ EXPORT DAT ────────────────────────────────────────────────
App.updateExportOptions = function() {}; // Stub — hookuje budoucí logiku při výběru exportního rozsahu

App.openExport = function () {
    const m = document.getElementById('exportModal');
    if (!m) return;

    const startCol = document.getElementById('exportStartBtn').parentElement;
    const endCol = document.getElementById('exportEndBtn').parentElement;
    const startLabel = startCol.querySelector('label');
    
    let startD = new Date(currentSelectedDate);
    let endD = new Date(currentSelectedDate);
    
    if (currentSelectionMode === 'month') {
        startD.setDate(1);
        endD = new Date(startD.getFullYear(), startD.getMonth() + 1, 0);
        
        startLabel.innerText = 'MĚSÍC';
        endCol.style.display = 'none';
        document.getElementById('exportStartBtn').onclick = () => App.openCalendar('exportMonth');
        
        const mNames = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
        document.getElementById('exportStartBtn').innerText = `${mNames[startD.getMonth()]} ${startD.getFullYear()}`;
    } else {
        startLabel.innerText = 'OD';
        endCol.style.display = 'flex';
        document.getElementById('exportStartBtn').onclick = () => App.openCalendar('exportStart');
        
        let sDisp = startD.getDate() + '. ' + (startD.getMonth() + 1) + '. ' + startD.getFullYear();
        let eDisp = endD.getDate() + '. ' + (endD.getMonth() + 1) + '. ' + endD.getFullYear();
        
        document.getElementById('exportStartBtn').innerText = sDisp;
        document.getElementById('exportEndBtn').innerText = eDisp;
    }
    
    let sStr = startD.getFullYear() + '-' + String(startD.getMonth() + 1).padStart(2, '0') + '-' + String(startD.getDate()).padStart(2, '0');
    let eStr = endD.getFullYear() + '-' + String(endD.getMonth() + 1).padStart(2, '0') + '-' + String(endD.getDate()).padStart(2, '0');
    
    document.getElementById('exportStart').value = sStr;
    document.getElementById('exportEnd').value = eStr;

    App.updateExportOptions();

    const ta = document.getElementById('exportTextarea');
    if (ta) ta.value = '';

    m.classList.add('open');
    App.generateExport();
};

App.closeExport = function (e) {
    const m = document.getElementById('exportModal');
    if (!m) return;
    if (!e || e.target.id === 'exportModal' || e.target.className === 'modal-close') m.classList.remove('open');
};

App.copyExport = function () {
    if (!App.lastExportClipboard) return;
    
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(App.lastExportClipboard).then(() => {
            if(window.App && typeof App.showError === 'function') App.showError("Zkopírováno (připraveno pro Excel)!"); 
        }).catch(err => {
            console.error('Kopírování selhalo', err);
        });
    } else {
        const ta = document.getElementById('exportTextarea');
        if (ta) {
            const originalValue = ta.value;
            ta.value = App.lastExportClipboard;
            ta.select();
            ta.setSelectionRange(0, 9999999);
            try {
                document.execCommand('copy');
                if(window.App && typeof App.showError === 'function') App.showError("Zkopírováno (připraveno pro Excel)!"); 
            } catch(err) {
                console.error('Kopírování selhalo', err);
            }
            ta.value = originalValue;
        }
    }
};

App.shareExport = function () {
    if (!App.lastExportCsv) {
        if(window.App && typeof App.showError === 'function') App.showError("Žádná data ke sdílení.");
        return;
    }
    
    let fileDate = document.getElementById('exportStart').value || "Data";
    const fileName = `TC_Expert_Export_${fileDate}.csv`;
    
    const blob = new Blob(['\ufeff' + App.lastExportCsv], { type: 'text/csv;charset=utf-8;' });
    const file = new File([blob], fileName, { type: 'text/csv' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({
            title: 'TČ Expert PRO - Export',
            files: [file]
        }).catch(err => { 
            console.log('Sdílení zrušeno nebo selhalo', err); 
        });
    } else {
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if(window.App && typeof App.showError === 'function') App.showError("Staženo jako soubor CSV.");
    }
};

App.initializeInputs = function () {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };

    setVal('floorArea', CONFIG.floorArea);
    setVal('targetIndoorTemp', CONFIG.targetIndoorTemp);
    setVal('designTemp', CONFIG.designTemp);
    setVal('heatingThreshold', CONFIG.heatingThreshold);
    setVal('internalGainW', CONFIG.internalGainW);
    setVal('locLat', CONFIG.locLat); 
    setVal('locLon', CONFIG.locLon);

    setVal('tuvLwt', CONFIG.curve.tuvLwt);
    setVal('curvTOutMin', CONFIG.curve.tOutMin); 
    setVal('curvLwtMax', CONFIG.curve.lwtMax);
    setVal('curvTOutMax', CONFIG.curve.tOutMax); 
    setVal('curvLwtMin', CONFIG.curve.lwtMin);

    setVal('limitRun', CONFIG.limits.run); 
    setVal('ecoMaxWatts', CONFIG.limits.ecoMax);
    setVal('lowModMaxWatts', CONFIG.limits.lowModMax);
    setVal('defrostSpike', CONFIG.limits.defrostSpike); 
    setVal('oilWatts', CONFIG.limits.oilWatts);

    setVal('minTuv', CONFIG.tuv.minTuv);
    setVal('maxTuv', CONFIG.tuv.maxTuv); 
    setVal('tuvDynMax', CONFIG.tuv.dynMax);
    setVal('tuvDynMin', CONFIG.tuv.dynMin);
    setVal('tuvEndW', CONFIG.tuv.endW);
    setVal('tuvDropW', CONFIG.tuv.dropW);

    setVal('oilRatio', CONFIG.filters.oilRatio);
    setVal('noiseW', CONFIG.filters.noiseW);
    setVal('noiseMins', CONFIG.filters.noiseMins);
    setChk('noiseFilter', CONFIG.filters.noiseFilter); 

    setVal('minRunTime', CONFIG.durations.minRun);
    setVal('riskGap', CONFIG.durations.riskGap); 
    setVal('minDefrostGap', CONFIG.durations.minDefrostGap);
    setVal('maxDefrostGap', CONFIG.durations.maxDefrostGap); 
    setVal('maxGapS', CONFIG.durations.maxGapS);
    setVal('priceKwh', CONFIG.priceKwh);
    setVal('tuvLossFactor', CONFIG.estimations.tuvLoss);
    setVal('tuvCopEstimate', CONFIG.estimations.tuvCop);
    setVal('monthDays', CONFIG.estimations.monthDays);

    setVal('hpPreset', CONFIG.system.hpPreset);
    setVal('hpName', CONFIG.system.hpName);
    const matrixEl = document.getElementById('hpMatrix');
    if (matrixEl) matrixEl.value = CONFIG.system.hpMatrix;

    setVal('trendDays', CONFIG.system.trendDays);
    setVal('defVolt', CONFIG.system.defVolt);
    setVal('minVolt', CONFIG.system.minVolt);
    setVal('lifeStarts', CONFIG.system.lifeStarts);
};


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

App.updateConfig = function () {
    const getInt = (id, fallback = 0) => { const el = document.getElementById(id); if (!el) return fallback; const v = parseInt(el.value, 10); return Number.isFinite(v) ? v : fallback; };
    const getFloat = (id, fallback = 0) => { const el = document.getElementById(id); if (!el) return fallback; const v = parseFloat(el.value); return Number.isFinite(v) ? v : fallback; };
    const getChk = (id, fallback = false) => { const el = document.getElementById(id); if (!el) return fallback; return !!el.checked; };
    const getString = (id, fallback = "") => { const el = document.getElementById(id); return el ? el.value : fallback; };

    CONFIG.floorArea = getFloat('floorArea', CONFIG.floorArea);
    CONFIG.targetIndoorTemp = getFloat('targetIndoorTemp', CONFIG.targetIndoorTemp);
    CONFIG.designTemp = getInt('designTemp', CONFIG.designTemp);
    CONFIG.heatingThreshold = getFloat('heatingThreshold', CONFIG.heatingThreshold);
    CONFIG.internalGainW = getInt('internalGainW', CONFIG.internalGainW);
    const prevLat = CONFIG.locLat;
    const prevLon = CONFIG.locLon;
    CONFIG.locLat = getFloat('locLat', CONFIG.locLat);
    CONFIG.locLon = getFloat('locLon', CONFIG.locLon);
    const locChanged = (CONFIG.locLat !== prevLat || CONFIG.locLon !== prevLon);

    CONFIG.curve.tuvLwt = getFloat('tuvLwt', CONFIG.curve.tuvLwt);
    CONFIG.curve.tOutMin = getFloat('curvTOutMin', CONFIG.curve.tOutMin);
    CONFIG.curve.lwtMax = getFloat('curvLwtMax', CONFIG.curve.lwtMax);
    CONFIG.curve.tOutMax = getFloat('curvTOutMax', CONFIG.curve.tOutMax);
    CONFIG.curve.lwtMin = getFloat('curvLwtMin', CONFIG.curve.lwtMin);

    CONFIG.limits.run = getInt('limitRun', CONFIG.limits.run);
    CONFIG.limits.ecoMax = getInt('ecoMaxWatts', CONFIG.limits.ecoMax);
    CONFIG.limits.lowModMax = getInt('lowModMaxWatts', CONFIG.limits.lowModMax);
    CONFIG.limits.defrostSpike = getInt('defrostSpike', CONFIG.limits.defrostSpike);
    CONFIG.limits.oilWatts = getInt('oilWatts', CONFIG.limits.oilWatts);

    CONFIG.tuv.minTuv = getInt('minTuv', CONFIG.tuv.minTuv);
    CONFIG.tuv.maxTuv = getInt('maxTuv', CONFIG.tuv.maxTuv);
    CONFIG.tuv.dynMax = getInt('tuvDynMax', CONFIG.tuv.dynMax);
    CONFIG.tuv.dynMin = getInt('tuvDynMin', CONFIG.tuv.dynMin);
    CONFIG.tuv.endW = getInt('tuvEndW', CONFIG.tuv.endW);
    CONFIG.tuv.dropW = getInt('tuvDropW', CONFIG.tuv.dropW);

    CONFIG.filters.oilRatio = getFloat('oilRatio', CONFIG.filters.oilRatio);
    CONFIG.filters.noiseW = getInt('noiseW', CONFIG.filters.noiseW);
    CONFIG.filters.noiseMins = getInt('noiseMins', CONFIG.filters.noiseMins);
    CONFIG.filters.noiseFilter = getChk('noiseFilter', CONFIG.filters.noiseFilter);

    CONFIG.durations.minRun = getInt('minRunTime', CONFIG.durations.minRun);
    CONFIG.durations.riskGap = getInt('riskGap', CONFIG.durations.riskGap);
    CONFIG.durations.minDefrostGap = getInt('minDefrostGap', CONFIG.durations.minDefrostGap);
    CONFIG.durations.maxDefrostGap = getInt('maxDefrostGap', CONFIG.durations.maxDefrostGap);
    CONFIG.durations.maxGapS = getInt('maxGapS', CONFIG.durations.maxGapS);
    CONFIG.priceKwh = getFloat('priceKwh', CONFIG.priceKwh);
    CONFIG.estimations.tuvLoss = getFloat('tuvLossFactor', CONFIG.estimations.tuvLoss);
    CONFIG.estimations.tuvCop = getFloat('tuvCopEstimate', CONFIG.estimations.tuvCop);
    CONFIG.estimations.monthDays = getFloat('monthDays', CONFIG.estimations.monthDays);
    CONFIG.estimations.installYear = getFloat('installYear', CONFIG.estimations.installYear || 0);
    CONFIG.estimations.copCalibration = getFloat('copCalibration', CONFIG.estimations.copCalibration || 1.0);

    CONFIG.system.hpPreset = getString('hpPreset', CONFIG.system.hpPreset);
    CONFIG.system.hpName = getString('hpName', CONFIG.system.hpName);
    CONFIG.system.hpMatrix = getString('hpMatrix', CONFIG.system.hpMatrix);
    CONFIG.system.trendDays = getInt('trendDays', CONFIG.system.trendDays);
    CONFIG.system.defVolt = getInt('defVolt', CONFIG.system.defVolt);
    CONFIG.system.minVolt = getInt('minVolt', CONFIG.system.minVolt);
    CONFIG.system.lifeStarts = getInt('lifeStarts', CONFIG.system.lifeStarts);

    const curveModal = document.getElementById('curveModal');
    if (curveModal && curveModal.classList.contains('open')) {
        try { App.renderCurvePage(); } catch (e) { }
    }

    if (typeof dayCache !== 'undefined') {
        dayCache = {};
    }
    if (typeof worker !== 'undefined' && worker) {
        workerHasData = false;
        worker.postMessage({ type: 'CLEAR_CACHE' });
    }

    // Pokud se změnila lokace, stáhni nové evanTemps — ta zavolají runPipeline sama
    if (typeof locChanged !== 'undefined' && locChanged) {
        App.updateEvanTemps(CONFIG.locLat, CONFIG.locLon);
    } else {
        App.runPipeline();
    }
};

App.changeHpPreset = function () {
    const presetSel = document.getElementById('hpPreset');
    if (!presetSel) return;
    const val = presetSel.value;
    
    if (val !== 'custom' && typeof HP_PRESETS !== 'undefined' && HP_PRESETS[val]) {
        const nameEl = document.getElementById('hpName');
        const matrixEl = document.getElementById('hpMatrix');
        if (nameEl) nameEl.value = HP_PRESETS[val].name;
        if (matrixEl) matrixEl.value = HP_PRESETS[val].matrix;
    }
    App.updateConfig();
};

App.customHpEdited = function () {
    const presetSel = document.getElementById('hpPreset');
    if (presetSel && presetSel.value !== 'custom') {
        presetSel.value = 'custom';
    }
    
    clearTimeout(window.hpEditTimeout);
    window.hpEditTimeout = setTimeout(() => {
        App.updateConfig();
    }, 800);
};

// ─── 8. UŽIVATELSKÝ REŽIM A NASTAVENÍ ───────────────────────────────────────
App.toggleMode = function(cb) {
    currentAppMode = cb.checked ? 'user' : 'analyst';
    document.body.className = 'mode-' + currentAppMode;

    // Zapamatuj zvolený režim (#69)
    try { localStorage.setItem('tcAppMode', currentAppMode); } catch (e) {}

    // Skryj/zobraz technické záložky podle režimu (#67)
    App.applyModeNav();

    if (currentStats) {
        App.emit('updateStats', currentStats);
    }

    setTimeout(() => {
        if (currentView === 'line' || currentView === 'bar' || currentView === 'thermal') {
            if (lastWindowData && lastWindowData.length > 0) {
                App.renderCharts(lastWindowData, lastColors, lastDescriptions, true);
            }
        }
    }, 50);
};

// Skrytí technických záložek (Termo, volitelně Grafy) v uživatelském režimu (#67).
// Nemaže z DOM — pouze přepíná třídu .nav-hidden-user.
App.applyModeNav = function() {
    const navItems = document.querySelectorAll('.bottom-nav .nav-item');
    navItems.forEach(item => {
        const oc = item.getAttribute('onclick') || '';
        // V uživatelském režimu skryj "Termo" (a "Grafy")
        const isTechnical = oc.includes("'thermo'") || oc.includes("'charts'");
        if (isTechnical) {
            item.classList.toggle('nav-hidden-user', currentAppMode === 'user');
        }
    });
};

App.updateSimulators = function() {
    const thermo = window.thermoMetricsGlobal;
    if (!thermo) return;
    const tempSlider = document.getElementById('simTempSlider');
    const insulSlider = document.getElementById('simInsulSlider');
    if (!tempSlider || !insulSlider) return;

    const targetTemp = parseFloat(tempSlider.value);
    const insulPerc = parseFloat(insulSlider.value);

    const tempDisplay = document.getElementById('simTempDisplay');
    if (tempDisplay) tempDisplay.innerText = targetTemp.toFixed(1) + ' °C';
    
    const insulDisplay = document.getElementById('simInsulDisplay');
    if (insulDisplay) insulDisplay.innerText = insulPerc === 0 ? '0 % (Stávající)' : insulPerc + ' %';

    let houseK = thermo.houseK.all;
    let origLoss = houseK * (CONFIG.targetIndoorTemp - CONFIG.designTemp);
    let gainW = thermo.gains.zima;

    let newLoss_temp = houseK * (targetTemp - CONFIG.designTemp);
    let fin = window.financeMetricsGlobal;
    
    if (fin && fin.total) {
        let userPriceEl = document.getElementById('userPriceSlider');
        let userPrice = userPriceEl ? parseFloat(userPriceEl.value) : CONFIG.priceKwh;
        let origHeatCost = (fin.total.yearlyHeatWhEl / 1000) * userPrice;
        let ratio = newLoss_temp / origLoss;
        let saving = origHeatCost - (origHeatCost * ratio);
        
        let resEl = document.getElementById('simTempResult');
        if (resEl) {
            if (saving > 0) {
                resEl.innerText = `Ušetříte ${Math.round(saving).toLocaleString('cs-CZ')} Kč ročně`;
                resEl.style.color = 'var(--success)';
            } else if (saving < 0) {
                resEl.innerText = `Připlatíte si ${Math.round(Math.abs(saving)).toLocaleString('cs-CZ')} Kč ročně`;
                resEl.style.color = 'var(--danger)';
            } else {
                resEl.innerText = 'Beze změny';
                resEl.style.color = 'var(--text-dim)';
            }
        }
    }

    let newK_insul = houseK * (1 - (insulPerc / 100));
    let bivEl = document.getElementById('simInsulResult');
    if (bivEl && window.maxTcCurveGlobal && window.maxTcCurveGlobal.length > 0) {
        let foundBiv = null;
        for (let t = 15; t >= -25; t--) {
            let p_loss = newK_insul * (CONFIG.targetIndoorTemp - t) - gainW;
            let tcObj = window.maxTcCurveGlobal.find(c => c.temp === t);
            if (tcObj && p_loss > tcObj.maxTc) {
                foundBiv = t;
                break;
            }
        }
        if (foundBiv !== null) {
            bivEl.innerText = `Posun na ${foundBiv} °C`;
        } else {
            bivEl.innerText = `Pod -25 °C (Zcela soběstačné)`;
        }
    }

    let saveEl = document.getElementById('simInsulSaving');
    if (saveEl && fin && fin.total) {
        let userPriceEl = document.getElementById('userPriceSlider');
        let userPrice = userPriceEl ? parseFloat(userPriceEl.value) : CONFIG.priceKwh;
        let origHeatCost = (fin.total.yearlyHeatWhEl / 1000) * userPrice;
        let newHeatCost = origHeatCost * (1 - (insulPerc / 100));
        saveEl.innerText = `Úspora: ${Math.round(origHeatCost - newHeatCost).toLocaleString('cs-CZ')} Kč / rok`;
    }

    // Porovnání "Současný stav → Po úpravě" pro každý simulátor (#91/#92).
    // Předáme již spočítané hodnoty, abychom neměnili existující výsledkové texty.
    try {
        let userPrice2 = CONFIG.priceKwh;
        const pEl2 = document.getElementById('userPriceSlider');
        if (pEl2) userPrice2 = parseFloat(pEl2.value);
        const origHeatCost2 = (fin && fin.total && Number.isFinite(fin.total.yearlyHeatWhEl))
            ? (fin.total.yearlyHeatWhEl / 1000) * userPrice2 : null;

        App.renderSimBeforeAfter({
            origIndoor:    CONFIG.targetIndoorTemp,
            targetTemp:    targetTemp,
            insulPerc:     insulPerc,
            origHeatCost:  origHeatCost2,
            // poměr ztrát při změně cílové teploty (origLoss>0 garantuje smysl)
            tempRatio:     origLoss > 0 ? (newLoss_temp / origLoss) : null
        });
    } catch (e) {}
};

// ─── Porovnání před/po pro simulátory (#91/#92) ─────────────────────────────
// Aditivně doplní pod každý simulátor řádek "Současný stav → Po úpravě" z již
// spočítaných hodnot. Řádky vytváří idempotentně (id sim*BeforeAfter) a nemění
// existující výsledkové texty.
App.renderSimBeforeAfter = function(d) {
    if (!d) return;
    const fmtC = (typeof formatCurrency === 'function') ? formatCurrency : (n) => Math.round(n) + ' Kč';

    // Pomocník: idempotentně vytvoří/aktualizuje řádek hned za daným resultEl
    const ensureRow = (anchorId, rowId) => {
        const anchor = document.getElementById(anchorId);
        if (!anchor) return null;
        let row = document.getElementById(rowId);
        if (!row) {
            row = document.createElement('div');
            row.id = rowId;
            row.className = 'sim-before-after';
            // Vlož pod kontejner výsledku (rodič anchoru), aby řádek nerušil text
            const host = anchor.parentElement || anchor;
            host.appendChild(row);
        }
        return row;
    };

    // 1) Cílová teplota: roční náklad před → po
    const rowTemp = ensureRow('simTempResult', 'simTempBeforeAfter');
    if (rowTemp) {
        if (d.origHeatCost !== null && Number.isFinite(d.origHeatCost) && d.tempRatio !== null && Number.isFinite(d.tempRatio)) {
            const after = d.origHeatCost * d.tempRatio;
            rowTemp.innerHTML =
                `<span class="sba-lbl">Topení nyní:</span> <b>${fmtC(d.origHeatCost)}</b>` +
                ` <span class="sba-arrow">→</span> ` +
                `<span class="sba-lbl">po úpravě:</span> <b>${fmtC(after)}</b>`;
        } else {
            rowTemp.innerHTML = `<span class="sba-lbl">Současně ${formatNum1(d.origIndoor)} °C → cíl ${formatNum1(d.targetTemp)} °C</span>`;
        }
    }

    // 2) Zateplení: roční náklad na topení před → po
    const rowInsul = ensureRow('simInsulSaving', 'simInsulBeforeAfter');
    if (rowInsul) {
        if (d.origHeatCost !== null && Number.isFinite(d.origHeatCost)) {
            const after = d.origHeatCost * (1 - (d.insulPerc / 100));
            rowInsul.innerHTML =
                `<span class="sba-lbl">Topení nyní:</span> <b>${fmtC(d.origHeatCost)}</b>` +
                ` <span class="sba-arrow">→</span> ` +
                `<span class="sba-lbl">po zateplení:</span> <b>${fmtC(after)}</b>`;
        } else {
            rowInsul.innerHTML = `<span class="sba-lbl">Současný stav → zateplení ${Math.round(d.insulPerc)} %</span>`;
        }
    }

    // Pomocná lokální formátovačka pro 1 desetinné místo (cs-CZ)
    function formatNum1(v) {
        if (typeof formatNumber === 'function') return formatNumber(v, 1);
        return Number.isFinite(v) ? v.toFixed(1).replace('.', ',') : '-';
    }
};

// ─── Předvolby simulátorů (#91/#92) ─────────────────────────────────────────
// Nastaví příslušný slider a spustí jeho existující handler přes dispatch
// input eventu (žádná duplicitní logika výpočtu).
App.applySimPreset = function(name) {
    const fire = (el) => { if (el) el.dispatchEvent(new Event('input', { bubbles: true })); };
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

    if (name === 'fasada') {
        const s = document.getElementById('simInsulSlider');
        if (s) {
            const min = parseFloat(s.min) || 0, max = parseFloat(s.max) || 60;
            s.value = clamp(30, min, max);
            fire(s);
        }
    } else if (name === 'okna') {
        const s = document.getElementById('simInsulSlider');
        if (s) {
            const min = parseFloat(s.min) || 0, max = parseFloat(s.max) || 60;
            s.value = clamp(15, min, max);
            fire(s);
        }
    } else if (name === 'sazba') {
        const s = document.getElementById('userPriceSlider');
        if (s) {
            const min = parseFloat(s.min) || 2, max = parseFloat(s.max) || 10;
            const cur = parseFloat(s.value);
            if (Number.isFinite(cur)) {
                s.value = clamp(cur * 0.9, min, max).toFixed(2);
                fire(s);
            }
        }
    }
};

// Idempotentní vytvoření řádku předvoleb v záložce Simulace (#91/#92).
App.ensureSimPresetRow = function() {
    if (document.getElementById('simPresetRow')) return;
    // Umísti řádek za úvodní popisek laboratoře, nad první simulátor.
    const tab = document.getElementById('tab-simulators');
    if (!tab) return;
    const firstInner = tab.querySelector('.card-inner');
    if (!firstInner || !firstInner.parentElement) return;

    const row = document.createElement('div');
    row.id = 'simPresetRow';
    row.className = 'sim-preset-row';

    const presets = [
        { name: 'fasada', label: '🧱 Zateplit fasádu' },
        { name: 'okna',   label: '🪟 Vyměnit okna' },
        { name: 'sazba',  label: '💸 Nová sazba –10 %' }
    ];
    presets.forEach(p => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sim-preset-btn';
        b.innerText = p.label;
        b.setAttribute('aria-label', 'Předvolba: ' + p.label);
        b.onclick = () => { try { App.applySimPreset(p.name); } catch (e) {} };
        row.appendChild(b);
    });

    firstInner.parentElement.insertBefore(row, firstInner);
};

App.generateInsights = function() {
    const box = document.getElementById('userInsightsBox');
    if (!box) return;

    if (window.currentNoobScore && window.currentNoobScore.story) {
        box.innerHTML = `<div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; border-left: 4px solid var(--accent); font-size: 0.8rem;">${window.currentNoobScore.story}</div>`;
        // Akční výzva (#83–84): odkaz do simulátorů úspor — jen pokud máme obsah
        const cta = document.createElement('button');
        cta.className = 'insights-cta';
        cta.type = 'button';
        cta.innerText = 'Vyzkoušet úspory →';
        cta.setAttribute('aria-label', 'Přejít do simulátorů úspor');
        cta.onclick = () => { try { App.switchTab('simulators'); } catch (e) {} };
        box.appendChild(cta);
    } else {
        box.innerHTML = `<i>Čekám na data pro vygenerování postřehů...</i>`;
    }

    // "Co dělat teď" — max 3 prioritní akce pod příběhem (#83/#85/#86)
    try { App.buildActionItems(); } catch (e) {}
};

// ─── "Co dělat teď" — max 3 akce (#83/#85/#86) ──────────────────────────────
// Přidá pod userInsightsBox malý prioritizovaný seznam akcí. Priority vybírá
// jako až 3 nejnižší ze čtyř dílčích skóre. Každá položka: emoji + krátká věta
// + tlačítko "Vyzkoušet →" do simulátorů. Idempotentní — předchozí seznam vždy
// nejdřív odstraní.
App.buildActionItems = function() {
    const box = document.getElementById('userInsightsBox');
    if (!box) return;

    // Odstraň předchozí seznam akcí (idempotence)
    const prev = box.querySelector('.action-items');
    if (prev) prev.remove();

    const sc = window.currentNoobScore;
    if (!sc) return;

    // Definice čtyř oblastí — skóre + věta + emoji. Kč/°C číslo přidáme jen
    // pokud je bezpečně k dispozici z již spočítaných hodnot (jinak kvalitativně).
    const fmtC = (typeof formatCurrency === 'function') ? formatCurrency : (n) => Math.round(n) + ' Kč';

    // Bezpečně dostupná roční úspora ze zateplení (z financeMetrics) — pouze
    // pokud máme platná data; jinak zůstane null a věta bude kvalitativní.
    let insulSaveText = null;
    try {
        const fin = window.financeMetricsGlobal;
        if (fin && fin.total && Number.isFinite(fin.total.yearlyHeatWhEl)) {
            const priceEl = document.getElementById('userPriceSlider');
            const price = priceEl ? parseFloat(priceEl.value) : CONFIG.priceKwh;
            const origHeatCost = (fin.total.yearlyHeatWhEl / 1000) * price;
            // Orientační dopad 20% zateplení
            const est = origHeatCost * 0.20;
            if (Number.isFinite(est) && est > 0) insulSaveText = ` (orientačně až ${fmtC(est)} / rok)`;
        }
    } catch (e) {}

    const areas = [
        { key: 'econ',   val: sc.efficiency, emoji: '⚡', text: 'Účinnost má rezervu — zkuste mírně snížit teplotu topné vody (LWT) a sledujte, jak COP poskočí.' },
        { key: 'health', val: sc.health,     emoji: '🛡️', text: 'Zdraví kompresoru lze zlepšit — omezte zbytečné starty větší hysterezí nebo akumulační nádobou.' },
        { key: 'smooth', val: sc.smoothness, emoji: '〰️', text: 'Plynulost chodu má prostor — delší a klidnější cykly šetří energii i kompresor.' },
        { key: 'load',   val: sc.load,       emoji: '🏠', text: 'Izolace domu je slabší článek — i částečné zateplení znatelně sníží tepelné ztráty' + (insulSaveText || '.') }
    ];

    // Vyber až 3 nejnižší (priority) — pouze platná číselná skóre
    const sorted = areas
        .filter(a => Number.isFinite(a.val))
        .sort((a, b) => a.val - b.val)
        .slice(0, 3);

    if (sorted.length === 0) return;

    const wrap = document.createElement('div');
    wrap.className = 'action-items';

    const head = document.createElement('div');
    head.className = 'action-items-head';
    head.innerText = '🎯 Co dělat teď';
    wrap.appendChild(head);

    sorted.forEach(a => {
        const row = document.createElement('div');
        row.className = 'action-item';

        const txt = document.createElement('span');
        txt.className = 'action-item-text';
        txt.innerHTML = `<span class="action-item-emoji">${a.emoji}</span>${a.text}`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'action-item-btn';
        btn.innerText = 'Vyzkoušet →';
        btn.setAttribute('aria-label', 'Přejít do simulátorů úspor');
        btn.onclick = () => { try { App.switchTab('simulators'); } catch (e) {} };

        row.appendChild(txt);
        row.appendChild(btn);
        wrap.appendChild(row);
    });

    box.appendChild(wrap);
};

// Krátká česká vysvětlení jednotlivých skóre koleček (tap-to-explain #74–76)
App.scoreExplains = {
    userScoreEcon:   'Účinnost: jak hospodárně TČ vyrábí teplo (poměr tepla k odebrané elektřině). Vyšší = levnější provoz.',
    userScoreHealth: 'Zdraví: jak šetrně kompresor pracuje — málo zbytečných startů a defrostů znamená delší životnost.',
    userScoreSmooth: 'Plynulost: jak dlouhé a klidné jsou topné cykly. Plynulý chod chrání kompresor a šetří energii.',
    userScoreLoad:   'Izolace: jak dobře dům drží teplo. Lepší obálka budovy znamená menší tepelné ztráty a nižší účet.'
};

App.updateNoobScores = function() {
    let sc = window.currentNoobScore;
    if (!sc) return;

    // Volitelný předchozí snímek skóre (#77) — worker jej MŮŽE přiložit.
    // Hledáme jej na několika defenzivně zvolených místech; pokud chybí,
    // trendové šipky se nevykreslí (plně volitelné).
    const prevSnap = (sc && sc.prev) || (sc && sc.scoresPrev) || window.noobScorePrev || null;

    let circleEcon = document.getElementById('userScoreEcon');
    let circleHealth = document.getElementById('userScoreHealth');
    let circleSmooth = document.getElementById('userScoreSmooth');
    let circleLoad  = document.getElementById('userScoreLoad');

    // Jednoslovný verdikt pod kolečkem podle hodnoty
    const verdictFor = (val) => {
        if (val >= 80) return { txt: 'Výborné', col: 'var(--success)' };
        if (val >= 50) return { txt: 'Dobré',   col: 'var(--warning)' };
        return { txt: 'Pozor', col: 'var(--danger)' };
    };

    const applyColor = (el, val, prevVal) => {
        if (!el) return;
        let col = 'var(--danger)';
        if (val >= 80) col = 'var(--success)';
        else if (val >= 55) col = 'var(--accent)';
        else if (val >= 35) col = 'var(--warning)';

        el.innerText = Math.round(val) + '%';
        el.style.borderColor = col;
        el.style.color = col;
        el.style.boxShadow = `inset 0 0 15px ${col}80`;

        // Verdikt + tap-to-explain: kolečko je klikací a má pod sebou slovní verdikt
        const v = verdictFor(val);
        const parent = el.parentElement;
        if (parent) {
            let vEl = parent.querySelector('.score-verdict');
            if (!vEl) {
                vEl = document.createElement('div');
                vEl.className = 'score-verdict';
                // Vlož verdikt hned za kolečko (před stávající popisek .score-lbl)
                if (el.nextSibling) parent.insertBefore(vEl, el.nextSibling);
                else parent.appendChild(vEl);
            }
            vEl.innerText = v.txt;
            vEl.style.color = v.col;

            // Trend skóre (#77) — vykresli šipku vedle verdiktu, pokud je
            // k dispozici předchozí hodnota. Plně volitelné a idempotentní.
            try { App.renderScoreTrend(vEl, val, prevVal); } catch (e) {}
        }

        // Tap-to-explain pouze jednou (idempotentní)
        if (!el.dataset.explainBound) {
            el.dataset.explainBound = '1';
            el.classList.add('score-clickable');
            el.style.cursor = 'pointer';
            el.setAttribute('role', 'button');
            el.setAttribute('tabindex', '0');
            el.addEventListener('click', () => {
                const msg = App.scoreExplains[el.id];
                if (msg && typeof App.showError === 'function') App.showError(msg);
            });
        }
    };

    // Pomocník pro bezpečné čtení předchozí hodnoty daného ukazatele
    const prevOf = (key) => (prevSnap && Number.isFinite(prevSnap[key])) ? prevSnap[key] : undefined;

    applyColor(circleEcon,   sc.efficiency, prevOf('efficiency'));
    applyColor(circleHealth, sc.health,     prevOf('health'));
    applyColor(circleSmooth, sc.smoothness, prevOf('smoothness'));
    applyColor(circleLoad,   sc.load,       prevOf('load'));

    // Celkové souhrnné skóre nad mřížkou 4 koleček (#78)
    try {
        App.renderOverallScore({
            econ:     sc.efficiency,
            health:   sc.health,
            smooth:   sc.smoothness,
            load:     sc.load
        });
    } catch (e) {}
};

// ─── Celkové souhrnné skóre (#78) ───────────────────────────────────────────
// Spočítá prostý průměr (0–100) ze čtyř dílčích skóre a vykreslí JEDEN souhrnný
// odznak s emoji a barvou nad mřížku 4 koleček v .user-hero-card.
// Element vytváří idempotentně (id userScoreOverall) — při dalším volání jen
// aktualizuje obsah.
App.renderOverallScore = function(scores) {
    if (!scores) return;
    const card = document.querySelector('.user-hero-card');
    if (!card) return;

    // Sesbírej jen platná číselná skóre a spočítej prostý průměr
    const vals = [scores.econ, scores.health, scores.smooth, scores.load]
        .filter(v => Number.isFinite(v));
    if (vals.length === 0) return;
    const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

    // Emoji + barva podle pásem (≥80 😀 / ≥50 🙂 / jinak 😟)
    let emoji, col, verdict;
    if (avg >= 80)      { emoji = '😀'; col = 'var(--success)'; verdict = 'Výborný chod'; }
    else if (avg >= 50) { emoji = '🙂'; col = 'var(--warning)'; verdict = 'Solidní chod'; }
    else                { emoji = '😟'; col = 'var(--danger)';  verdict = 'Vyžaduje pozornost'; }

    let badge = document.getElementById('userScoreOverall');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'userScoreOverall';
        badge.className = 'user-score-overall';
        // Vlož nad mřížku 4 koleček: za nadpisový popisek (první dítě karty),
        // nebo na začátek karty, pokud popisek chybí.
        const titleEl = card.firstElementChild;
        if (titleEl && titleEl.nextSibling) card.insertBefore(badge, titleEl.nextSibling);
        else card.appendChild(badge);
    }

    badge.style.color = col;
    badge.style.borderColor = col;
    badge.innerHTML =
        `<span class="uso-emoji">${emoji}</span>` +
        `<span class="uso-val">${avg}%</span>` +
        `<span class="uso-verdict">${verdict}</span>`;
};

// ─── Trend skóre (#77) ──────────────────────────────────────────────────────
// Vykreslí malou šipku za verdikt kolečka podle porovnání aktuální a
// předchozí hodnoty: ↑ zelená (zlepšení), ↓ červená (zhoršení), → šedá
// (beze změny). Pokud předchozí hodnota chybí, případnou starou šipku
// odstraní a nic nevykreslí. Idempotentní.
App.renderScoreTrend = function(verdictEl, curr, prev) {
    if (!verdictEl) return;

    // Najdi/odstraň existující šipku (idempotence)
    let arrow = verdictEl.querySelector('.score-trend');

    if (!Number.isFinite(curr) || !Number.isFinite(prev)) {
        if (arrow) arrow.remove();
        return;
    }

    const diff = curr - prev;
    let glyph, col, title;
    const EPS = 0.5; // práh, pod kterým považujeme za beze změny
    if (diff > EPS)      { glyph = '↑'; col = 'var(--success)'; title = 'Zlepšení'; }
    else if (diff < -EPS){ glyph = '↓'; col = 'var(--danger)';  title = 'Zhoršení'; }
    else                 { glyph = '→'; col = 'var(--text-dim)'; title = 'Beze změny'; }

    if (!arrow) {
        arrow = document.createElement('span');
        arrow.className = 'score-trend';
        verdictEl.appendChild(arrow);
    }
    arrow.textContent = glyph;
    arrow.style.color = col;
    arrow.setAttribute('title', title + ' (' + (diff >= 0 ? '+' : '') + Math.round(diff) + ' b)');
};

// ─── Drag & drop import (#65) ───────────────────────────────────────────────
// Připojí na document.body posluchače dragover/drop/dragleave, potlačí výchozí
// chování prohlížeče a upuštěné soubory předá stávající cestě nahrávání
// (App.handleFileUpload, která čte objekt s vlastností .files). Zobrazí
// jemný celostránkový overlay "Pusťte soubor sem". Vše idempotentní a
// defenzivní — připojí se jen jednou.
App.initDropZone = function() {
    if (App._dropZoneBound) return;
    App._dropZoneBound = true;

    // Idempotentní vytvoření overlay elementu
    const ensureOverlay = () => {
        let ov = document.getElementById('dropZoneOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'dropZoneOverlay';
            ov.innerHTML =
                `<div class="dz-inner"><span class="dz-ico">📂</span>Pusťte soubor sem</div>`;
            document.body.appendChild(ov);
        }
        return ov;
    };

    const showOverlay = () => {
        const ov = ensureOverlay();
        ov.classList.add('visible');
    };
    const hideOverlay = () => {
        const ov = document.getElementById('dropZoneOverlay');
        if (ov) ov.classList.remove('visible');
    };

    // Počítadlo dragenter/dragleave, aby overlay neproblikával nad dětmi
    let dragDepth = 0;

    const hasFiles = (e) => {
        try {
            const dt = e.dataTransfer;
            if (!dt) return false;
            if (dt.types && Array.prototype.indexOf.call(dt.types, 'Files') !== -1) return true;
            return !!(dt.files && dt.files.length);
        } catch (err) { return false; }
    };

    document.body.addEventListener('dragenter', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth++;
        showOverlay();
    });

    document.body.addEventListener('dragover', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
        showOverlay();
    });

    document.body.addEventListener('dragleave', (e) => {
        if (!hasFiles(e)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) hideOverlay();
    });

    document.body.addEventListener('drop', (e) => {
        // Vždy potlač výchozí (otevření souboru v prohlížeči)
        e.preventDefault();
        dragDepth = 0;
        hideOverlay();

        let files = null;
        try { files = e.dataTransfer ? e.dataTransfer.files : null; } catch (err) {}
        if (!files || files.length === 0) return;

        // Předej stávající cestě nahrávání — handler čte objekt s .files
        if (window.App && typeof App.handleFileUpload === 'function') {
            try { App.handleFileUpload({ files: files }); } catch (err) {
                console.error('initDropZone: handleFileUpload selhal', err);
            }
        }
    });
};

App.updateLifespan = function() {
    const lifeLimit = CONFIG.system.lifeStarts || 80000;

    let totalStarts = 0;
    let totalMotorHours = 0;
    let totalDays = 0;

    if (typeof dailyStatsGlobal !== 'undefined' && dailyStatsGlobal.length > 0) {
        dailyStatsGlobal.forEach(d => {
            totalStarts     += (d.rawStarts || d.netStarts || 0) + (d.defrostRuns || 0) + (d.tuvRuns || 0);
            totalMotorHours += (d.runTimeHours || 0);
            totalDays++;
        });
    } else {
        // Data ještě nejsou — zobraz prázdné proužky se stavem
        const aEl = document.getElementById('userLifespanAnalysis');
        if (aEl) aEl.innerHTML = '<span style="color:var(--text-dim);">Načítám data…</span>';
        return;
    }

    const startsPerc = Math.min(100, (totalStarts     / lifeLimit) * 100);
    const motoPerc   = Math.min(100, (totalMotorHours / lifeLimit) * 100);
    const colorFor   = (p) => p > 80 ? 'var(--danger)' : p > 50 ? 'var(--warning)' : 'var(--success)';

    // ─── Proužek startů ───────────────────────────────────────
    const startsEl = document.getElementById('userStartsTotal');
    const barEl    = document.getElementById('userLifespanBar');
    if (startsEl) startsEl.innerText = totalStarts.toLocaleString('cs-CZ') + ' cyklů';
    if (barEl)   { barEl.style.width = startsPerc.toFixed(1) + '%'; barEl.style.background = colorFor(startsPerc); }

    // ─── Proužek motohodin ────────────────────────────────────
    const motoEl  = document.getElementById('userMotoTotal');
    const motoBar = document.getElementById('userMotoBar');
    if (motoEl)  motoEl.innerText = Math.round(totalMotorHours).toLocaleString('cs-CZ') + ' h';
    if (motoBar) { motoBar.style.width = motoPerc.toFixed(1) + '%'; motoBar.style.background = colorFor(motoPerc); }

    // Analýza poměru motohodiny/starty + chytré doporučení
    const analysisEl = document.getElementById('userLifespanAnalysis');
    if (analysisEl && totalStarts > 0) {
        const ratio      = totalMotorHours / totalStarts;
        const avgMin     = Math.round(ratio * 60);
        const fmtMin     = (m) => m >= 60 ? `${Math.floor(m/60)} h ${m%60} min` : `${m} min`;
        const startsMore = totalStarts > totalMotorHours;
        const diffPct    = Math.abs(Math.round((ratio - 1) * 100));

        let ico, qual, hlavni, detail;

        if (ratio >= 2.0) {
            ico = '⭐'; qual = 'Výborné';
            hlavni = `Průměrný cyklus ${fmtMin(avgMin)} — TČ jede v ideálně dlouhých sekvencích.`;
            detail = `Motohodiny jsou ${ratio.toFixed(1)}× vyšší než počet startů. Kompresor je minimálně namáhán, životnost maximální.`;
        } else if (ratio >= 1.5) {
            ico = '✅'; qual = 'Velmi dobré';
            hlavni = `Průměrný cyklus ${fmtMin(avgMin)} — solidní dlouhé cykly.`;
            detail = `Motohodiny převyšují starty o ${diffPct} %. Systém pracuje efektivně.`;
        } else if (ratio >= 1.2) {
            ico = '🟢'; qual = 'Dobré';
            hlavni = `Průměrný cyklus ${fmtMin(avgMin)} — cykly jsou v pořádku.`;
            detail = `Motohodiny převyšují starty o ${diffPct} %. Prostor pro zlepšení: zkus mírně zvýšit hysterezi termostatu nebo prodloužit dobu akumulace.`;
        } else if (ratio >= 0.95) {
            ico = '🟡'; qual = 'Prostor ke zlepšení';
            hlavni = `Průměrný cyklus jen ${fmtMin(avgMin)} — cykly jsou kratší než optimum.`;
            detail = `Motohodiny a starty jsou skoro vyrovnané (rozdíl ${diffPct} %). Doporučení: nastav větší teplotní hysterezi, zkontroluj zásobník nebo hydrauliku.`;
        } else {
            ico = '🔴'; qual = 'Nevhodný provoz';
            const overPct = Math.round((totalStarts / totalMotorHours - 1) * 100);
            hlavni = `Průměrný cyklus jen ${fmtMin(avgMin)} — TČ startuje příliš často!`;
            detail = `Starty převyšují motohodiny o ${overPct} %. Nutná kontrola: malý zásobník, špatná hydraulika nebo příliš citlivý termostat výrazně zkracují životnost.`;
        }

        // Srozumitelný verdikt jednou větou (#98–99)
        let verdict, vCol;
        if (ratio >= 1.2)        { verdict = '✔️ TČ je v kondici'; vCol = 'var(--success)'; }
        else if (ratio >= 0.95)  { verdict = '⚠️ Sledujte cyklování'; vCol = 'var(--warning)'; }
        else                     { verdict = '❗ Kompresor se opotřebovává rychleji'; vCol = 'var(--danger)'; }

        analysisEl.innerHTML =
            `<div class="wear-verdict" style="color:${vCol};">${verdict}</div>` +
            `<span style="font-weight:800; color:${ratio >= 1.2 ? 'var(--success)' : ratio >= 0.95 ? 'var(--warning)' : 'var(--danger)'};">${ico} ${qual}</span>` +
            ` — ${hlavni}<br><span style="color:var(--text-dim);">${detail}</span>`;
    } else if (analysisEl) {
        analysisEl.innerHTML = '–';
    }

    // Odhad zbývající životnosti (horší z obou ukazatelů)
    const estEl = document.getElementById('userLifespanEst');
    if (estEl) {
        if (totalDays > 30 && totalStarts > 0) {
            const sPerY  = (totalStarts     / totalDays) * 365;
            const mPerY  = (totalMotorHours / totalDays) * 365;
            const yrByS  = (lifeLimit - totalStarts)     / sPerY;
            const yrByM  = (lifeLimit - totalMotorHours) / mPerY;
            const left   = Math.min(yrByS, yrByM);
            estEl.innerText = `Odhad životnosti: ${Math.max(0, Math.round(left))} let`;
        } else {
            estEl.innerText = 'Odhad: málo dat';
        }
    }

    // Servisní připomínka kompresoru (#100/#102) — vykreslí se idempotentně
    // pod analýzu opotřebení. Předáme i poměr motohodin/startů pro odvození
    // varovného doplňku, pokud TČ není v kondici.
    try {
        const ratioForReminder = totalStarts > 0 ? (totalMotorHours / totalStarts) : null;
        App.buildServiceReminder(ratioForReminder);
    } catch (e) {}
};

// ─── Servisní připomínka kompresoru (#100/#102) ─────────────────────────────
// Doplní pod analýzu životnosti (#userLifespanAnalysis) řádek s doporučeným
// rokem příští servisní prohlídky. Vychází z CONFIG.estimations.installYear
// (pokud je > 2000). Interval volíme 2 roky (běžné doporučení pro kompresorové
// TČ). Pokud je doporučený rok již v minulosti, posuneme jej cyklicky do
// budoucna od aktuálního roku. Při zhoršeném opotřebení (ratio < 1.2) přidá
// poznámku o hlídání tlaků a napětí sítě. Element vytváří idempotentně
// (id userServiceReminder). Degraduje elegantně při chybějících datech.
App.buildServiceReminder = function(wearRatio) {
    // Najdeme kotvu — kontejner analýzy životnosti
    const anchor = document.getElementById('userLifespanAnalysis');
    if (!anchor || !anchor.parentElement) return;

    // Idempotentní element hned za analýzou
    let el = document.getElementById('userServiceReminder');
    if (!el) {
        el = document.createElement('div');
        el.id = 'userServiceReminder';
        el.className = 'service-reminder';
        if (anchor.nextSibling) anchor.parentElement.insertBefore(el, anchor.nextSibling);
        else anchor.parentElement.appendChild(el);
    }

    // Bezpečné čtení roku instalace
    const cfgEst = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.estimations) ? CONFIG.estimations : null;
    const installYear = cfgEst && Number.isFinite(cfgEst.installYear) ? cfgEst.installYear : 0;

    const SERVICE_INTERVAL = 2; // doporučený interval servisu v letech
    const nowYear = new Date().getFullYear();

    let html = '';

    if (installYear && installYear > 2000) {
        // Spočítej příští doporučený servis: od roku instalace v krocích po
        // SERVICE_INTERVAL, aby výsledek byl >= aktuální rok.
        let nextService = installYear + SERVICE_INTERVAL;
        if (nextService < nowYear) {
            const stepsBehind = Math.ceil((nowYear - nextService) / SERVICE_INTERVAL);
            nextService += stepsBehind * SERVICE_INTERVAL;
        }
        // Pokud vyšlo přesně na letošní rok, je servis aktuální letos.
        const age = Math.max(0, nowYear - installYear);
        html = `🔧 Příští doporučený servis: <b>${nextService}</b>` +
               ` <span style="color:var(--text-dim);">(instalace ${installYear}, stáří ${age} let, interval ${SERVICE_INTERVAL} roky)</span>`;
    } else {
        // Bez roku instalace alespoň obecná pobídka k zadání
        html = `🔧 Servisní připomínku zapnete zadáním <b>roku instalace TČ</b> v nastavení.`;
    }

    // Varovný doplněk při zhoršeném opotřebení (ratio < 1.2 = mimo kondici)
    if (Number.isFinite(wearRatio) && wearRatio < 1.2) {
        html += `<br><span class="sr-warn">⚠️ Hlídejte tlaky chladiva a napětí sítě</span>` +
                ` <span style="color:var(--text-dim);">— zvýšené cyklování zatěžuje kompresor.</span>`;
    }

    el.innerHTML = html;
};

// ─── 8b. UX VYLEPŠENÍ: STYLY, PŘÍSTUPNOST, PAMĚŤ REŽIMU ─────────────────────

// Jednorázová injektáž CSS tříd, které UI logika používá (kolečka, verdikty,
// akční výzva v postřezích a skrytí technických záložek v uživatelském režimu).
// CSS lze přidat jen za běhu, proto vytvoříme <style> a vložíme do <head>.
App.injectUxStyles = function() {
    if (document.getElementById('uxStylesInjected')) return;
    const style = document.createElement('style');
    style.id = 'uxStylesInjected';
    style.textContent = `
        /* Skrytí technické záložky (Termo/Grafy) v uživatelském režimu (#67) */
        .bottom-nav .nav-item.nav-hidden-user { display: none !important; }

        /* Slovní verdikt pod skóre kolečkem (#74–76) */
        .score-verdict {
            font-size: 0.62rem;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            margin-top: 3px;
            text-align: center;
        }
        /* Klikací kolečko skóre (tap-to-explain #74–76) */
        .score-clickable { transition: transform 0.15s ease; }
        .score-clickable:hover { transform: scale(1.04); }
        .score-clickable:active { transform: scale(0.96); }
        .score-clickable:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

        /* Akční výzva v boxu postřehů — odkaz do simulátorů úspor (#83–84) */
        .insights-cta {
            display: inline-block;
            margin-top: 10px;
            padding: 8px 16px;
            border: none;
            border-radius: 999px;
            background: var(--accent);
            color: #0c0f17;
            font-size: 0.78rem;
            font-weight: 800;
            cursor: pointer;
            transition: filter 0.2s ease, transform 0.15s ease;
        }
        .insights-cta:hover { filter: brightness(1.1); }
        .insights-cta:active { transform: scale(0.97); }
        .insights-cta:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

        /* Srozumitelný verdikt opotřebení kompresoru (#98–99) */
        .wear-verdict {
            font-size: 0.85rem;
            font-weight: 800;
            margin-bottom: 5px;
        }

        /* Servisní připomínka kompresoru (#100/#102) */
        .service-reminder {
            margin-top: 8px;
            font-size: 0.72rem;
            line-height: 1.45;
            color: var(--text-dim);
            border-top: 1px dashed rgba(255,255,255,0.08);
            padding-top: 7px;
        }
        .service-reminder b { color: var(--accent); }
        .service-reminder .sr-warn { color: var(--warning); font-weight: 700; }

        /* Trend skóre (#77) — šipka vedle verdiktu kolečka */
        .score-trend {
            margin-left: 4px;
            font-size: 0.7rem;
            font-weight: 900;
            line-height: 1;
        }

        /* Drag & drop import overlay (#65) */
        #dropZoneOverlay {
            position: fixed;
            inset: 0;
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(12, 15, 23, 0.78);
            backdrop-filter: blur(3px);
            -webkit-backdrop-filter: blur(3px);
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.15s ease;
        }
        #dropZoneOverlay.visible { opacity: 1; }
        #dropZoneOverlay .dz-inner {
            border: 3px dashed var(--accent);
            border-radius: 18px;
            padding: 40px 60px;
            text-align: center;
            color: var(--text-main);
            font-size: 1.2rem;
            font-weight: 800;
            background: rgba(20, 26, 38, 0.6);
            box-shadow: 0 0 40px rgba(90, 184, 255, 0.25);
        }
        #dropZoneOverlay .dz-inner .dz-ico { font-size: 2.4rem; display: block; margin-bottom: 10px; }
    `;
    document.head.appendChild(style);
};

// Obnovení zapamatovaného režimu z localStorage při startu (#69) a srozumitelný
// popisek přepínače "Jednoduchý / Expertní" (#68).
App.restoreAppMode = function() {
    let saved = null;
    try { saved = localStorage.getItem('tcAppMode'); } catch (e) {}
    if (saved === 'user' || saved === 'analyst') {
        currentAppMode = saved;
    }
    document.body.className = 'mode-' + currentAppMode;

    // Synchronizace přepínače: zaškrtnuto = uživatelský (jednoduchý) režim
    const cb = document.getElementById('mainModeToggle');
    if (cb) cb.checked = (currentAppMode === 'user');

    // Jasný popisek přepínače (#68) — pokud existuje sousední text, přepíšeme jej
    const toggleLabel = cb ? cb.closest('label') : null;
    const labelText = toggleLabel && toggleLabel.previousElementSibling
        ? toggleLabel.previousElementSibling
        : null;
    if (labelText) labelText.innerText = 'Jednoduchý / Expertní:';
    const switchEl = cb ? cb.closest('.switch') : null;
    if (switchEl) switchEl.setAttribute('title', 'Přepnout režim: Jednoduchý / Expertní');

    App.applyModeNav();
};

// Přístupnost: aria-labely na tlačítka jen s emoji + nav položky (#132).
App.initAriaLabels = function() {
    const setAria = (id, label) => {
        const el = document.getElementById(id);
        if (el && !el.getAttribute('aria-label')) el.setAttribute('aria-label', label);
    };
    setAria('floatingExport', 'Export dat');
    setAria('floatingSettings', 'Nastavení');

    // Spodní navigace — přečteme český text z položky a doplníme aria-label
    document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
        if (item.getAttribute('aria-label')) return;
        const span = item.querySelector('span');
        const txt = span ? span.innerText.trim() : '';
        if (txt) item.setAttribute('aria-label', 'Záložka ' + txt);
        item.setAttribute('role', 'button');
    });
};

// Escape zavře jakékoliv otevřené modální okno (#133) — používá stávající vzor
// (odebrání třídy .open). Jediný globální listener.
App.initEscModalClose = function() {
    if (App._escBound) return;
    App._escBound = true;
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' && e.key !== 'Esc') return;
        const open = document.querySelectorAll('.modal-overlay.open');
        if (open.length === 0) return;
        open.forEach(m => m.classList.remove('open'));
    });
};

// ─── 9. EVENT LISTENERY A BOOTSTRAP ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // UX vylepšení: styly, přístupnost, paměť režimu (#67–69, #132–133)
    try { App.injectUxStyles(); } catch (e) {}
    try { App.initAriaLabels(); } catch (e) {}
    try { App.initEscModalClose(); } catch (e) {}
    try { App.initDropZone(); } catch (e) {}
    let tSlider = document.getElementById('simTempSlider');
    if(tSlider) tSlider.addEventListener('input', App.updateSimulators);
    
    let iSlider = document.getElementById('simInsulSlider');
    if(iSlider) iSlider.addEventListener('input', App.updateSimulators);
    
    let pSlider = document.getElementById('userPriceSlider');
    if(pSlider) pSlider.addEventListener('input', App.updateUserPrice);

    const scMain = document.getElementById('scrollContainerMain');
    const scVolt = document.getElementById('scrollContainerVolt');

    if (scMain && scVolt) {
        scMain.addEventListener('scroll', () => {
            scVolt.scrollLeft = scMain.scrollLeft;
        });
    }

    document.addEventListener('click', (e) => {
        const tooltipEl = document.getElementById('chartCustomTooltip');
        if (tooltipEl && tooltipEl.classList.contains('visible')) {
            if (!e.target.closest('.chart-box')) {
                tooltipEl.classList.remove('visible');
                if (myChart) { myChart.setActiveElements([]); myChart.update('none'); }
                if (voltChart) { voltChart.setActiveElements([]); voltChart.update('none'); }
            }
        }
    });

    if (typeof App.refreshColors === 'function') App.refreshColors();
    if (typeof App.initializeInputs === 'function') App.initializeInputs();
    if (typeof App.initCharts === 'function') App.initCharts('line');
    if (typeof App.smartNav === 'function') App.smartNav(0);

    // Nastavení režimu aplikace — obnoví zapamatovaný režim (#69), popisek (#68)
    // a skrytí technických záložek (#67).
    try { App.restoreAppMode(); } catch (e) { document.body.className = 'mode-' + currentAppMode; }

    const cb = document.querySelector('.chart-box');
    const holder = document.getElementById('canvasHolderMain');
    let startDist = 0, currentScale = 1.0, isZooming = false, startCenterRatio = 0, pinchPointX = 0;

    if (cb && holder && scMain) {
        cb.addEventListener('touchstart', e => {
            if (['agg_days', 'agg_months', 'agg_cop', 'cost'].includes(currentView)) return;
            if (e.touches.length === 2) {
                isZooming = true; 
                scMain.style.overflowX = 'hidden';
                startDist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                
                const rect = scMain.getBoundingClientRect();
                pinchPointX = ((e.touches[0].pageX + e.touches[1].pageX) / 2) - rect.left;
                const absolutePinchX = scMain.scrollLeft + pinchPointX;
                
                startCenterRatio = absolutePinchX / scMain.scrollWidth;
                holder.style.transformOrigin = `${absolutePinchX}px center`;
                holder.style.transition = 'none';
            }
        }, { passive: false });

        const endZoom = (e) => {
            if (isZooming && e.touches.length < 2) {
                isZooming = false;
                let oldZoom = zoomLevels[currentView] || 1.0;
                let proposedZoom = oldZoom * currentScale;
                let maxZ = 50.0;
                let minZ = 0.02;
                
                if (lastWindowData && lastWindowData.length > 1) {
                    const cW = scMain.clientWidth - 70;
                    const durationSec = lastWindowData[lastWindowData.length - 1].ts - lastWindowData[0].ts;
                    let baseWidthPx;
                    
                    if (currentView === 'line' || currentView === 'thermal') {
                        baseWidthPx = Math.max((durationSec / 60) * (cW / 360), cW);
                    } else {
                        baseWidthPx = Math.max(lastWindowData.length * 8, cW);
                        const maxVisibleSec = 3.5 * 3600; 
                        minZ = (durationSec * cW) / (maxVisibleSec * baseWidthPx);
                    }
                    
                    let minVisibleSec;
                    if (currentView === 'line' || currentView === 'thermal') minVisibleSec = 3 * 3600;
                    else minVisibleSec = 30 * 60;
                    
                    const targetMaxWidthPx = (durationSec / minVisibleSec) * cW;
                    maxZ = Math.max(1, targetMaxWidthPx / baseWidthPx);
                }
                
                let finalZoom = Math.min(Math.max(proposedZoom, minZ), maxZ);
                zoomLevels[currentView] = finalZoom;
                holder.style.transform = 'none'; 
                holder.style.transformOrigin = 'center center'; 
                currentScale = 1.0;
                
                let appliedWidth = App.renderCharts(lastWindowData, lastColors, lastDescriptions, true);
                if (appliedWidth) {
                    void scMain.scrollWidth; 
                    const newAbsolutePinchX = startCenterRatio * appliedWidth;
                    scMain.scrollLeft = newAbsolutePinchX - pinchPointX;
                }
                scMain.style.overflowX = 'auto';
            }
        };

        cb.addEventListener('touchend', endZoom); 
        cb.addEventListener('touchcancel', endZoom);
        cb.addEventListener('touchmove', e => {
            if (['agg_days', 'agg_months', 'agg_cop', 'cost'].includes(currentView)) return;
            if (isZooming && e.touches.length === 2) {
                e.preventDefault(); 
                e.stopPropagation();
                const dist = Math.hypot(e.touches[0].pageX - e.touches[1].pageX, e.touches[0].pageY - e.touches[1].pageY);
                currentScale = dist / startDist;
                holder.style.transform = `scaleX(${currentScale})`;
            }
        }, { passive: false });
    }
});

document.addEventListener('updateStats', (e) => {
    App.updateStats(e.detail);
    App.generateInsights();
    App.updateLifespan();
    App.updateNoobScores();
    App.updateUserPrice();
    App.updateSimulators();
});

document.addEventListener('renderCharts', (e) => App.renderCharts(e.detail.windowData, e.detail.colors, e.detail.descriptions, false));
document.addEventListener('updateFinanceView', () => App.updateFinanceView());
document.addEventListener('renderCurvePage', () => App.renderCurvePage());
document.addEventListener('renderCalendar', () => {
    if (typeof App.renderCalendar === 'function') {
        try { App.renderCalendar(); } catch(e) {}
    }
});









