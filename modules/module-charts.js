




// ─── 1. PŘEPÍNÁNÍ A INICIALIZACE GRAFŮ ──────────────────────────────────────
// preventToggle=true: nezměni costViewMode/copViewMode ani netogguj (při re-renderu bez akce uživatele)
// Pozn.: předává se i do renderCharts jako preserveScroll — zachová pozici scrollu.
App.setView = function (v, preventToggle = false) {
    const scroller = document.getElementById('scrollContainerMain');
    if (!scroller) return;
    scroller.style.overflowX = 'hidden';

    if (v === currentView && (v === 'line' || v === 'bar' || v === 'thermal')) {
        zoomLevels[v] = (v === 'bar' ? 0.2 : 1.0);
        if (v === 'line') zoomLevels['thermal'] = 1.0;
        if (v === 'thermal') zoomLevels['line'] = 1.0;
        if (lastWindowData && lastWindowData.length > 0) App.renderCharts(lastWindowData, lastColors, lastDescriptions, false);
        requestAnimationFrame(() => { scroller.style.overflowX = 'auto'; });
        return;
    }

    let centerRatio = 1.0;
    if (scroller.scrollWidth > 0 && currentView !== 'cost' && !currentView.startsWith('agg_')) {
        centerRatio = (scroller.scrollLeft + (scroller.clientWidth / 2)) / scroller.scrollWidth;
    }

    let isSeamlessSwitch = false;
    if ((currentView === 'line' && v === 'thermal') || (currentView === 'thermal' && v === 'line')) {
        zoomLevels[v] = zoomLevels[currentView]; 
        isSeamlessSwitch = true;
    } else if (['line', 'thermal', 'bar'].includes(currentView) && ['line', 'thermal', 'bar'].includes(v)) {
        isSeamlessSwitch = true;
    }

    if (v === 'cost' && !preventToggle) {
        if (currentView === 'cost') costViewMode = costViewMode === 'daily' ? 'monthly' : 'daily';
        else costViewMode = 'daily';
    } else if (v === 'agg_cop' && !preventToggle) {
        if (currentView === 'agg_cop') copViewMode = copViewMode === 'daily' ? 'monthly' : 'daily';
        else copViewMode = 'daily';
    }
    
    currentView = v;

    if (!zoomLevels[v]) {
        zoomLevels[v] = (v === 'bar' ? 0.1 : 1.0);
    }

    if (typeof App.updateChartButtons === 'function') App.updateChartButtons();

    const vWrap1 = document.getElementById('axisVoltWrap');
    const isAggMode = ['agg_days', 'agg_months', 'agg_cop', 'cost'].includes(currentView);

    if (vWrap1) vWrap1.style.display = isAggMode ? 'none' : 'flex';
    const lb = document.querySelector('.legend-bar');
    if (lb) lb.style.display = isAggMode ? 'none' : 'flex';

    App.initCharts(v);

    if (isSeamlessSwitch && lastWindowData && lastWindowData.length > 0) {
        let appliedWidth = App.renderCharts(lastWindowData, lastColors, lastDescriptions, true);
        if (appliedWidth) {
            void scroller.scrollWidth; 
            scroller.scrollLeft = (centerRatio * appliedWidth) - (scroller.clientWidth / 2);
        }
    } else {
        if (lastWindowData && lastWindowData.length > 0 && isAggMode) {
            App.renderCharts(lastWindowData, lastColors, lastDescriptions, preventToggle);
        } else if (typeof App.runPipeline === 'function') {
            App.runPipeline();
        }
    }
    requestAnimationFrame(() => { scroller.style.overflowX = 'auto'; });
};

