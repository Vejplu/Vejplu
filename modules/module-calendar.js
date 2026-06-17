// ─── MODUL KALENDÁŘ A ČASOVÁ OSA — výběr dne/měsíce/roku a navigace ──────────
// Funkce přesunuté z module-ui.js (modularizace). Pracují se sdílenými globály
// z module-state.js (currentSelectedDate, currentSelectionMode, calDate, …).
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
