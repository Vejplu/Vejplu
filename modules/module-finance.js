// ─── MODUL FINANCE — náklady, sezónní souhrny a odhady ──────────────────────
// Funkce přesunuté z module-ui.js (modularizace). Pracují se sdílenými globály
// z module-state.js (CONFIG, currentStats, selectedSeason, …) a window.financeMetricsGlobal.
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
