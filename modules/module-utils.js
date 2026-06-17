

App.refreshColors = function () {
    if (typeof getCssColors === 'function') {
        CONFIG.colors = getCssColors();
    }
};
// ─── 1. NAČTENÍ BAREV Z CSS ──────────────────────────────────────────────────
function getCssColors() {
    const root = getComputedStyle(document.documentElement);
 
    const getVar = (name, fallback) => {
        const v = (root.getPropertyValue(name) || '').trim();
        return v && v.length > 0 ? v : fallback;
    };
 
    return {
        heatEco: getVar('--success', '#4ade80'),
        heatStd: getVar('--accent', '#5ab8ff'),
        oil: getVar('--oil', '#eab308'),
        tuv: getVar('--tuv', '#d946ef'),
        risk: getVar('--danger', '#ef4444'),
        defrost: getVar('--defrost', '#ffffff'),   
        pressure: getVar('--pressure', '#2dd4bf'),
        gray: 'rgba(148, 163, 184, 0.4)',
        fill: 'rgba(90, 184, 255, 0.15)',
        stroke: getVar('--accent', '#5ab8ff'),
        missing: getVar('--missing', 'rgba(239, 68, 68, 0.25)'),
        weather: getVar('--weather', '#a78bfa')
    };
}

// ─── 2. CHART.JS PLUGINY A HELPERY ──────────────────────────────────────────
const axisMirrorPlugin = {
    id: 'axisMirror',
    afterDraw(chart) {
        if (!chart || !chart.canvas) return;
 
        // 2a. Vykreslení levé osy
        let targetIdLeft = 'yAxisMain';
        if (chart.canvas.id === 'voltChart') targetIdLeft = 'yAxisVolt';
 
        const targetCanvasLeft = document.getElementById(targetIdLeft);
        if (targetCanvasLeft) {
            const ctx = targetCanvasLeft.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const logicalHeight = chart.height || 0;
            const logicalWidthLeft = 45;
 
            if (logicalHeight > 0) {
                const physicalWidth = logicalWidthLeft * dpr;
                const physicalHeight = logicalHeight * dpr;
 
                if (targetCanvasLeft.width !== physicalWidth || targetCanvasLeft.height !== physicalHeight) {
                    targetCanvasLeft.width = physicalWidth;
                    targetCanvasLeft.height = physicalHeight;
                    targetCanvasLeft.style.width = logicalWidthLeft + 'px';
                    targetCanvasLeft.style.height = logicalHeight + 'px';
                }
 
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, targetCanvasLeft.width, targetCanvasLeft.height);
                ctx.scale(dpr, dpr);
 
                ctx.font = '600 10px Inter';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
 
                const textOffsetX = 40;
                let unit = 'W';
 
                if (chart.canvas.id === 'voltChart') {
                    unit = 'V';
                } else if (typeof currentView !== 'undefined') {
                    if (currentView === 'cost') unit = 'Kč';
                    else if (currentView === 'agg_days' || currentView === 'agg_months') unit = 'kWh';
                    else if (currentView === 'agg_cop') unit = 'COP';
                }
 
                const drawScaleLeft = (scale, customUnit, customColor, offsetX) => {
                    if (!scale || !scale.ticks) return;
                    ctx.fillStyle = customColor || 'rgba(238,241,247,0.58)';
                    for (const t of scale.ticks) {
                        if (!t || t.value === undefined || t.value === null) continue;
                        const yPos = scale.getPixelForValue(t.value);
                        if (yPos > 2 && yPos < logicalHeight - 2) {
                            if (customUnit === 'COP') {
                                ctx.fillText(t.value.toFixed(1), offsetX, yPos);
                            } else {
                                ctx.fillText(Math.round(t.value) + (customUnit === 'V' || customUnit === 'W' ? customUnit : ' ' + customUnit), offsetX, yPos);
                            }
                        }
                    }
                };
 
                if (chart.scales.y) {
                    if (chart.canvas.id === 'voltChart') {
                        const defVolt = (typeof CONFIG !== 'undefined' && CONFIG.system && CONFIG.system.defVolt) ? CONFIG.system.defVolt : 230;
                        const yPos = chart.scales.y.getPixelForValue(defVolt);
                        if (yPos > 2 && yPos < logicalHeight - 2) {
                            ctx.fillStyle = 'rgba(238,241,247,0.58)';
                            ctx.fillText(defVolt + 'V', textOffsetX, yPos);
                        }
                    } else {
                        drawScaleLeft(chart.scales.y, unit, 'rgba(238,241,247,0.58)', textOffsetX);
                    }
                }
            }
        }
 
        // 2b. Vykreslení pravé osy (teploty)
        if (chart.canvas.id === 'myChart') {
            const targetCanvasRight = document.getElementById('yAxisTemp');
            if (targetCanvasRight) {
                const ctxR = targetCanvasRight.getContext('2d');
                const dpr = window.devicePixelRatio || 1;
                const logicalHeight = chart.height || 0;
                const logicalWidthRight = 25;
 
                if (logicalHeight > 0) {
                    const physicalWidthR = logicalWidthRight * dpr;
                    const physicalHeightR = logicalHeight * dpr;
 
                    if (targetCanvasRight.width !== physicalWidthR || targetCanvasRight.height !== physicalHeightR) {
                        targetCanvasRight.width = physicalWidthR;
                        targetCanvasRight.height = physicalHeightR;
                        targetCanvasRight.style.width = logicalWidthRight + 'px';
                        targetCanvasRight.style.height = logicalHeight + 'px';
                    }
 
                    ctxR.setTransform(1, 0, 0, 1, 0, 0);
                    ctxR.clearRect(0, 0, targetCanvasRight.width, targetCanvasRight.height);
                    ctxR.scale(dpr, dpr);
 
                    ctxR.font = '600 10px Inter';
                    ctxR.textAlign = 'left';
                    ctxR.textBaseline = 'middle';
 
                    const textOffsetXR = 2;
 
                    if (chart.scales.yTemp) {
                        const customColor = (CONFIG && CONFIG.colors && CONFIG.colors.weather) ? CONFIG.colors.weather : '#a78bfa';
                        ctxR.fillStyle = customColor;
                        for (const t of chart.scales.yTemp.ticks) {
                            if (!t || t.value === undefined || t.value === null) continue;
                            const yPos = chart.scales.yTemp.getPixelForValue(t.value);
                            if (yPos > 2 && yPos < logicalHeight - 2) {
                                ctxR.fillText(Math.round(t.value) + '°', textOffsetXR, yPos);
                            }
                        }
                    }
                }
            }
        }
    }
};
 