App.initCharts = function (type) {
    if (myChart) myChart.destroy();
    if (voltChart) voltChart.destroy();

    const isAggMode = ['agg_days', 'agg_months', 'agg_cop', 'cost'].includes(currentView);

    const common = {
        responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { left: 0 } },
        interaction: { mode: 'index', intersect: false }, 
        parsing: false,
        onHover: (e, els, chart) => {
            if (isAggMode) return; 

            if (typeof syncTooltips === 'function') syncTooltips(els, chart.canvas.id);
            const tooltipEl = document.getElementById('chartCustomTooltip');
            if (!tooltipEl) return;
            if (!els || els.length === 0) { tooltipEl.classList.remove('visible'); return; }
            
            const idx = els[0].index;
            if (!lastWindowData || !lastWindowData[idx]) return;
            const d = lastWindowData[idx];

            const time = new Date(d.ts * 1000).toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'});
            const c = CONFIG.curve;
            let lwtTarget = '-';
            if (d.temp != null) {
                if (d.temp <= c.tOutMin) lwtTarget = c.lwtMax.toFixed(1);
                else if (d.temp >= c.tOutMax) lwtTarget = c.lwtMin.toFixed(1);
                else lwtTarget = (c.lwtMax + ((c.lwtMin - c.lwtMax) / (c.tOutMax - c.tOutMin)) * (d.temp - c.tOutMin)).toFixed(1);
            }

            let demandHtml = '';
            const thermo = window.thermoMetricsGlobal;
            const hk = thermo && thermo.houseK ? thermo.houseK.all : 0;
            const gains = thermo && thermo.gains ? thermo.gains : { zima: CONFIG.internalGainW || 0, prechod: CONFIG.internalGainW || 0 };
            
            if (hk > 0 && d.temp != null) {
                let usedGain = (d.temp < 3) ? gains.zima : gains.prechod;
                let dem = hk * (CONFIG.targetIndoorTemp - d.temp) - usedGain;
                demandHtml = `<div class="ct-div"></div><div class="ct-item" style="color:#eab308">🏠 ≈ ${Math.max(0, Math.round(dem))} W</div>`;
            }

            tooltipEl.innerHTML = `
                <div class="ct-row">
                    <div class="ct-item" style="color:var(--accent)">⚡ ${d.p != null ? Math.round(d.p) : '-'} W</div>
                    <div class="ct-div"></div>
                    <div class="ct-item" style="color:var(--success)">🔥 ${d.tp != null ? Math.round(d.tp) : '-'} W</div>
                    <div class="ct-div"></div>
                    <div class="ct-item" style="color:var(--weather)">COP ${d.cop ? d.cop.toFixed(2) : '-'}</div>
                    <div class="ct-div"></div>
                    <div class="ct-item" style="color:var(--oil)">⚡️ ${d.v != null ? d.v.toFixed(1) : '-'} V</div>
                </div>
                <div class="ct-row" style="margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px;">
                    <div class="ct-item">🕒 ${time}</div>
                    <div class="ct-div"></div>
                    <div class="ct-item" style="color:var(--weather)">🌡️ ${d.temp != null ? d.temp.toFixed(1) : '-'} °C</div>
                    <div class="ct-div"></div>
                    <div class="ct-item" style="color:#f87171">♨️ ${lwtTarget} °C</div>
                    ${demandHtml}
                </div>
            `;
            tooltipEl.classList.add('visible');
        },
        plugins: {
            legend: { 
                display: isAggMode && currentView !== 'cost' && currentView !== 'agg_cop', 
                labels: { color: 'rgba(238,241,247,0.58)', font: { size: 10 } }
            },
            tooltip: { 
                enabled: isAggMode, 
                mode: 'index',
                intersect: false,
                callbacks: {
                    label: function(c) {
                        let val = typeof c.raw === 'object' ? c.raw.y : c.raw;

                        if (currentView === 'cost') {
                            if (c.datasetIndex === 0 && c.raw && c.raw.heat !== undefined) {
                                let lines = [`👑 Celkem: ${val.toFixed(0)} Kč`];
                                lines.push(`🔥 Topení: ${c.raw.heat.toFixed(1)} kWh`);
                                lines.push(`💧 TUV: ${c.raw.tuv.toFixed(1)} kWh`);
                                if (c.raw.cop !== undefined && c.raw.cop > 0) lines.push(`⚡ COP: ${c.raw.cop.toFixed(2)}`);
                                if (c.raw.kwhPerHdd !== undefined && c.raw.kwhPerHdd > 0) lines.push(`📉 kWh/HDD: ${c.raw.kwhPerHdd.toFixed(2)}`);
                                if (c.raw.avgTemp !== null) lines.push(`🌡️ Ø Teplota: ${c.raw.avgTemp.toFixed(1)} °C`);
                                return lines;
                            } else if (c.datasetIndex === 1 && val != null) {
                                return `🌡️ Teplota: ${val.toFixed(1)} °C`;
                            }
                        } else if (currentView === 'agg_cop') {
                            if (c.datasetIndex === 0 && val != null) return `⚡ COP: ${val.toFixed(2)}`;
                            if (c.datasetIndex === 1 && val != null) return `🌡️ Teplota: ${val.toFixed(1)} °C`;
                        } else {
                            if (c.datasetIndex === 0 && val != null) return `🔥 Topení: ${val.toFixed(1)} kWh`;
                            if (c.datasetIndex === 1 && val != null) return `💧 TUV: ${val.toFixed(1)} kWh`;
                            if (c.datasetIndex === 2 && val != null) return `🌡️ Teplota: ${val.toFixed(1)} °C`;
                        }
                        return c.formattedValue || '';
                    }
                }
            }
        },
        scales: {
            x: {
                type: isAggMode ? 'category' : 'linear',
                offset: isAggMode,
                ticks: {
                    color: 'rgba(238,241,247,0.58)', font: { size: 10 }, maxRotation: 0, 
                    autoSkip: false,
                    callback: function (val, index) {
                        if (isAggMode) return this.getLabelForValue(val);
                        
                        const dt = new Date(val * 1000);
                        const h = dt.getHours();
                        const m = String(dt.getMinutes()).padStart(2, '0');
                        if ((h === 0 && m === '00') || index === 0) {
                            return `${dt.getDate()}.${dt.getMonth() + 1}. ${h}:${m}`;
                        }
                        return `${h}:${m}`;
                    }
                },
                grid: { 
                    color: ctx => (ctx.tick && ctx.tick.label && ctx.tick.label !== '') ? 'rgba(51, 65, 85, 0.5)' : 'transparent', 
                    drawTicks: false,
                    offset: false 
                }
            }
        }
    };

    try {
        voltChart = new Chart(document.getElementById('voltChart').getContext('2d'), {
            type: 'line', plugins: [typeof axisMirrorPlugin !== 'undefined' ? axisMirrorPlugin : {}],
            data: {
                labels: [],
                datasets: [
                    { data: [], borderColor: CONFIG.colors.oil, borderWidth: 1, pointRadius: 0, fill: false },
                    { data: [], borderColor: 'rgba(255, 255, 255, 0.3)', borderWidth: 1, borderDash: [5, 5], pointRadius: 0, fill: false }
                ]
            },
            options: { 
                ...common, 
                plugins: { legend: { display: false }, tooltip: { enabled: false } }, 
                scales: { 
                    x: common.scales.x,
                    y: { 
                        type: 'linear',
                        min: 220, 
                        max: 240, 
                        ticks: { display: false },
                        grid: { display: false }
                    } 
                } 
            }
        });
    } catch (err) { }

    let myChartScales = {
        y: { type: 'linear', beginAtZero: true, ticks: { display: false } },
        yTemp: { type: 'linear', position: 'right', beginAtZero: false, ticks: { display: false }, grid: { drawOnChartArea: false } },
        x: common.scales.x
    };

    const baseType = isAggMode ? 'bar' : (type === 'bar' ? 'bar' : 'line');

    myChart = new Chart(document.getElementById('myChart').getContext('2d'), {
        type: baseType, plugins: [typeof axisMirrorPlugin !== 'undefined' ? axisMirrorPlugin : {}], data: { labels: [], datasets: [] }, options: { ...common, scales: myChartScales }
    });
};

