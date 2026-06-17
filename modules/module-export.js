// ─── MODUL EXPORT — pokročilý export provozních dat (CSV / sdílení) ──────────
// Funkce přesunuté z module-ui.js (modularizace).
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