const syncTooltips = (activeElements, thisChartId) => {
    if (!activeElements || activeElements.length === 0) return;
    const isAggMode = typeof currentView !== 'undefined' && ['agg_days', 'agg_months', 'agg_cop', 'cost'].includes(currentView);
    if (isAggMode) return;
 
    const idx = activeElements[0].index;
    const charts = [myChart, voltChart]; 
 
    charts.forEach(ch => {
        if (!ch || !ch.canvas) return;
        if (ch.canvas.id === thisChartId) return;
 
        const ds0 = ch.data && ch.data.datasets && ch.data.datasets[0];
        if (!ds0 || !ds0.data || ds0.data[idx] === undefined) return;
 
        try {
            ch.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: 0, y: 0 });
            ch.setActiveElements([{ datasetIndex: 0, index: idx }]);
            ch.update('none');
        } catch (e) { }
    });
};
 
// ─── 3. UI POMOCNÉ FUNKCE ────────────────────────────────────────────────────
App.toggleHelp = function (el) {
    if (!el) return;
    const row = el.closest('.input-row');
    if (!row) return;

    const helpText = row.nextElementSibling;
    const isCurrentlyOpen = helpText && helpText.classList.contains('help-text') && helpText.classList.contains('visible');

    // Zavři všechny ostatní nápovědy
    document.querySelectorAll('.help-text.visible').forEach(h => h.classList.remove('visible'));

    // Otevři tuto, pokud nebyla otevřená
    if (!isCurrentlyOpen && helpText && helpText.classList.contains('help-text')) {
        helpText.classList.add('visible');
    }
};
 