App.renderCharts = function (wData, colors, descs, preserveScroll = false) {
    const holderMain = document.getElementById('canvasHolderMain'); 
    const holderVolt = document.getElementById('canvasHolderVolt');
    const scrollerMain = document.getElementById('scrollContainerMain');
    const vWrap1 = document.getElementById('axisVoltWrap');
    const lb = document.querySelector('.legend-bar');
    
    if (!holderMain || !scrollerMain || !myChart) return 0;

    let rawCw = scrollerMain.clientWidth; if (rawCw === 0) rawCw = window.innerWidth;
    const cW = Math.max(rawCw - 70, 300);

    const isAggMode = ['agg_days', 'agg_months', 'agg_cop', 'cost'].includes(currentView);

    if (vWrap1) vWrap1.style.display = isAggMode ? 'none' : 'flex';
    if (lb) lb.style.display = isAggMode ? 'none' : 'flex';

    const getTempForStat = (isMonthly, x) => {
        if (!isMonthly) return x.tempCount > 0 ? (x.tempSum / x.tempCount) : null;
        const daysInMonth = dailyStatsGlobal.filter(day => day.dateStr.startsWith(x.isoKey));
        let tSum = 0, tCount = 0;
        daysInMonth.forEach(day => {
            if (day.tempCount > 0) {
                tSum += (day.tempSum / day.tempCount);
                tCount++;
            }
        });
        return tCount > 0 ? (tSum / tCount) : null;
    };

    if (isAggMode) {
        let d = [];
        let isMonthlyScale = false;

        if (currentView === 'agg_months' || (currentView === 'agg_cop' && typeof copViewMode !== 'undefined' && copViewMode === 'monthly') || (currentView === 'cost' && typeof costViewMode !== 'undefined' && costViewMode === 'monthly')) {
            isMonthlyScale = true;
        }

        if (currentSelectionMode === 'day') {
            d = isMonthlyScale ? monthlyStatsGlobal : dailyStatsGlobal;
        } else {
            if (isMonthlyScale) {
                const sY = currentSelectedDate.getMonth() >= 7 ? currentSelectedDate.getFullYear() : currentSelectedDate.getFullYear() - 1;
                d = monthlyStatsGlobal.filter(x => {
                    const parts = x.isoKey.split('-');
                    const y = parseInt(parts[0]);
                    const m = parseInt(parts[1]);
                    if (y === sY && m >= 8) return true;
                    if (y === sY + 1 && m <= 7) return true;
                    return false;
                });
            } else {
                const prefix = `${currentSelectedDate.getFullYear()}-${String(currentSelectedDate.getMonth() + 1).padStart(2, '0')}`;
                d = dailyStatsGlobal.filter(x => x.dateStr && x.dateStr.startsWith(prefix));
            }
        }

        if (!d || !d.length) { if(typeof App.handleNoData==='function') App.handleNoData(); return 0; }
        
        const targetWidth = Math.max(d.length * (isMonthlyScale ? 80 : 40), cW);
        holderMain.style.width = targetWidth + 'px';
        if (holderVolt) holderVolt.style.width = targetWidth + 'px';
        
        if (voltChart) { voltChart.data.labels = []; voltChart.update(); }
        myChart.data.labels = d.map(x => x.label);
        
        let datasets = [];

        if (currentView === 'agg_days' || currentView === 'agg_months') {
            datasets.push({
                type: 'bar',
                label: 'Topení',
                data: d.map((x, i) => ({ x: i, y: x.heatKwh })),
                backgroundColor: CONFIG.colors.heatStd || '#5ab8ff',
                borderRadius: 4,
                yAxisID: 'y',
                order: 2
            });
            datasets.push({
                type: 'bar',
                label: 'TUV',
                data: d.map((x, i) => ({ x: i, y: x.tuvKwh })),
                backgroundColor: CONFIG.colors.tuv || '#d946ef',
                borderRadius: 4,
                yAxisID: 'y',
                order: 2
            });
            datasets.push({
                type: 'line',
                label: 'Teplota',
                data: d.map((x, i) => ({ x: i, y: getTempForStat(isMonthlyScale, x) })),
                backgroundColor: CONFIG.colors.weather || '#a78bfa',
                borderColor: CONFIG.colors.weather || '#a78bfa',
                borderWidth: 1.75,
                pointRadius: 2,
                fill: false,
                yAxisID: 'yTemp',
                order: 1
            });
        } else if (currentView === 'agg_cop') {
            datasets.push({
                type: 'bar',
                label: 'COP',
                data: d.map((x, i) => ({ x: i, y: x.cop })),
                backgroundColor: CONFIG.colors.success || '#4ade80',
                borderRadius: 4,
                yAxisID: 'y',
                order: 2
            });
            datasets.push({
                type: 'line',
                label: 'Teplota',
                data: d.map((x, i) => ({ x: i, y: getTempForStat(isMonthlyScale, x) })),
                backgroundColor: CONFIG.colors.weather || '#a78bfa',
                borderColor: CONFIG.colors.weather || '#a78bfa',
                borderWidth: 1.75,
                pointRadius: 2,
                fill: false,
                yAxisID: 'yTemp',
                order: 1
            });
        } else if (currentView === 'cost') {
            let configPrice = CONFIG.priceKwh;
            datasets.push({
                type: 'bar',
                label: 'Cena',
                data: d.map((x, i) => ({
                    x: i,
                    y: (x.tWh / 1000) * configPrice, 
                    heat: x.heatKwh,
                    tuv: x.tuvKwh,
                    cop: x.cop,
                    kwhPerHdd: x.kwhPerHdd,
                    avgTemp: getTempForStat(isMonthlyScale, x)
                })),
                backgroundColor: CONFIG.colors.heatStd || '#5ab8ff',
                borderRadius: 4,
                yAxisID: 'y',
                order: 2
            });
            datasets.push({
                type: 'line',
                label: 'Teplota',
                data: d.map((x, i) => ({ x: i, y: getTempForStat(isMonthlyScale, x) })),
                backgroundColor: CONFIG.colors.weather || '#a78bfa',
                borderColor: CONFIG.colors.weather || '#a78bfa',
                borderWidth: 1.75,
                pointRadius: 2,
                fill: false,
                yAxisID: 'yTemp',
                order: 1
            });
        }

        myChart.data.datasets = datasets;
        myChart.update();
        if (!preserveScroll) scrollerMain.scrollLeft = targetWidth;
        return targetWidth;
    }

    if (!wData || !wData.length) { if(typeof App.handleNoData==='function') App.handleNoData(); return 0; }

    let z = zoomLevels[currentView] || 1.0;
    
    let bW;
    if (currentView === 'line' || currentView === 'thermal') {
        bW = Math.max((wData[wData.length - 1].ts - wData[0].ts) / 60 * (cW / 360), cW);
    } else {
        bW = Math.max(wData.length * 8, cW);
    }
    
    const finalWidth = Math.min(bW * z, 40000);
    holderMain.style.width = finalWidth + 'px';
    if (holderVolt) holderVolt.style.width = finalWidth + 'px';

    const totalSec = wData[wData.length - 1].ts - wData[0].ts;
    const visibleSec = totalSec * (cW / finalWidth);

    const steps = [900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];
    let stepSec = 86400; 
    
    for (let s of steps) {
        let pxPerTick = (cW / visibleSec) * s;
        if (pxPerTick >= 50) { 
            stepSec = s;
            break;
        }
    }

    const exactMinTs = wData[0].ts;
    const exactMaxTs = wData[wData.length - 1].ts;

    const buildTicksFn = function(axis) {
        const offset = new Date().getTimezoneOffset() * 60;
        let localMin = axis.min - offset;
        let localMax = axis.max - offset;
        
        let startLocal = Math.ceil(localMin / stepSec) * stepSec;
        let ticks = [];
        
        for (let tLocal = startLocal; tLocal <= localMax; tLocal += stepSec) {
            ticks.push({ value: tLocal + offset });
        }
        axis.ticks = ticks;
    };

    const powerColors = new Array(wData.length);
    const tempColors = new Array(wData.length);
    const vColors = new Array(wData.length);
    
    const missingColor = '#ef4444';
    const transColor = 'transparent';
    const weaCol = CONFIG.colors.weather;
    const oilCol = CONFIG.colors.oil;
    const strokeCol = CONFIG.colors.stroke;
    
    for(let i = 0; i < wData.length; i++) {
        if (wData[i].isMissing) { 
            powerColors[i] = missingColor; tempColors[i] = missingColor; vColors[i] = missingColor;
        } else if (i < wData.length - 1 && wData[i+1].ts - wData[i].ts > 1200) { 
            powerColors[i] = transColor; tempColors[i] = transColor; vColors[i] = transColor;
        } else { 
            powerColors[i] = colors[i] || strokeCol; tempColors[i] = weaCol; vColors[i] = oilCol;
        }
    }

    if (voltChart) { 
        voltChart.data.labels = []; 
        voltChart.data.datasets[0].data = wData.map(d => ({ x: d.ts, y: d.v })); 
        voltChart.data.datasets[0].segment = { borderColor: ctx => vColors[ctx.p0DataIndex] }; 
        if (voltChart.data.datasets[1]) {
            voltChart.data.datasets[1].data = wData.map(d => ({ x: d.ts, y: CONFIG.system.defVolt }));
        }
        voltChart.options.scales.x.min = exactMinTs;
        voltChart.options.scales.x.max = exactMaxTs;
        voltChart.options.scales.x.afterBuildTicks = buildTicksFn;
        voltChart.update(); 
    }

    const isThermal = currentView === 'thermal';
    const chartData = isThermal ? wData.map(d => ({ x: d.ts, y: d.tp })) : wData.map(d => ({ x: d.ts, y: d.p }));

    const powerDs = {
        type: currentView === 'bar' ? 'bar' : 'line', 
        data: chartData, 
        descriptions: descs, 
        fill: (currentView === 'line' || currentView === 'thermal'), 
        pointRadius: 0, 
        pointHoverRadius: currentView === 'bar' ? 0 : 5, 
        pointHoverBackgroundColor: '#ffffff', 
        pointHoverBorderWidth: 2,
        borderWidth: currentView === 'bar' ? 0 : 2,
        yAxisID: 'y',
        order: 2,
        segment: { borderColor: ctx => powerColors[ctx.p0DataIndex] }
    };
    
    if (currentView === 'bar') {
        powerDs.backgroundColor = colors;
        powerDs.barPercentage = 0.8;
        powerDs.categoryPercentage = 0.9;
        powerDs.minBarLength = 2;
    } else {
        powerDs.backgroundColor = CONFIG.colors.fill;
    }

    const tempDs = {
        type: 'line',
        data: wData.map(d => ({ x: d.ts, y: d.temp })),
        borderColor: weaCol,
        borderWidth: 1.75,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
        yAxisID: 'yTemp',
        order: 1,
        segment: { borderColor: ctx => tempColors[ctx.p0DataIndex] }
    };

    const c = CONFIG.curve;
    const lwtDs = {
        type: 'line',
        data: wData.map(d => {
            if (d.temp == null) return { x: d.ts, y: null };
            if (d.temp <= c.tOutMin) return { x: d.ts, y: c.lwtMax };
            if (d.temp >= c.tOutMax) return { x: d.ts, y: c.lwtMin };
            return { x: d.ts, y: c.lwtMax + ((c.lwtMin - c.lwtMax) / (c.tOutMax - c.tOutMin)) * (d.temp - c.tOutMin) };
        }),
        borderColor: 'rgba(248, 113, 113, 0.7)',
        borderWidth: 1.75,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false,
        tension: 0,
        yAxisID: 'yTemp',
        order: 1
    };

    const datasets = [powerDs, tempDs, lwtDs];

    if (isThermal) {
        const thermo = window.thermoMetricsGlobal;
        const hk = thermo && thermo.houseK ? thermo.houseK.all : 0;
        const gains = thermo && thermo.gains ? thermo.gains : { zima: CONFIG.internalGainW || 0, prechod: CONFIG.internalGainW || 0 };

        if (hk > 0) {
            datasets.push({
                type: 'line',
                label: 'Potřeba tepla (Zátěž TČ)',
                data: wData.map(d => {
                    if (d.temp == null) return { x: d.ts, y: null };
                    let usedGain = (d.temp < 3) ? gains.zima : gains.prechod;
                    let loss = hk * (CONFIG.targetIndoorTemp - d.temp) - usedGain;
                    return { x: d.ts, y: Math.max(0, loss) };
                }),
                borderColor: '#eab308',
                borderWidth: 2,
                borderDash: [4, 4],
                pointRadius: 0,
                fill: false,
                tension: 0.2,
                yAxisID: 'y',
                order: 0
            });
        }
    }

    myChart.data.labels = []; 
    myChart.data.datasets = datasets; 
    myChart.options.scales.x.min = exactMinTs;
    myChart.options.scales.x.max = exactMaxTs;
    myChart.options.scales.x.afterBuildTicks = buildTicksFn;
    myChart.update();
    
    if (!preserveScroll) scrollerMain.scrollLeft = finalWidth;
    
    return finalWidth;
};

