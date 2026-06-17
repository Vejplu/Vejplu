







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

    // Dodané teplo (vyrobená energie) = spotřeba el. × COP Mix za období.
    const cardHeatOut = document.getElementById('cardHeatOut');
    if (cardHeatOut) {
        const valEl = cardHeatOut.querySelector('.stat-value');
        const heatOut = safeNum(s.totalKwh) * safeNum(s.avgCop);
        if (valEl) valEl.innerText = heatOut > 0 ? `${heatOut.toFixed(0)} kWh` : '-';
    }

    const cardLoss = document.getElementById('cardLoss');
    if (cardLoss) {
        const lblEl = cardLoss.querySelector('.stat-label');
        const valEl = cardLoss.querySelector('.stat-value');
        const hkEl = document.getElementById('statHouseK');
        const wm2El = document.getElementById('statWm2');
        
        if (lblEl) lblEl.innerText = `Ztráta domu (${CONFIG.designTemp}°C)`;
        
        let globalHouseK = window.thermoMetricsGlobal ? window.thermoMetricsGlobal.houseK.all : 0;
        let totalDesignLoss = globalHouseK > 0 ? designLossW(globalHouseK, CONFIG.targetIndoorTemp, CONFIG.designTemp) : 0;
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

    // Ztráta domu = hrubá tepelná ztráta budovy při návrhové teplotě (houseK × ΔT).
    let totalDesignLoss = houseK.all > 0 ? designLossW(houseK.all, CONFIG.targetIndoorTemp, CONFIG.designTemp) : 0;
    let lossArea = (CONFIG && CONFIG.floorArea > 0) ? CONFIG.floorArea : 100;
    setVal('th_houseLoss', totalDesignLoss > 0 ? Math.round(totalDesignLoss) + ' W' : '-');
    const thHouseLossLbl = document.getElementById('th_houseLoss_lbl');
    if (thHouseLossLbl) thHouseLossLbl.innerText = `Ztráta domu (${CONFIG.designTemp}°C)`;
    const thHouseLossT = document.getElementById('th_houseLoss_t');
    if (thHouseLossT) thHouseLossT.innerText = totalDesignLoss > 0 ? (totalDesignLoss / lossArea).toFixed(1) + ' W/m²' : '';

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

// (přesunuto do module-finance.js)

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
        // Jednoduchý režim: grafy jen jako agregace, ne technický průběh.
        if (currentAppMode === 'user' && ['line', 'bar', 'thermal'].includes(currentView)) {
            try { App.setView('agg_cop'); } catch (e) {}
            return;
        }
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

// (přesunuto do module-charts.js)

// (přesunuto do module-calendar.js)

// (přesunuto do module-export.js)

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


// (přesunuto do module-api.js)

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
        // Jednoduchý režim: technický průběh grafu nahraď agregací COP.
        if (currentAppMode === 'user' && ['line', 'bar', 'thermal'].includes(currentView)) {
            try { App.setView('agg_cop'); } catch (e) {}
            return;
        }
        if (currentView === 'line' || currentView === 'bar' || currentView === 'thermal') {
            if (lastWindowData && lastWindowData.length > 0) {
                App.renderCharts(lastWindowData, lastColors, lastDescriptions, true);
            }
        }
    }, 50);
};

// Viditelnost záložek dle režimu. Všechny záložky jsou viditelné v obou
// režimech; rozdíl obsahu řeší třída .expert-only (skrytá v jednoduchém
// režimu přes CSS). Tato funkce jen odstraní případné skrytí ze starší logiky.
App.applyModeNav = function() {
    document.querySelectorAll('.bottom-nav .nav-item.nav-hidden-user')
        .forEach(item => item.classList.remove('nav-hidden-user'));
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
    let origLoss = designLossW(houseK, CONFIG.targetIndoorTemp, CONFIG.designTemp);
    let gainW = thermo.gains.zima;

    let newLoss_temp = designLossW(houseK, targetTemp, CONFIG.designTemp);
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
            let p_loss = heatLossW(newK_insul, CONFIG.targetIndoorTemp, t, gainW);
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

    const applyColor = (el, val) => {
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

    applyColor(circleEcon, sc.efficiency);
    applyColor(circleHealth, sc.health);
    applyColor(circleSmooth, sc.smoothness);
    applyColor(circleLoad,  sc.load);
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
};

// ─── 8b. UX VYLEPŠENÍ: STYLY, PŘÍSTUPNOST, PAMĚŤ REŽIMU ─────────────────────

// Jednorázová injektáž CSS tříd, které UI logika používá (kolečka, verdikty,
// akční výzva v postřezích a skrytí technických záložek v uživatelském režimu).
// CSS lze přidat jen za běhu, proto vytvoříme <style> a vložíme do <head>.
// UX styly nyní žijí v module-css.css (jediný zdroj pravdy). Funkce zůstává
// jako no-op kvůli zpětné kompatibilitě volajících míst (bootstrap).
App.injectUxStyles = function() { /* styly přesunuty do module-css.css */ };

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

App.on('updateStats', (e) => {
    App.updateStats(e.detail);
    App.generateInsights();
    App.updateLifespan();
    App.updateNoobScores();
    App.updateUserPrice();
    App.updateSimulators();
});

App.on('renderCharts', (e) => App.renderCharts(e.detail.windowData, e.detail.colors, e.detail.descriptions, false));
App.on('updateFinanceView', () => App.updateFinanceView());
App.on('renderCurvePage', () => App.renderCurvePage());
App.on('renderCalendar', () => {
    if (typeof App.renderCalendar === 'function') {
        try { App.renderCalendar(); } catch(e) {}
    }
});