App.handleNoData = function () {
    const msg = document.getElementById('noDataMsg');
    if (msg) msg.style.display = 'block';
 
    if (myChart) {
        myChart.data.labels = [];
        myChart.data.datasets = [];
        try { myChart.update(); } catch (e) { }
    }
 
    if (voltChart) {
        voltChart.data.labels = [];
        if (voltChart.data.datasets && voltChart.data.datasets[0]) {
            voltChart.data.datasets[0].data = [];
        } else {
            voltChart.data.datasets = [{ data: [] }];
        }
        try { voltChart.update(); } catch (e) { }
    }
};

// ─── 4. DEBOUNCE A ERROR HANDLING ───────────────────────────────────────────
App.debounce = function(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
};

App.showError = function(msg) {
    console.error('System Error:', msg);
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

App.setLoading = function(isLoading, text = "Zpracovávám data...") {
    const overlay = document.getElementById('loadingOverlay');
    const textEl = document.getElementById('loadingText');
    if (!overlay) return;
    if (textEl) textEl.innerText = text;
    if (isLoading) overlay.classList.add('visible');
    else overlay.classList.remove('visible');
};

// ─── 5. NUMERICKÁ VALIDACE A OŘEZ (čisté funkce) ─────────────────────────────
// Pomocné funkce pro bezpečné čtení a omezení číselných vstupů.
// Použitelné mj. v App.updateConfig() pro odolnost proti prázdným/NaN hodnotám.

// Bezpečně převede hodnotu na číslo. Při prázdném/NaN/nečíselném vstupu vrátí fallback.
// Pozn.: prázdný string i null/undefined jsou považovány za neplatné (vrací fallback),
// na rozdíl od Number(''), které vrací 0.
function safeNum(value, fallback = 0) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    const n = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
}

// Ořeže číslo do rozsahu [min, max]. Neplatný vstup → fallback (a ten se rovněž ořeže).
// Pokud je fallback mimo rozsah, je rovněž přitažen do [min, max], aby výstup byl vždy platný.
function clampNumber(value, min, max, fallback = 0) {
    let n = safeNum(value, NaN);
    if (!Number.isFinite(n)) n = fallback;
    // Ochrana proti prohozeným mezím
    if (Number.isFinite(min) && Number.isFinite(max) && min > max) {
        const tmp = min; min = max; max = tmp;
    }
    if (Number.isFinite(min) && n < min) n = min;
    if (Number.isFinite(max) && n > max) n = max;
    return n;
}

// ─── 6. CENTRALIZOVANÉ ČESKÉ FORMÁTOVÁNÍ (Intl cs-CZ) ────────────────────────
// Kanonické formátovací helpery pro budoucí použití. Všechny jsou null-safe:
// pro null/undefined/NaN vrací '-'. Existující formátování v kódu nenahrazují.

// Cache instancí Intl.NumberFormat (vytváření je relativně drahé).
const _csNumFmtCache = {};
function _csNumberFormat(decimals) {
    const key = String(decimals);
    if (!_csNumFmtCache[key]) {
        _csNumFmtCache[key] = new Intl.NumberFormat('cs-CZ', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }
    return _csNumFmtCache[key];
}

// Naformátuje číslo dle cs-CZ (desetinná čárka, mezera jako oddělovač tisíců).
function formatNumber(n, decimals = 0) {
    const v = safeNum(n, NaN);
    if (!Number.isFinite(v)) return '-';
    try {
        return _csNumberFormat(decimals).format(v);
    } catch (e) {
        return v.toFixed(decimals);
    }
}

// Naformátuje částku v Kč (0 desetinných míst, s příponou „ Kč").
function formatCurrency(n) {
    const s = formatNumber(n, 0);
    return s === '-' ? '-' : s + ' Kč';
}

// Naformátuje procenta (1 desetinné místo, s příponou „ %"). Vstup je hodnota v %, ne podíl.
function formatPercent(n, decimals = 1) {
    const s = formatNumber(n, decimals);
    return s === '-' ? '-' : s + ' %';
}