// ─── 2. VYKRESLENÍ EKVITERMNÍ KŘIVKY ────────────────────────────────────────
App.renderCurvePage = function () {
    const c = CONFIG.curve; 
    const thermo = window.thermoMetricsGlobal;
    let hpK_all = thermo && thermo.lossHP ? (thermo.lossHP.all > 0 ? thermo.lossHP.all / (CONFIG.targetIndoorTemp - CONFIG.designTemp) : 0) : 0;
    
    const venkovniTeploty = []; const topneTeploty = []; let tabulkaHTML = '';
    
    let bivalencePointExact = thermo ? thermo.bivExact : null;
    let bivalencePointHighlight = bivalencePointExact !== null ? Math.floor(bivalencePointExact) : null;
    let bivalenceMsgEl = document.getElementById('bivalenceMsg');
    
    let lowestChartTemp = bivalencePointHighlight !== null && bivalencePointHighlight < -20 ? bivalencePointHighlight - 2 : -20;
    let lowestTableTemp = bivalencePointHighlight !== null && bivalencePointHighlight < -16 ? bivalencePointHighlight - 1 : -16;
    
    for (let x = 16; x >= lowestChartTemp; x--) {
        venkovniTeploty.push(x);
        let y = (x <= c.tOutMin) ? c.lwtMax : (x >= c.tOutMax ? c.lwtMin : c.lwtMax + ((c.lwtMin - c.lwtMax) / (c.tOutMax - c.tOutMin)) * (x - c.tOutMin));
        let yZaok = Math.round(y * 10) / 10; topneTeploty.push(yZaok);

        if (x >= lowestTableTemp) {
            let isHighlight = (x === bivalencePointHighlight) ? 'highlight' : ((x === c.tOutMin || x === c.tOutMax) ? 'highlight' : '');
            let bivSymbol = (x === bivalencePointHighlight) ? ' ⚠️' : '';
            let style = x === bivalencePointHighlight ? 'border-color:var(--danger); background:rgba(239, 68, 68, 0.1);' : '';
            let textStyle = x === bivalencePointHighlight ? 'color:var(--danger);' : '';
            
            tabulkaHTML += `<div class="table-cell ${isHighlight}" style="${style}"><span class="temp-out">${x > 0 ? '+' + x : x} °C</span><span class="temp-in" style="${textStyle}">${yZaok} °C${bivSymbol}</span></div>`;
        }
    }
    
    if (bivalenceMsgEl) {
        if (bivalencePointExact !== null) {
            bivalenceMsgEl.innerHTML = `🔥 Tvé čerpadlo pravděpodobně přestane stíhat při <strong>${bivalencePointExact.toFixed(1)} °C</strong> (zátěž ${Math.round(hpK_all)} W/K). Začne pomáhat patrona.`;
            bivalenceMsgEl.style.display = 'block';
            bivalenceMsgEl.style.borderColor = 'var(--warning)';
            bivalenceMsgEl.style.color = 'var(--warning)';
            bivalenceMsgEl.style.background = 'rgba(245, 158, 11, 0.1)';
        } else if (hpK_all > 0) {
            bivalenceMsgEl.innerHTML = `✅ Dle aktuální zátěže (${Math.round(hpK_all)} W/K) čerpadlo <strong>zvládne vytopit dům i při -20 °C</strong> bez patrony!`;
            bivalenceMsgEl.style.borderColor = 'var(--success)';
            bivalenceMsgEl.style.color = 'var(--success)';
            bivalenceMsgEl.style.background = 'rgba(34, 197, 94, 0.1)';
            bivalenceMsgEl.style.display = 'block';
        } else {
            bivalenceMsgEl.style.display = 'none';
        }
    }
    
    const tableContainer = document.getElementById('curveTable');
    if (tableContainer) tableContainer.innerHTML = `<div class="compact-table-grid">${tabulkaHTML}</div>`;

    const canvasEl = document.getElementById('curveChart');
    if (canvasEl) {
        const ctx = canvasEl.getContext('2d');
        if (mujGrafKrivky) mujGrafKrivky.destroy();
        Chart.defaults.color = 'rgba(238,241,247,0.58)';
        mujGrafKrivky = new Chart(ctx, {
            type: 'line',
            data: { labels: venkovniTeploty.reverse(), datasets: [{ label: 'Teplota topné vody', data: topneTeploty.reverse(), borderColor: '#5ab8ff', backgroundColor: 'rgba(90, 184, 255, 0.1)', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: 'Venkovní teplota [°C]', color: 'rgba(238,241,247,0.58)', font: { size: 10 } } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, title: { display: true, text: 'Topná voda [°C]', color: 'rgba(238,241,247,0.58)', font: { size: 10 } }, suggestedMin: Math.min(c.lwtMax, c.lwtMin) - 5, suggestedMax: Math.max(c.lwtMax, c.lwtMin) + 5 } } }
        });
    }
};





