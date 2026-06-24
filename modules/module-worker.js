

// ══════════════════════════════════════════════════════════════════════════════
// TČ Expert PRO — Web Worker
// ══════════════════════════════════════════════════════════════════════════════
//
// Datový tok:
//   parseData → fillGapsSafe → detectCycles → analyzeData → fillData
//     → calculateGlobalMetrics → calculatePurePhysics
//     → calculateThermoMetrics → calculateFinanceMetrics
//     → extractDay → calculateWindowStats → generateNoobScoreAndStory
//     → postMessage(RESULT)
//
// Klíčové principy regrese houseK (calculatePurePhysics):
//   y = heatTpWh / 24 [W]  a  x = deltaT z avgTemp 24h [K]
//   MUSÍ být konzistentní: oba průměry přes stejný časový základ (24h).
// ══════════════════════════════════════════════════════════════════════════════

const TYPE = { GRAY: 0, HEAT_STD: 1, HEAT_ECO: 2, TUV: 3, OIL: 4, DEFROST: 5, RISK: 6, MISSING: 7, PRESSURE: 8 };

// ─── FYZIKA BUDOVY (kopie pro vlákno workeru) ───────────────────────────────
// Worker nevidí module-utils.js, proto má vlastní pojmenované kopie. Definice
// MUSÍ zůstat shodná s heatLossW/designLossW v module-utils.js.
function heatLossW(houseK, tIn, tOut, gainW = 0) {
    return houseK * (tIn - tOut) - gainW;
}

// ==========================================
// 1. DATA A PARSOVÁNÍ VÝKONOVÉ MATICE
// ==========================================
const LWT_HEADERS = [30, 35, 40, 45, 50, 55];
let parsedCopMatrix = [];
let parsedTcMatrix = [];

// ─── SEKCE 1: UTILITY (parsování COP matice, interpolace) ────────────────────

// Efektivní vnitřní zisky: pokud je zadána plocha domu, škáluje se 4.5 W/m²
// (základ PHPP 4.1 W/m², rezerva pro spotřebiče a osvětlení v CZ domácnosti)
// Pokud plocha není zadána, použije se manuální config.internalGainW (výchozí 550 W).
function getEffectiveGainW(config) {
    const area = config.floorArea || 0;
    if (area > 20) return Math.round(area * 4.5);
    return config.internalGainW || 550;
}

function parseCopData(csvString) {
if (!csvString) return;
const lines = csvString.split('\n');
parsedCopMatrix = [];
parsedTcMatrix = [];
for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(';');
    if (parts.length < 3) continue;
    const tempOut = parseFloat(parts[0].replace(',', '.'));
    if (isNaN(tempOut)) continue;
    
    const rowCop = [tempOut];
    const rowTc = [tempOut];
    
    const copIndices = [2, 4, 6, 8, 10, 12];
    const tcIndices = [1, 3, 5, 7, 9, 11];
    
    for (let idx of copIndices) {
        let copVal = parseFloat((parts[idx] || "").replace(',', '.'));
        // Chybějící buňka = null (TČ na tomto LWT nepracuje)
        // bilinearInterpolation si s null poradí klampováním na poslední platný sloupec
        rowCop.push(isNaN(copVal) ? null : copVal);
    }
    for (let idx of tcIndices) {
        let tcVal = parseFloat((parts[idx] || "").replace(',', '.'));
        rowTc.push(isNaN(tcVal) ? null : tcVal * 1000);
    }
    
    parsedCopMatrix.push(rowCop);
    parsedTcMatrix.push(rowTc);
}
parsedCopMatrix.sort((a, b) => a[0] - b[0]);
parsedTcMatrix.sort((a, b) => a[0] - b[0]);
}

// ==========================================
// 2. BILINEÁRNÍ INTERPOLACE A VÝPOČTY
// ==========================================
function bilinearInterpolation(table, lwtHeaders, temp, lwt) {
if (!table || table.length === 0) return 3.0;
let lwtIdx1 = 0, lwtIdx2 = 0;
for (let i = 0; i < lwtHeaders.length - 1; i++) {
    if (lwt >= lwtHeaders[i] && lwt <= lwtHeaders[i + 1]) { lwtIdx1 = i; lwtIdx2 = i + 1; break; }
}
if (lwt <= lwtHeaders[0]) { lwtIdx1 = 0; lwtIdx2 = 0; }
if (lwt >= lwtHeaders[lwtHeaders.length - 1]) { lwtIdx1 = lwtHeaders.length - 1; lwtIdx2 = lwtHeaders.length - 1; }

let tIdx1 = 0, tIdx2 = 0;
for (let i = 0; i < table.length - 1; i++) {
    if (temp >= table[i][0] && temp <= table[i + 1][0]) { tIdx1 = i; tIdx2 = i + 1; break; }
}
// EN 14825: mimo rozsah matice použij lineární extrapolaci ze dvou krajních bodů
if (temp <= table[0][0]) {
    tIdx1 = 0; tIdx2 = Math.min(1, table.length - 1);
}
if (temp >= table[table.length - 1][0]) {
    tIdx2 = table.length - 1; tIdx1 = Math.max(0, table.length - 2);
}

let tWeight = (tIdx1 === tIdx2) ? 0 : (temp - table[tIdx1][0]) / (table[tIdx2][0] - table[tIdx1][0]);
let lwtWeight = (lwtIdx1 === lwtIdx2) ? 0 : (lwt - lwtHeaders[lwtIdx1]) / (lwtHeaders[lwtIdx2] - lwtHeaders[lwtIdx1]);

// Najdi nejbližší platný LWT sloupec pokud je null (TČ na tomto LWT nepracuje)
const firstValid = (row, startIdx) => {
    for (let i = startIdx; i > 0; i--) if (row[i] !== null && row[i] !== undefined) return row[i];
    return 3.0;
};
let c11 = table[tIdx1][lwtIdx1 + 1]; if (c11 === null || c11 === undefined) c11 = firstValid(table[tIdx1], lwtIdx1);
let c21 = table[tIdx2][lwtIdx1 + 1]; if (c21 === null || c21 === undefined) c21 = firstValid(table[tIdx2], lwtIdx1);
let c12 = table[tIdx1][lwtIdx2 + 1]; if (c12 === null || c12 === undefined) c12 = firstValid(table[tIdx1], lwtIdx2);
let c22 = table[tIdx2][lwtIdx2 + 1]; if (c22 === null || c22 === undefined) c22 = firstValid(table[tIdx2], lwtIdx2);
let cop1 = c11 + tWeight * (c21 - c11);
let cop2 = c12 + tWeight * (c22 - c12);
let finalVal = cop1 + lwtWeight * (cop2 - cop1);
return finalVal;
}

// ─── SEKCE 2: COP VÝPOČTY ────────────────────────────────────────────────────

function estimateCOPRaw(temp, config) {
    // COP z matice BEZ degradace - používá se pro porovnání s reálným výkonem
    if (temp === null || isNaN(temp)) temp = 5;
    const c = config.curve;
    let targetLWT;
    if (temp <= c.tOutMin) targetLWT = c.lwtMax;
    else if (temp >= c.tOutMax) targetLWT = c.lwtMin;
    // Ochrana proti dělení nulou: pokud tOutMax === tOutMin, použij krajní LWT
    else if (c.tOutMax - c.tOutMin === 0) targetLWT = c.lwtMax;
    else targetLWT = c.lwtMax + ((c.lwtMin - c.lwtMax) / (c.tOutMax - c.tOutMin)) * (temp - c.tOutMin);
    const raw = bilinearInterpolation(parsedCopMatrix, LWT_HEADERS, temp, targetLWT);
    return raw < 1.0 ? 1.0 : raw;
}

// Věková degradace COP: ~1 % ztráty ročně (výzkum FSEC-PF-474-18, Wilkes 2018)
// Pokud installYear > 2000, počítá se automaticky z věku TČ.
// Pokud installYear = 0, použije se manuální copDegradationPercent.
function getDegradFactor(config) {
    const installYear = config.estimations?.installYear || 0;
    if (installYear > 2000) {
        const age = Math.max(0, new Date().getFullYear() - installYear);
        const agePct = Math.min(25, age * 1.0); // max 25 % (25 let)
        return 1 - (agePct / 100);
    }
    return 1 - ((config.estimations?.copDegradationPercent || 12) / 100);
}

function estimateCOP(temp, isTuv, config, humidity) {
if (temp === null || isNaN(temp)) temp = 5;
let targetLWT;
if (isTuv) targetLWT = config.curve.tuvLwt || 50;
else {
    const c = config.curve;
    if (temp <= c.tOutMin) targetLWT = c.lwtMax;
    else if (temp >= c.tOutMax) targetLWT = c.lwtMin;
    // Ochrana proti dělení nulou: pokud tOutMax === tOutMin, použij krajní LWT
    else if (c.tOutMax - c.tOutMin === 0) targetLWT = c.lwtMax;
    else targetLWT = c.lwtMax + ((c.lwtMin - c.lwtMax) / (c.tOutMax - c.tOutMin)) * (temp - c.tOutMin);
}
let finalCop = bilinearInterpolation(parsedCopMatrix, LWT_HEADERS, temp, targetLWT);

// 1. ADAPTIVNÍ DEGRADACE dle roku instalace TČ
// Nové TČ: 5%, rok 3-5: 8%, rok 5-10: 12%, 10+: 18%
let degradationPct = config.estimations.copDegradationPercent || 12;
const installYear = config.estimations.installYear;
if (installYear && installYear > 2000) {
    const age = new Date().getFullYear() - installYear;
    if      (age <= 2)  degradationPct = 5;
    else if (age <= 5)  degradationPct = 8;
    else if (age <= 10) degradationPct = 12;
    else                degradationPct = 18;
}
finalCop = finalCop * (1 - degradationPct / 100);

// 2. KOREKCE VLHKOSTI
// Při vlhkosti >80% a T<5°C tvoří námraza rychleji → více odmrazů → nižší efektivní COP
// Korekční faktor: max -15% při 100% vlhkosti a T=0°C
if (humidity !== null && humidity !== undefined && !isTuv) {
    if (humidity > 80 && temp < 5) {
        const rhFactor = (humidity - 80) / 100;          // 0 při rh=80%, 0.2 při rh=100%
        const tFactor  = Math.max(0, (5 - temp) / 10);   // 0 při T=5°C, 0.5 při T=0°C, 1.0 při T=-5°C
        const humidityPenalty = rhFactor * tFactor * 0.15; // max 15% při rh=100%, T=-5°C
        finalCop = finalCop * (1 - humidityPenalty);
    }
}

// 3. KALIBRAČNÍ KOEFICIENT
// Uživatel může zadat korekci z reálného měření (servis, faktura)
// Výchozí 1.0 = bez korekce, 0.9 = COP je o 10% nižší než odhadujeme
const calFactor = config.estimations.copCalibration || 1.0;
finalCop = finalCop * calFactor;

return finalCop < 1.0 ? 1.0 : finalCop;
}

function estimateMaxTC(temp, config) {
if (temp === null || isNaN(temp)) temp = 5;
const c = config.curve;
let targetLWT;
if (temp <= c.tOutMin) targetLWT = c.lwtMax;
else if (temp >= c.tOutMax) targetLWT = c.lwtMin;
// Ochrana proti dělení nulou: pokud tOutMax === tOutMin, použij krajní LWT
else if (c.tOutMax - c.tOutMin === 0) targetLWT = c.lwtMax;
else targetLWT = c.lwtMax + ((c.lwtMin - c.lwtMax) / (c.tOutMax - c.tOutMin)) * (temp - c.tOutMin);
return bilinearInterpolation(parsedTcMatrix, LWT_HEADERS, temp, targetLWT);
}

// ─── SEKCE 3: FYZIKA BUDOVY ──────────────────────────────────────────────────

function calculateExactBivalence(houseK, maxTcCurve, targetIndoorTemp, gainW = 0) {
if (!houseK || houseK <= 0 || !maxTcCurve || maxTcCurve.length < 2) return null;

for (let i = maxTcCurve.length - 1; i >= 1; i--) {
    let tA = maxTcCurve[i].temp;
    let cA = maxTcCurve[i].maxTc;
    let lA = heatLossW(houseK, targetIndoorTemp, tA, gainW);

    let tB = maxTcCurve[i-1].temp;
    let cB = maxTcCurve[i-1].maxTc;
    let lB = heatLossW(houseK, targetIndoorTemp, tB, gainW);
    
    if (lA <= cA && lB > cB) {
        let w = (cA - lA) / ((cA - lA) - (cB - lB));
        return tA + w * (tB - tA);
    }
}

let p0 = maxTcCurve[0]; 
let p1 = maxTcCurve[1]; 
let loss0 = heatLossW(houseK, targetIndoorTemp, p0.temp, gainW);

if (loss0 <= p0.maxTc) {
    let slope = (p1.maxTc - p0.maxTc) / (p1.temp - p0.temp);
    let exactExtreme = (houseK * targetIndoorTemp - gainW - p0.maxTc + slope * p0.temp) / (slope + houseK);
    return exactExtreme;
}
return null;
}

async function fetchWeatherData(lat, lon, startTs, endTs) {
try {
    const startDate = new Date(startTs * 1000).toISOString().split('T')[0];
    const endDate = new Date(endTs * 1000).toISOString().split('T')[0];
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&hourly=temperature_2m,relative_humidity_2m&timeformat=unixtime`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (data && data.hourly && data.hourly.time && data.hourly.temperature_2m) {
        return {
            times: data.hourly.time,
            temps: data.hourly.temperature_2m,
            humidity: data.hourly.relative_humidity_2m || null
        };
    }
    return null;
} catch (e) { return null; }
}

// ==========================================
// 3. FYZIKA BUDOVY A HODNOCENÍ SYSTÉMU
// ==========================================
let memCache = null;

function calculatePurePhysics(dailyStats, config) {
// Regrese tepelných ztrát: y = k × deltaT − gain
//   y       = heatTpWh / 24         [W]   průměrná tepelná zátěž za den
//   deltaT  = targetTemp − avgTemp   [K]   průměrná venkovní teplota za den
//   k       = tepelná ztráta         [W/K]
//   gain    = vnitřní zisky           [W]
//
// KONZISTENCE: oba vstupy (y i deltaT) musí používat stejný časový základ (24 h).
// Míchat avgTempHeat (jen topné hodiny) s heatTpWh/24 (průměr přes den) je chyba.
//
// IQR filtrování: odstraní anomální dny (servis, otevřené dveře, návštěva).
// Používá FIXNÍ gainEst = config.internalGainW — nikoliv sluneční korekci,
// protože IQR a regrese musí sdílet stejnou apriorní představu o gainech.
//
// Váhování dle délky chodu (runWeight): pouze v deltaT^6 FALLBACK regresi.
// V primární OLS nestabilizuje — může poškodit pokud málo zimních dat.

let daysZima = [];
let daysPrechod = [];

dailyStats.forEach(d => {
    if (d.tempCount === 0 || d.heatWh === 0 || d.hdd <= 0) return;
    if ((d.heatRunHours || 0) < 1) return; // dny s <1h topení nevypovídají o tepelných ztrátách

    // Průměrná teplota celého dne (konzistentní s heatTpWh/24)
    const avgTemp = d.tempSum / d.tempCount;
    if (avgTemp >= 12) return;

    // Vyloučit dny kde TUV tvoří >70% spotřeby (zkresluje tepelné ztráty)
    if (avgTemp > 8 && d.tuvWh > 0 && d.heatWh > 0 && (d.tuvWh / (d.heatWh + d.tuvWh)) > 0.70) return;

    const deltaT    = Math.max(0.5, config.targetIndoorTemp - avgTemp);
    const avgPowerW = d.heatTpWh / (d.totalHours || 24); // Wh tepla / 24 h = průměrný W

    // Váha pro fallback regresi: delší topný chod = spolehlivější den
    const hrs       = d.heatRunHours || 1;
    const runWeight = hrs > 16 ? 2.0 : hrs > 8 ? 1.5 : hrs > 4 ? 1.0 : 0.5;

    const point = { x: deltaT, y: avgPowerW, w: runWeight };
    if (avgTemp < 3) daysZima.push(point);
    else             daysPrechod.push(point);
});

// IQR filtrování: odstraní dny s anomálním poměrem tepelného výkonu a deltaT
// gainEst = apriorní odhad vnitřních zisků (fixní, shodný s regresní apriori)
const removeOutliers = (arr) => {
    if (arr.length < 8) return arr;
    const gainEst = getEffectiveGainW(config); // škálováno dle plochy domu
    const kVals   = arr.map(p => (p.y + gainEst) / p.x).sort((a, b) => a - b);
    const n   = kVals.length;
    const q1  = kVals[Math.floor(n * 0.25)];
    const q3  = kVals[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const lo  = q1 - 1.5 * iqr;
    const hi  = q3 + 1.5 * iqr;
    return arr.filter(p => { const k = (p.y + gainEst) / p.x; return k >= lo && k <= hi; });
};

const calcReg = (arr) => {
    let k_base = null, dynamicGain = null, isFallback = false;

    const cleaned = removeOutliers(arr);
    const data    = cleaned.length >= 5 ? cleaned : arr;

    // Primární: nevážená OLS (původní stabilní přístup)
    if (data.length >= 5) {
        let n = data.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        data.forEach(p => {
            sumX += p.x; sumY += p.y;
            sumXY += p.x * p.y; sumXX += p.x * p.x;
        });
        const denom = (n * sumXX) - (sumX * sumX);
        if (denom !== 0) {
            const k_reg    = ((n * sumXY) - (sumX * sumY)) / denom;
            const q_reg    = (sumY - k_reg * sumX) / n;
            const calcGain = -q_reg;
            // k > 10 zahrnuje i pasivní domy (15–30 W/K)
            if (k_reg > 10 && k_reg < 1500 && calcGain > 50 && calcGain < 3000) {
                k_base = k_reg;
                dynamicGain = calcGain;
            }
        }
    }

    // Fallback: deltaT^6 váhovaná regrese s runWeight (delší dny váží více)
    if (k_base === null) {
        isFallback    = true;
        dynamicGain   = getEffectiveGainW(config);
        let k_sum = 0, weight_sum = 0;
        arr.forEach(p => {
            const daily_k = (p.y + dynamicGain) / p.x;
            const weight  = (p.w || 1) * Math.pow(p.x, 6); // runWeight × deltaT^6
            k_sum      += daily_k * weight;
            weight_sum += weight;
        });
        k_base = weight_sum > 0 ? (k_sum / weight_sum) : 0;
    }

    return { k: k_base, gain: dynamicGain, fallback: isFallback };
};

let zima    = calcReg(daysZima);
let prechod = calcReg(daysPrechod);

if (zima.k === 0 && prechod.k > 0)   { zima.k = prechod.k; zima.gain = prechod.gain; zima.fallback = true; }
if (prechod.k === 0 && zima.k > 0)   { prechod.k = zima.k * 0.95; prechod.gain = zima.gain; prechod.fallback = true; }

return {
    k_zima:              zima.k    || 0,
    k_prechod:           prechod.k || 0,
    dynamicGainW_zima:   zima.gain,
    dynamicGainW_prechod:prechod.gain,
    isFallbackZima:      zima.fallback,
    isFallbackPrechod:   prechod.fallback,
    win_days:            daysZima.length,
    tra_days:            daysPrechod.length
};
}

// ─── SEKCE 4: EXPERTNÍ SKÓRE (0–1000 bodů) ───────────────────────────────────

function calculateExpertScore(physics, financeTotal, windowStats, config) {
let hasEnoughData = true;

if (!physics || (physics.win_days + physics.tra_days < 10) || (physics.isFallbackZima && physics.isFallbackPrechod)) {
    hasEnoughData = false;
}

let score = {
    hasEnoughData: hasEnoughData,
    insulation: 0,
    efficiency: 0,
    health: 0,
    accumulation: 0,
    total: 0
};

if (!hasEnoughData) return score;

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

let area = (config.floorArea && config.floorArea > 0) ? config.floorArea : 100;
let designLoss = (physics.k_zima * (config.targetIndoorTemp - config.designTemp)) - (physics.dynamicGainW_zima || 0);
let wm2 = designLoss > 0 ? designLoss / area : 0;

let insScore = 100 - ((wm2 - 20) / (120 - 20)) * 100;
score.insulation = clamp(insScore, 0, 100);

let scop = financeTotal ? financeTotal.finalSCOP : 0;
// SCOP projekce běží přes evanTemps (celý rok) → nezávisí na délce měřeného období
// Škála: SCOP 1.8 = 0 bodů (kotel), 5.3 = 100 bodů (špičkový pasiv)
// Reálná data: UK/IE průměr SPF=2.59, DE/AT průměr SPF=3.4 (Fraunhofer ISE 2025)
let effScore = ((scop - 1.8) / (5.3 - 1.8)) * 100;
score.efficiency = clamp(effScore, 0, 100);

// HEALTH — zpřísněné škály (Fraunhofer/ETH: průměrný invertor 3-5 startů/h)
// plynulost: 90% lowMod = 100b (reálně max ~75-80%, takže 100b je skutečná výjimka)
let plynulostScore = windowStats.lowModPercent ? (windowStats.lowModPercent / 90) * 100 : 0;
// starty: škála 0.5–4/h (2/h už není automaticky 100b, ale ~86b)
let startyScore = ((4 - windowStats.maxStartsPerHour) / (4 - 0.5)) * 100;
// krátké cykly: zpřísněno 20%→10% (10% krátkých = 0b, místo 20%)
let shortRatio = windowStats.netStarts > 0 ? (windowStats.short / windowStats.netStarts) : 0;
let shortsScore = 100 - (shortRatio / 0.10) * 100;

score.health = clamp((clamp(plynulostScore, 0, 100) + clamp(startyScore, 0, 100) + clamp(shortsScore, 0, 100)) / 3, 0, 100);

let avgRun = windowStats.avgRun || 0;
let avgPause = windowStats.avgPause || 0;
// setrvacnost: strop 200 minut (120 bylo příliš snadno dosažitelné)
// Špičková instalace má cyklus 180-240 min — 200 min jako referenční maximum
let setrvacnostScore = (((avgRun + avgPause) - 40) / (200 - 40)) * 100;

let gainDiff = (physics.dynamicGainW_prechod || 0) - (physics.dynamicGainW_zima || 0);
// gainDiff: zpřísněno 400→600W (600W solárních zisků = 100b)
let ziskyScore = gainDiff > 0 ? (gainDiff / 600) * 100 : 0;

score.accumulation = clamp((clamp(setrvacnostScore, 0, 100) + clamp(ziskyScore, 0, 100)) / 2, 0, 100);

// Total score: 0–1000 bodů (přehlednější než procenta)
// Váhy: izolace 35%, účinnost 30%, zdraví 25%, akumulace 10%
score.total = clamp(Math.round(
    (score.insulation * 0.35) + 
    (score.efficiency * 0.30) + 
    (score.health * 0.25) + 
    (score.accumulation * 0.10)
) * 10, 0, 1000);

return score;
}

// =============================================================================
//  UŽIVATELSKÉ HODNOCENÍ (NOOB SCORE)
// =============================================================================

// POMOCNÁ: Trend COP z globální historie (posledních ~20 topných dní)
function computeCopTrend(globalMetrics) {
if (!globalMetrics || !globalMetrics.dailyStats || globalMetrics.dailyStats.length < 8)
    return { state: 'T0' };

const heatingDays = globalMetrics.dailyStats
    .filter(d => (d.heatWh || 0) > 500 && d.tempCount > 0 && (d.heatTpWh || 0) > 0)
    .slice(-20);

if (heatingDays.length < 6) return { state: 'T0' };

const half  = Math.floor(heatingDays.length / 2);
const older = heatingDays.slice(0, half);
const newer = heatingDays.slice(half);

const getAvgCop = (arr) => {
    let wh = 0, tpWh = 0;
    arr.forEach(d => { wh += (d.heatWh || 0); tpWh += (d.heatTpWh || 0); });
    return wh > 100 ? tpWh / wh : 0;
};
const getAvgTemp = (arr) => {
    let sum = 0, count = 0;
    arr.forEach(d => { if (d.tempCount > 0) { sum += d.tempSum / d.tempCount; count++; } });
    return count > 0 ? sum / count : null;
};

const oldCop  = getAvgCop(older);
const newCop  = getAvgCop(newer);
const oldTemp = getAvgTemp(older);
const newTemp = getAvgTemp(newer);

if (oldCop <= 0 || newCop <= 0) return { state: 'T0' };

let correctedNewCop = newCop;
if (oldTemp !== null && newTemp !== null
    && Number.isFinite(oldTemp) && Number.isFinite(newTemp)) {
    correctedNewCop = newCop - ((newTemp - oldTemp) * 0.08);
}

const changePercent = ((correctedNewCop - oldCop) / oldCop) * 100;
if (changePercent < -15) return { state: 'T3', changePercent, oldCop, newCop };
if (changePercent < -8)  return { state: 'T2', changePercent, oldCop, newCop };
return                         { state: 'T1', changePercent, oldCop, newCop };
}

// POMOCNÁ: Kontext odmrazů — při T>6°C jsou odmrazy vždy anomálie
// ─── SEKCE 5: KONTEXTOVÁ ANALÝZA A DENNÍ SKÓRE ───────────────────────────────

function analyzeDefrostContext(stats) {
if (!stats.defrosts || stats.defrosts === 0)
    return { state: 'D0', defrostsPerRunHour: 0 };
if (!stats.totalRunHours || stats.totalRunHours < 0.5)
    return { state: 'D0', defrostsPerRunHour: 0 };

const avgTemp = (stats.avgTemp !== null && Number.isFinite(stats.avgTemp)) ? stats.avgTemp : 5;
const defrostsPerRunHour = stats.defrosts / stats.totalRunHours;

let expectedPerHour;
if      (avgTemp >   6) expectedPerHour = 0.00;
else if (avgTemp >   3) expectedPerHour = 0.15;
else if (avgTemp >   0) expectedPerHour = 0.50;
else if (avgTemp >  -5) expectedPerHour = 0.60;
else if (avgTemp > -10) expectedPerHour = 0.40;
else                    expectedPerHour = 0.25;

if (avgTemp > 6 && stats.defrosts > 0)
    return { state: 'D2', defrostsPerRunHour, expectedPerHour, excessRatio: 99 };
if (avgTemp > 3 && defrostsPerRunHour > 0.30)
    return { state: 'D2', defrostsPerRunHour, expectedPerHour,
             excessRatio: defrostsPerRunHour / Math.max(0.01, expectedPerHour) };

const excessRatio = expectedPerHour > 0 ? (defrostsPerRunHour / expectedPerHour) : 0;
if (excessRatio > 2.5) return { state: 'D3', defrostsPerRunHour, expectedPerHour, excessRatio };
return { state: 'D1', defrostsPerRunHour, expectedPerHour, excessRatio };
}

function analyzeTuvContext(stats, config, avgTemp, heatLWT) {
const count = stats.tuv || 0;
if (count === 0) return { state: 'TUV_NONE', count: 0 };

const totalKwh   = stats.tuvKwh || 0;
const kwPerCycle = count > 0 ? totalKwh / count : 0;

const tuvPowerKw = (
    config.tuv && config.tuv.dynMax && config.tuv.dynMin
        ? (config.tuv.dynMax + config.tuv.dynMin) / 2
        : 3350
) / 1000;

const estMinPerCycle = kwPerCycle > 0 ? Math.round((kwPerCycle / tuvPowerKw) * 60) : 0;

let durState;
if      (kwPerCycle < 0.8) durState = 'VERY_SHORT';
else if (kwPerCycle < 2.0) durState = 'SHORT';
else if (kwPerCycle < 4.0) durState = 'NORMAL';
else                        durState = 'LONG';

let freqState;
if      (count === 1) freqState = 'ONCE';
else if (count === 2) freqState = 'TWICE';
else                  freqState = 'FREQUENT';

const copHeat = stats.copHeat || 0;
const copTuv  = stats.copTuv  || 0;
const tuvLWT  = (config.curve && Number.isFinite(config.curve.tuvLwt))
                ? config.curve.tuvLwt : 55;

let timingHint   = null;
let actualRatio  = null;
let expectedRatio = null;
let relPerf       = null;

if (copHeat > 0.5 && copTuv > 0.5) {
    actualRatio = copTuv / copHeat;

    const safeTemp    = (Number.isFinite(avgTemp))  ? avgTemp  : 5;
    const safeHeatLWT = (Number.isFinite(heatLWT))  ? heatLWT  : 40;
    const diffHeat = safeHeatLWT - safeTemp;
    const diffTuv  = tuvLWT      - safeTemp;

    if (diffHeat > 2 && diffTuv > diffHeat) {
        expectedRatio = diffHeat / diffTuv;
        relPerf       = actualRatio / expectedRatio;

        if      (relPerf < 0.65) timingHint = 'NIGHT';
        else if (relPerf < 0.78) timingHint = 'SUBOPTIMAL';
        else                     timingHint = 'OK';
    }
}

return {
    state: freqState, durState, count,
    kwPerCycle, estMinPerCycle, totalKwh,
    timingHint, actualRatio, expectedRatio, relPerf,
    copTuv, copHeat, tuvLWT
};
}

// =============================================================================
// GENEROVÁNÍ SKÓRE A PŘÍBĚHU
// =============================================================================
function generateNoobScoreAndStory(stats, config, physics, globalMetrics) {
let score = { efficiency: 0, health: 0, smoothness: 0, load: 0, story: "" };

if (!stats || stats.raw === undefined || stats.totalHours < 1) {
    score.story = "<i>Příliš krátké období pro analýzu nebo chybějící data.</i>";
    return score;
}

const clamp  = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
const f1     = (n) => Number.isFinite(n) ? n.toFixed(1)  : '?';
const f2     = (n) => Number.isFinite(n) ? n.toFixed(2)  : '?';
const pctStr = (n) => Number.isFinite(n) ? Math.round(n) + ' %' : '?';

const isIdlingDay = (
    stats.totalHours   >= 20  && stats.totalRunHours < 0.2 &&
    stats.totalKwh      < 0.5 && stats.netStarts    <= 1   &&
    stats.tuv          === 0  && stats.defrosts     === 0
);
// TUV-only den: žádné topení, jen ohřev TUV
// Pro scoreP/Z/R je nerelevantní hodnotit plynulost topení — TUV cyklus je vždy krátký a na plný výkon
const isTuvOnlyDay = (
    !isIdlingDay &&
    stats.heatKwh < 0.5  &&          // minimální nebo žádné topení
    (stats.tuvKwh || 0) > 0.1 &&     // ale TUV proběhlo
    (stats.netStarts || 0) === 0      // žádné topné starty
);

// Čistě topné hodiny (bez TUV a defrost) — z heatRunSum/60
const heatOnlyHours = (stats.heatOnlyHours != null) ? stats.heatOnlyHours : 0;

// Letní režim: žádné topení po celé období (TUV může jet normálně, i vícekrát)
const isSummerMode = (
    stats.totalHours   >= 20  &&
    stats.heatKwh       < 0.3 &&
    stats.netStarts    === 0  &&   // netStarts = pouze topné starty (TUV se nepočítá)
    stats.defrosts     === 0
);

// Přechodné období: TOPENÍ jen krátce (méně než 15 % doby, pouze tepelné hodiny bez TUV)
const avgTempForPeriod = (stats.avgTemp !== null && Number.isFinite(stats.avgTemp)) ? stats.avgTemp : 5;
const heatRunFraction  = stats.totalHours > 0 ? (heatOnlyHours / stats.totalHours) : 0;
const isTransitionDay  = (
    !isIdlingDay && !isSummerMode &&
    stats.totalHours  >= 12  &&
    heatRunFraction   < 0.15 &&
    stats.heatKwh     < 3    &&
    avgTempForPeriod  > 5
);

// Standby příkon — průměrný odběr v pohotovostním režimu
const standbyAvgW = (stats.standbyHours && stats.standbyHours > 1 && stats.standbyKwh != null)
    ? (stats.standbyKwh * 1000) / stats.standbyHours
    : null;
const standbyThreshold = (config.system && config.system.standbyWarnW) ? config.system.standbyWarnW : 30;
const isHighStandby    = standbyAvgW !== null && standbyAvgW > standbyThreshold && (stats.standbyHours || 0) > 3;

const avgTemp     = (stats.avgTemp !== null && Number.isFinite(stats.avgTemp)) ? stats.avgTemp : 5;
// expectedCop: ČISTÁ matice BEZ degradace při teplotě BĚHEM TOPENÍ (ne průměr celého dne)
// avgTempHeat = průměr jen při chodu TČ — zabrání zkreslení teplým odpolednem
const avgTempForCop = (stats.avgTempHeat !== null && stats.avgTempHeat !== undefined && stats.avgTempHeat < avgTemp)
    ? stats.avgTempHeat
    : avgTemp;
const expectedCop = estimateCOPRaw(avgTempForCop, config);
// realCop = copHeat z calculateWindowStats (vážený průměr estimateCOP přes topné minuty)
// Fallback na avgCop pokud heatKwh < 0.2 (příliš malý vzorek)
const realCop     = (stats.copHeat > 0 && stats.heatKwh > 0.2) ? stats.copHeat : (stats.avgCop > 0 ? stats.avgCop : 0);
const copRatio    = (expectedCop > 0 && realCop > 0) ? (realCop / expectedCop) : 0;

const tuvRatio     = stats.totalKwh > 0 ? (stats.tuvKwh / stats.totalKwh) : 0;
const defrostRatio = stats.heatKwh  > 0 ? ((stats.defrostWh || 0) / (stats.heatKwh * 1000)) : 0;
const shortRatio   = stats.netStarts > 0 ? (stats.short / stats.netStarts) : 0;

const maxTc           = estimateMaxTC(avgTemp, config);
const avgPowerThermal = stats.totalRunHours > 0 ? ((stats.heatTpWh || 0) + (stats.tuvTpWh || 0)) / stats.totalRunHours : 0;
const capacityUsed    = maxTc > 0 ? (avgPowerThermal / maxTc) : 0;
const dutyCycle       = stats.runTimePercent || 0;
const maxSph          = stats.maxStartsPerHour || 0;
const lowMod          = stats.lowModPercent || 0;
const avgRun          = stats.avgRun || 0;

const c = config.curve;
let heatLWT = (c && Number.isFinite(c.lwtMin)) ? c.lwtMin : 35;
if (c && Number.isFinite(c.lwtMax) && Number.isFinite(c.lwtMin) && Number.isFinite(c.tOutMin) && Number.isFinite(c.tOutMax)) {
    if      (avgTemp <= c.tOutMin) heatLWT = c.lwtMax;
    else if (avgTemp >= c.tOutMax) heatLWT = c.lwtMin;
    // Ochrana proti dělení nulou: pokud tOutMax === tOutMin, použij krajní LWT
    else if (c.tOutMax - c.tOutMin === 0) heatLWT = c.lwtMax;
    else { const t = (avgTemp - c.tOutMin) / (c.tOutMax - c.tOutMin); heatLWT = c.lwtMax + t * (c.lwtMin - c.lwtMax); }
}
const tuvLWT = (c && Number.isFinite(c.tuvLwt)) ? c.tuvLwt : 55;

const defrostCtx = analyzeDefrostContext(stats);
const copTrend   = computeCopTrend(globalMetrics);

// =========================================================================
// KROK 1: STAVY A SKÓRE KOLEČEK
// =========================================================================

// U — Účinnost
// copRatio je kruhová závislost (copHeat = p×estimateCOP → vždy ≈ degradace).
// Hodnotíme proto: defrosty, TUV podíl a normalizovaný copHeat vůči podmínkám.
// normCop = copHeat / (expectedCop × degradFactor)
//   kde degradFactor = (1 - degradationPct/100) = očekávaná degradace
//   → normCop=1.0 znamená TČ dosahuje přesně toho co se čeká po degradaci
//   → normCop>1.0 znamená lepší než očekáváno (kalibrační faktor, čistý výparník)
//   → normCop<1.0 znamená horší (znečistění, hydraulika, špatné plnění)
const degradFactor = getDegradFactor(config);
const normCop = (expectedCop > 0 && realCop > 0 && degradFactor > 0)
    ? (realCop / (expectedCop * degradFactor))
    : 0;

let stateU, scoreU;
if (isIdlingDay)  { stateU = 'U0'; scoreU = 100; }
else if (isTuvOnlyDay) {
    // TUV COP: dobrý ohřev má COP 2.5-3.5 při LWT 50-55°C
    const tuvCop = stats.copTuv || 0;
    if      (tuvCop >= 2.8)  { stateU = 'U0'; scoreU = 95; }
    else if (tuvCop >= 2.2)  { stateU = 'U0'; scoreU = 85; }
    else if (tuvCop >= 1.6)  { stateU = 'U0'; scoreU = 72; }
    else if (tuvCop > 0)     { stateU = 'U0'; scoreU = 58; }
    else                     { stateU = 'U0'; scoreU = 88; }
}
// Problémy nezávislé na COP
else if (defrostCtx.state === 'D2' && defrostRatio > 0.05)                     { stateU = 'U3b'; scoreU = 48; }
else if (defrostCtx.state === 'D3' || (defrostRatio > 0.07 && avgTemp < 3))    { stateU = 'U3';  scoreU = 62; }
else if (tuvRatio > 0.35)                                                        { stateU = 'U2';  scoreU = 78; }
// normCop škála: 1.0 = přesně dle očekávání po degradaci
// <0.75 → výrazně pod očekáváním (znečistění, závada)
// 0.75-0.92 → mírně pod (běžné pro reálný provoz)
// 0.92-1.08 → v normě
// >1.08 → lepší než očekáváno (dobrá kalibrace, čistý výparník)
else if (normCop >= 1.10)                                                        { stateU = 'U1a'; scoreU = 97; }
else if (normCop >= 1.00)                                                        { stateU = 'U1b'; scoreU = 90; }
else if (normCop >= 0.92)                                                        { stateU = 'U1c'; scoreU = 82; }
else if (normCop >= 0.82)                                                        { stateU = 'U1d'; scoreU = 72; }
else if (normCop >= 0.70)                                                        { stateU = 'U1e'; scoreU = 55; }
else if (normCop > 0)                                                            { stateU = 'U1f'; scoreU = 35; }
else                                                                             { stateU = 'U1';  scoreU = 82; } // fallback: žádná data
score.efficiency = scoreU;

// Z — Zdraví kompresoru
// TUV-only den: žádné topné starty → nelze hodnotit
// Klíčové: maxSph je max starty PER topnou hodinu — na přechodném dni je 1 start za 0.35h = 2.9/hod
// Proto přidáme dailyStartRate = starty za celý den (reálnější pro přechodné dny)
const dailyStartRate = stats.totalHours > 0 ? ((stats.netStarts || 0) / stats.totalHours) : 0;
// Při přechodném dni s 1 startem za 24h: dailyStartRate = 0.04/hod → vzorové
// Zimní den s 8 starty za 24h: dailyStartRate = 0.33/hod → zvýšené
const effectiveSph = isTransitionDay
    ? Math.min(maxSph, dailyStartRate * 6)  // *6 = přibližně "starty za 4 h" (konzervativní škálování pro přechod)
    : maxSph;

let stateZ, scoreZ;
if (isIdlingDay || isTuvOnlyDay)                                { stateZ = 'Z1'; scoreZ = 100; }
else if (effectiveSph > 5   || shortRatio > 0.25)               { stateZ = 'Z4'; scoreZ = 12;  }
else if (effectiveSph > 3   || shortRatio > 0.12)               { stateZ = 'Z3'; scoreZ = 42;  }
else if (effectiveSph > 2   || shortRatio > 0.04)               { stateZ = 'Z2'; scoreZ = 68;  }
else if (effectiveSph > 1.5 || shortRatio > 0.02 || avgRun < 25){ stateZ = 'Z2'; scoreZ = 85;  }
else                                                             { stateZ = 'Z1'; scoreZ = 97;  }
score.health = scoreZ;

// P — Plynulost modulace
// TUV-only den: nelze hodnotit plynulost topení
// Přechodný den (isTransitionDay): krátký běh je fyzikálně normální (dům teplo skoro nepotřebuje)
// Dobrý invertor: lowMod 60-80%, 80%+ je skutečná výjimka
let stateP, scoreP;
if (isIdlingDay || isTuvOnlyDay)                                  { stateP = 'P1'; scoreP = 100; }
else if (isTransitionDay && avgRun < 50 && stats.netStarts <= 2)  { stateP = 'P1'; scoreP = 88;  }
else if (lowMod > 72 || (avgRun > 80 && lowMod > 50))            { stateP = 'P1'; scoreP = 95;  }
else if (lowMod > 55 || (avgRun > 65 && lowMod > 35))            { stateP = 'P2'; scoreP = 82;  }
else if (lowMod >= 38)                                             { stateP = 'P2'; scoreP = 68;  }
else if (avgTemp > 8 && avgRun < 40)                              { stateP = 'P3'; scoreP = 52;  }
else if (avgTemp <= 5 && avgRun < 40)                             { stateP = 'P4'; scoreP = 28;  }
else                                                               { stateP = 'P2'; scoreP = 62;  }
score.smoothness = scoreP;

// R — Kapacitní zátěž
// TUV-only den: kapacitní zátěž topení nelze hodnotit
// Optimální: dutyCycle 30-75%, capacityUsed 25-75%
let stateR, scoreR;
if (isIdlingDay || isTuvOnlyDay)                                       { stateR = 'R2'; scoreR = 100; }
else if (dutyCycle > 95 && capacityUsed > 0.95)                       { stateR = 'R5'; scoreR = 25;  }
else if (dutyCycle > 80 && capacityUsed > 0.80 && avgTemp > 5)       { stateR = 'R3'; scoreR = 52;  }
else if (dutyCycle > 88 && capacityUsed > 0.88 && avgTemp <= 0)      { stateR = 'R4'; scoreR = 72;  }
else if (dutyCycle < 20 && capacityUsed < 0.20)                       { stateR = 'R1'; scoreR = 78;  }
else if (capacityUsed < 0.35 && dutyCycle < 45)                       { stateR = 'R1'; scoreR = 85;  }
else if (dutyCycle >= 30 && dutyCycle <= 75 && capacityUsed > 0.25 && capacityUsed < 0.80) { stateR = 'R2'; scoreR = 92; }
else                                                                   { stateR = 'R2'; scoreR = 88;  }
score.load = scoreR;

// =========================================================================
// KROK 2: STAVBA PŘÍBĚHU
// =========================================================================
let storyParts  = [];
let hasCritical = false;

let voltMsg = '';
if (stats.minVolt !== null && Number.isFinite(stats.minVolt)) {
    if (stats.minVolt < 210)
        voltMsg = `<br><br>🔌 <b>Kritický pokles napětí sítě:</b> Napětí kleslo na ${f1(stats.minVolt)} V (zákonné minimum 207 V, ale pod 210 V hrozí poškození elektroniky TČ). Kontaktujte distributora a požadujte protokol o kvalitě sítě.`;
    else if (stats.minVolt < 215)
        voltMsg = `<br><br>⚡ <b>Pokles napětí sítě:</b> Zaznamenali jsme propad na ${f1(stats.minVolt)} V. Pokud se opakuje, může to ovlivňovat výkon TČ a urychlit opotřebení elektroniky.`;
}

// --- Standby varování ---
const standbyMsg = isHighStandby
    ? `<br><br>🔋 <b>Zvýšený klidový příkon (${Math.round(standbyAvgW)} W):</b> TČ v pohotovosti odebíralo průměrně ${Math.round(standbyAvgW)} W — to je nad normou (~10–20 W). Možné příčiny: (1) Zapnutý el. dohřev / topná patrona v zásobníku. (2) Špatně vypnutý cirkulační okruh. (3) Vadný řídicí ventil nebo relé. Zkontrolujte, zda zásobník nebo podlahové čerpadlo nezůstávají zapnuty i v noci.`
    : '';

if (isIdlingDay || isSummerMode) {
    const hasSomeTuv = (stats.tuvKwh || 0) > 0.1;
    let idleStory;
    if (!hasSomeTuv) {
        idleStory = `☀️ <b>Letní režim — TČ v klidu:</b> V tomto období TČ vůbec nemuselo topit ani ohřívat vodu. Systém byl v pohotovostním režimu. Pro životnost kompresoru je to velmi dobré.`;
    } else {
        const tuvMins = Math.round(stats.totalRunHours * 60);
        idleStory = `☀️ <b>Letní provoz — pouze ohřev TUV:</b> TČ v tomto období netopilo — veškerý chod (${tuvMins} min, ${f2(stats.tuvKwh)} kWh) byl jen ohřev teplé vody. Kompresor startoval ${stats.tuv}× — minimální opotřebení. Vše v pořádku.`;
    }
    score.story = idleStory + standbyMsg + voltMsg;
    return score;
}

if (isTransitionDay) {
    const heatingMins = Math.round(heatOnlyHours * 60);
    const hasTuv = (stats.tuvKwh || 0) > 0.1;
    const tuvNote = hasTuv
        ? ` Mimo topení proběhl ještě ohřev TUV (${f2(stats.tuvKwh)} kWh).`
        : '';
    let transitionStory;
    let transitionOk = true;

    if (stateZ === 'Z4') {
        transitionStory = `⚠️ <b>Přechodné období s problémem — agresivní cyklování:</b> TČ topilo jen ${heatingMins} min (${f1(avgTempForPeriod)} °C venku), ale ve špičce startovalo ${f1(maxSph)}× za hodinu.${tuvNote} I při krátkém provozu to opotřebovává kompresor. Zkontrolujte termohlavice a ekvitermní křivku.`;
        transitionOk = false;
    } else if (heatingMins === 0 && hasTuv) {
        // TUV-only den ale nesplnil isSummerMode (má topné kWh z defrostu/oil apod.)
        transitionStory = `☀️ <b>Prakticky letní den — jen ohřev TUV:</b> Venku ${f1(avgTempForPeriod)} °C. Samotné topení neběželo, TČ jen ohřálo vodu (${f2(stats.tuvKwh)} kWh, ${stats.tuv}× start). Vše v pořádku.`;
    } else if (stats.heatKwh < 0.5 && stats.netStarts <= 2) {
        transitionStory = `✅ <b>Přechodné období — minimální topení:</b> Venku ${f1(avgTempForPeriod)} °C, TČ kratce dohřálo dům (${heatingMins} min, ${f2(stats.heatKwh)} kWh).${tuvNote} Takto malá potřeba tepla je zcela normální — systém funguje přesně jak má.`;
    } else if (stateZ === 'Z3' || stateZ === 'Z2') {
        transitionStory = `🟡 <b>Přechodné období — drobné cvrnkání:</b> Při ${f1(avgTempForPeriod)} °C venku TČ topilo ${heatingMins} min a startovalo ${Math.round(maxSph * 10) / 10}× za hodinu ve špičce.${tuvNote} Inverterové TČ na minimu svého výkonu — nejde o poruchu, ale ekvitermní křivku by šlo snížit o 1–2 °C pro plynulejší chod.`;
        transitionOk = false;
    } else {
        transitionStory = `✅ <b>Přechodné období:</b> Venku ${f1(avgTempForPeriod)} °C — dům potřeboval jen malý přídavek tepla. TČ topilo ${heatingMins} min (${f2(stats.heatKwh)} kWh), max. ${f1(maxSph)} start/hod.${tuvNote} Provoz je v pořádku.`;
    }

    // score.efficiency: NEOVERRIDUJ — normCop výsledek je fyzikálně správný
    // (dřívější cap na 65 kolidoval s normCop systémem)
    score.health      = transitionOk ? 100 : score.health;
    score.smoothness  = transitionOk ? 100 : score.smoothness;
    score.load        = 100;

    score.story = transitionStory + standbyMsg + voltMsg;
    return score;
}

// --- KRITICKÁ PŘEPSÁNÍ ---

if (stateZ === 'Z4') {
    const si = shortRatio > 0 ? `, z toho ${Math.round(shortRatio * 100)} % kratších než ${(config.durations && config.durations.minRun) ? config.durations.minRun : 5} min` : '';
    storyParts.push(
        `⚠️ <b>KRITICKÝ STAV — Agresivní cyklování kompresoru:</b> TČ startovalo ve špičce <b>${f1(maxSph)}× za hodinu</b>${si}. ` +
        `Inverterové TČ musí plynule modulovat výkon — takto časté starty drasticky zkracují životnost kompresoru.<br>` +
        `<b>Nejpravděpodobnější příčiny:</b> (1) Termohlavice jsou uzavřeny nebo přikrouceny — otevřete všechny naplno. ` +
        `(2) Ucpaný vodní filtr na primárním okruhu. ` +
        `(3) Ekvitermní křivka příliš vysoká — dům se přehřeje rychle a TČ musí znovu startovat. Zkuste snížit o 2–3 °C.`
    );
    hasCritical = true;
}

if (!hasCritical && normCop < 0.70 && stats.heatKwh > 3) {
    storyParts.push(
        `🔴 <b>MOŽNÁ PORUCHA — Nízká efektivita topení:</b> COP topení (${f2(realCop)}) je výrazně pod očekáváním. ` +
        `Možné příčiny: znečistěný výparník, únik chladiva nebo hydraulický problém. Doporučujeme servisní kontrolu.`
    );
    hasCritical = true;
}

if (!hasCritical && stateR === 'R5') {
    storyParts.push(
        `⚠️ <b>TČ na absolutním kapacitním limitu:</b> Čerpadlo pracovalo <b>${Math.round(dutyCycle)} % doby</b> ` +
        `při využití <b>${Math.round(capacityUsed * 100)} % tepelného výkonu</b> (venkovní teplota ${f1(avgTemp)} °C). ` +
        `Při takové teplotě by správně navržený systém měl mít výkonovou rezervu. ` +
        `Možné příčiny: TČ je podimenzováno, nebo ekvitermní křivka nastavena zbytečně vysoko.`
    );
    hasCritical = true;
}

// --- VELKÁ VAROVÁNÍ ---
if (!hasCritical) {
    if (defrostCtx.state === 'D2') {
        storyParts.push(
            `⚠️ <b>Odmrazy mimo sezónu (${f1(avgTemp)} °C):</b> TČ odmrazovalo při teplotě, kde k namrzání normálně nedochází. ` +
            `Příčiny: (1) Znečistěný výparník — blokuje průtok vzduchu. ` +
            `(2) Porucha odmrazovacího senzoru. ` +
            `(3) Odtávající voda zamrzá a opakovaně spouští odmraz.`
        );
    }
    if (normCop < 0.82 && normCop >= 0.70 && stats.heatKwh > 3) {
        storyParts.push(
            (storyParts.length > 0 ? '<br><br>' : '') +
            `⚠️ <b>Mírně snížená efektivita topení:</b> COP topení (${f2(realCop)}) je pod očekáváním. ` +
            `Možné příčiny: (1) Ekvitermní křivka příliš vysoko (~${Math.round(heatLWT)} °C) — zkuste snížit o 2 °C. ` +
            `(2) Hydraulický bypass. (3) Příliš rychlý průtok oběhového čerpadla.`
        );
    }
    if (stateR === 'R3') {
        storyParts.push(
            (storyParts.length > 0 ? '<br><br>' : '') +
            `⚠️ <b>TČ pracuje naplno i v relativně teplém počasí (${f1(avgTemp)} °C):</b> ` +
            `Využití ${Math.round(dutyCycle)} % doby a ${Math.round(capacityUsed * 100)} % výkonu je varovný signál. ` +
            `Příčiny: netěsnosti domu nebo ekvitermní křivka nastavena zbytečně vysoko.`
        );
    }
    if (copTrend.state === 'T3') {
        const pctDrop = Math.abs(Math.round(copTrend.changePercent));
        storyParts.push(
            (storyParts.length > 0 ? '<br><br>' : '') +
            `📉 <b>Výrazný pokles COP (teplotně korigovaný −${pctDrop} % za ~14 dní):</b> ` +
            `Z ${f2(copTrend.oldCop)} na ${f2(copTrend.newCop)}. Možná počínající porucha — zvažte servisní kontrolu.`
        );
    }
    if (defrostCtx.state === 'D3') {
        storyParts.push(
            (storyParts.length > 0 ? '<br><br>' : '') +
            `⚠️ <b>Příliš časté odmrazy (${f1(avgTemp)} °C):</b> ` +
            `${stats.defrosts}× odmraz (${f1((defrostCtx.defrostsPerRunHour || 0) * 60)} odmrazů/hod, ` +
            `norma max. ${f1((defrostCtx.expectedPerHour || 0) * 60)}/hod). Příčina: znečistění výparníku nebo porucha čidla.`
        );
    }
}

// --- KONTEXTOVÁ VYSVĚTLENÍ ---
if (!hasCritical) {

    // Cvrnkání
    if (storyParts.length === 0 && (stateP === 'P3' || (stateZ !== 'Z1' && avgTemp > 8))) {
        storyParts.push(
            `ℹ️ <b>Přechodné období — fyzikální minimum TČ:</b> Čerpadlo se ocitá na nejnižším možném výkonu, ` +
            `ale dům aktuálně potřebuje méně tepla. Vzniká tzv. „cvrnkání". <u>Nejde o poruchu</u>, ale je to energeticky neefektivní. ` +
            `Řešení: snížit ekvitermní křivku o 1–2 °C, nebo nastavit časový program topení.`
        );
    }

    // Fyzikálně nutné odmrazy
    else if (storyParts.length === 0 && (stateU === 'U3' || defrostCtx.state === 'D1') && avgTemp < 3 && stats.defrosts > 0) {
        const defPerHour = (stats.totalRunHours > 0 && stats.defrosts > 0) ? f1(stats.totalRunHours / stats.defrosts) : '?';
        const defPct = defrostRatio * 100;
        const defrostEffMsg = defPct > 10
            ? `⚠️ Ztráty odmrazováním tvoří ${pctStr(defPct)} tepelné produkce — výrazně přes 10 %, zkontrolujte čistotu výparníku.`
            : `✅ Ztráty odmrazováním tvoří jen ${pctStr(defPct)} tepelné produkce. Odmrazování probíhá efektivně.`;
        storyParts.push(
            `ℹ️ <b>Sychravé zimní počasí (${f1(avgTemp)} °C):</b> ${stats.defrosts} odmrazovacích cyklů ` +
            `(cca 1 odmraz za každé ${defPerHour} h chodu kompresoru) jsou fyzikálně nutné. ` +
            defrostEffMsg
        );
    }

    else if (storyParts.length === 0 && stateU === 'U2') {
        const tuv = analyzeTuvContext(stats, config);

        const header =
            `ℹ️ <b>Dnešní účinnost ovlivněna ohřevem TUV (${Math.round(tuvRatio * 100)} % spotřeby):</b> ` +
            `TUV vyžaduje ~${Math.round(tuvLWT)} °C místo ~${Math.round(heatLWT)} °C pro vytápění — ` +
            `vyšší teplota = nižší COP. ` +
            `COP TUV: ${f2(tuv.copTuv)}, COP topení: ${f2(tuv.copHeat)}.` +
            `<br><br><b>Analýza TUV cyklů:</b> `;

        let detail = '';

        if (tuv.state === 'TUV_NONE') {
            detail = `Spotřeba TUV evidována, ale cykly nebyly detekovány. Zkontrolujte detekční prahy.`;
        }
        else if (tuv.state === 'ONCE') {
            if (tuv.durState === 'VERY_SHORT') {
                detail =
                    `TUV ohřev proběhl <b>1× za pouhých ~${tuv.estMinPerCycle} min (${f2(tuv.kwPerCycle)} kWh)</b>. ` +
                    `Zásobník se jen přitopil o pár stupňů — hystereze teplotního spínače je pravděpodobně příliš malá. ` +
                    `Tank klesne o 3–5 °C a ihned startuje ohřev. ` +
                    `Zvažte zvýšit hysterezi: jeden delší denní ohřev je efektivnější než opakované krátké přihřívání.`;
            } else if (tuv.durState === 'SHORT') {
                detail =
                    `TUV ohřev proběhl <b>1× za ~${tuv.estMinPerCycle} min (${f2(tuv.kwPerCycle)} kWh)</b>. ` +
                    `Zásobník byl ještě relativně teplý — šlo o parciální dohřev. To je v pořádku.`;
            } else if (tuv.durState === 'NORMAL') {
                detail =
                    `TUV ohřev proběhl <b>1× za ~${tuv.estMinPerCycle} min (${f2(tuv.kwPerCycle)} kWh)</b> — ` +
                    `<b>ideální provoz.</b> Jeden plný denní ohřev minimalizuje počet startů kompresoru.`;
            } else { // LONG
                const longNote = tuv.kwPerCycle > 5.5
                    ? `Pravděpodobně anti-legionella cyklus nebo velký zásobník (nad 250 l). `
                    : `Zásobník byl výrazněji vychladlý nebo domácnost měla velkou spotřebu. `;
                detail =
                    `TUV ohřev proběhl <b>1× za ~${tuv.estMinPerCycle} min (${f2(tuv.kwPerCycle)} kWh)</b>. ` +
                    longNote + `To je v pořádku.`;
            }
        }
        else if (tuv.state === 'TWICE') {
            if (tuv.durState === 'VERY_SHORT') {
                detail =
                    `TUV ohřev proběhl <b>2× za ~${tuv.estMinPerCycle} min každý (celkem ${f2(tuv.totalKwh)} kWh)</b>. ` +
                    `Oba cykly jsou krátké — zásobník se jen rychle přitopl, nikdy pořádně nevychladne. ` +
                    `Hystereze je nastavena příliš malá. Jeden delší denní ohřev je efektivnější.`;
            } else {
                detail =
                    `TUV ohřev proběhl <b>2× za ~${tuv.estMinPerCycle} min každý ` +
                    `(celkem ~${tuv.estMinPerCycle * 2} min, ${f2(tuv.totalKwh)} kWh)</b>. ` +
                    `Dvakrát denně bývá vzorec ráno + večer — funguje, ale jeden delší odpolední ohřev je efektivnější: ` +
                    `TČ jednou nastartuje a zásobník udrží teplo až do večerní spotřeby.`;
            }
        }
        else { // FREQUENT (3+)
            detail =
                `TUV ohřívalo <b>${tuv.count}× za den</b> ` +
                `(~${tuv.estMinPerCycle} min/cyklus, ${f2(tuv.kwPerCycle)} kWh/cyklus, ` +
                `celkem ${f2(tuv.totalKwh)} kWh) — <b>to je příliš časté.</b> ` +
                `Každý zbytečný start zvyšuje spotřebu a opotřebení kompresoru. ` +
                `<b>Možné příčiny:</b> ` +
                `(1) Hystereze zásobníku příliš malá — klesne o pár stupňů a ihned startuje. Zvyšte ji. ` +
                `(2) Špatná tepelná izolace zásobníku — rychle ztrácí teplo. ` +
                `(3) Cirkulace teplé vody příliš aktivní — zkraťte dobu jejího chodu. ` +
                `(4) Zásobník je pro domácnost příliš malý. ` +
                `Optimum: 1–2 ohřevy denně.`;
        }

        let timingDetail = '';

        if (tuv.timingHint === 'OK') {
            const fvNote = tuv.totalKwh > 1.5
                ? ` Pokud máte fotovoltaiku, zvažte posun na sluneční špičku (10–13 h).`
                : ``;
            timingDetail =
                `<br><br>⏰ <b>Timing ohřevu: ✓</b> ` +
                `Poměr COP TUV / COP topení odpovídá ohřevu v optimálním denním čase.` + fvNote;
        }
        else if (tuv.timingHint === 'SUBOPTIMAL') {
            timingDetail =
                `<br><br>⏰ <b>Timing ohřevu — drobná poznámka:</b> ` +
                `COP TUV (${f2(tuv.copTuv)}) vs. COP topení (${f2(tuv.copHeat)}) — ` +
                `po fyzikální korekci na rozdíl teplot ohřevu je poměr mírně nižší než norma. ` +
                `Naznačuje ohřev v dopoledních hodinách. ` +
                `Pokud je to možné, přesuňte ohřev na <b>13–15 h</b>` +
                ` (nebo <b>10–13 h</b> při fotovoltaice).`;
        }
        else if (tuv.timingHint === 'NIGHT') {
            const savingKwh = Math.round((0.4 / Math.max(0.1, tuv.copTuv)) * tuv.totalKwh * 10) / 10;
            timingDetail =
                `<br><br>⏰ <b>Podezření na nevhodný timing ohřevu (noční/ranní):</b> ` +
                `COP TUV výrazně pod fyzikálním očekáváním pro tuto kombinaci teplot. ` +
                `Naznačuje ohřev při chladnějších podmínkách než je průměr dne. ` +
                `Přesunutím na <b>13–15 h</b> (nebo <b>10–13 h</b> při FV) lze COP TUV ` +
                `zlepšit o 0.3–0.5 bodu — přibližně ${savingKwh} kWh ušetřených denně.` +
                `<br><i>ℹ️ Pokud máte DVT tarif: noční ohřev je levnější za kWh, ale s horším COP. ` +
                `Při ceně elektřiny nad 3 Kč/kWh se odpolední ohřev obvykle vyplatí i bez DVT výhody.</i>`;
        }
        else {
            timingDetail =
                `<br><br>⏰ <b>Doporučení pro timing ohřevu:</b> ` +
                `Ideální čas je <b>13–15 h</b> — venkovní teploty jsou nejvyšší a COP nejlepší. ` +
                `Pokud máte fotovoltaiku, posuňte ohřev na sluneční špičku (<b>10–13 h</b>).`;
        }

        storyParts.push(header + detail + timingDetail);
    }

    // R4 — na limitu v zimě
    if (stateR === 'R4' && storyParts.length < 2) {
        storyParts.push(
            (storyParts.length > 0 ? '<br><br>' : '') +
            `ℹ️ <b>Blízkost kapacitního limitu v zimě (${f1(avgTemp)} °C):</b> ` +
            `TČ pracovalo na ${Math.round(dutyCycle)} % doby s využitím ${Math.round(capacityUsed * 100)} % výkonu. ` +
            `Přijatelný stav, ale bez rezervy. ` +
            `Při teplotách pod ${f1(avgTemp - 3)} °C pravděpodobně nastoupí přitápěcí patrona.`
        );
    }

    // normCop ≥ 0.92 v mrazivém počasí — dobrý výkon
    if ((stateU === 'U1c' || stateU === 'U1b') && avgTemp < 2 && storyParts.length === 0) {
        storyParts.push(
            `✅ <b>Dobrý výkon v mrazivém počasí (${f1(avgTemp)} °C):</b> ` +
            `COP topení ${f2(realCop)} — systém dosahuje očekávaného výkonu i při nízké teplotě. ` +
            `Vzduch-voda TČ fyzikálně ztrácí výkon s klesající teplotou — váš systém se drží velmi dobře.`
        );
    }
}

// --- STANDARDNÍ KOMBINACE ---
if (storyParts.length === 0) {
    if (stateZ === 'Z1' && stateP === 'P1' && (stateU === 'U1' || stateU === 'U1c')) {
        storyParts.push(
            `✅ <b>Vzorový provoz:</b> TČ dnes pracovalo v ideálním režimu. ` +
            `Plynule modulovalo výkon (${pctStr(lowMod)} doby v nízkém pásmu), průměrný běh ${Math.round(avgRun)} min, ` +
            `maximálně ${f1(maxSph)} start/hod. ` +
            `COP topení ${f2(realCop)} při ${f1(avgTemp)} °C.`
        );
    } else if (stateZ === 'Z1' && stateP === 'P2') {
        storyParts.push(
            `✅ <b>Dobrý provoz:</b> Zdravé cyklování (max. ${f1(maxSph)} start/hod) s přijatelnou modulací. ` +
            `COP topení ${f2(realCop)} při ${f1(avgTemp)} °C.`
        );
    } else if (stateZ === 'Z2') {
        storyParts.push(
            `⚠️ <b>Mírně zvýšené cyklování:</b> Max. ${f1(maxSph)} start/hod ` +
            `${shortRatio > 0.05 ? `a ${Math.round(shortRatio * 100)} % krátkých cyklů ` : ''}` +
            `je nad optimem pro inverterové TČ. Zkontrolujte termohlavice a průtok oběhového čerpadla.`
        );
    } else if (stateZ === 'Z3') {
        storyParts.push(
            `⚠️ <b>Problematické cyklování:</b> TČ startuje příliš často ` +
            `(max. ${f1(maxSph)}/hod${shortRatio > 0.15 ? `, ${Math.round(shortRatio * 100)} % krátkých cyklů` : ''}). ` +
            `Zkontrolujte termohlavice, průtok a nastavení ekvitermní křivky.`
        );
    } else if (stateP === 'P4') {
        storyParts.push(
            `⚠️ <b>Špatná modulace v zimě (${f1(avgTemp)} °C):</b> ` +
            `Průměrný běh jen ${Math.round(avgRun)} min s modulací v nízkém pásmu ${pctStr(lowMod)} doby. ` +
            `TČ by při těchto podmínkách mělo jet v dlouhých plynulých cyklech. ` +
            `Pravděpodobná příčina: topná křivka příliš vysoká — dům se přetopí rychle a čerpadlo se musí zastavit.`
        );
    } else {
        storyParts.push(
            `✅ <b>Standardní provoz:</b> Systém funguje v normálním provozním pásmu. ` +
            `COP ${f2(realCop)}, modulace v nízkém pásmu ${pctStr(lowMod)} doby, průměrný běh ${Math.round(avgRun)} min.`
        );
    }
}

// --- DOPLŇKOVÉ POZNÁMKY ---
if (!hasCritical) {
    if (copTrend.state === 'T2') {
        const pctDrop = Math.abs(Math.round(copTrend.changePercent));
        storyParts.push(
            `<br><br>📉 <b>Mírný pokles COP v posledních ~14 dnech (−${pctDrop} %, teplotně korigováno):</b> ` +
            `Zatím v pásmu sledování. Pokud trend pokračuje, zvažte kontrolu výparníku nebo servisní prohlídku.`
        );
    }
    if (stateR === 'R1') {
        storyParts.push(
            `<br><br>💪 <b>Velká kapacitní rezerva:</b> TČ využívalo jen ` +
            `${Math.round(capacityUsed * 100)} % svého tepelného výkonu při ${f1(avgTemp)} °C — ` +
            `systém má silnou rezervu pro chladnější dny.`
        );
    }
}

// Zdravotní stav ze dne — přidej zmínku pokud není zelený
// (doplňuje existující cyklování-texty o přímý odkaz na barvu v kalendáři)
if (stats.health && stats.health.code !== 'green' && stats.health.code !== undefined) {
    const hMap = {
        yellow: { ico: '🟡', adj: 'mírně zvýšené', tip: 'Zkontroluj nastavení hystereze nebo délku cyklů.' },
        orange: { ico: '🟠', adj: 'zvýšené',        tip: 'Doporučuji prověřit hydrauliku nebo nastavení regulace.' },
        red:    { ico: '🔴', adj: 'kriticky vysoké', tip: 'Nutná kontrola — časté starty výrazně zkracují životnost.' }
    };
    const h = hMap[stats.health.code];
    if (h && !storyParts.some(s => s.includes('cyklování') || s.includes('Agresivní') || s.includes('startuje'))) {
        storyParts.push(
            (storyParts.length > 0 ? '<br><br>' : '') +
            `${h.ico} <b>Zdravotní stav — ${h.adj} cyklování:</b> ` +
            `Dnešní provoz odpovídá žluté barvě v kalendáři. ${h.tip}`
        );
    }
}
score.story = storyParts.join('') + standbyMsg + voltMsg;
return score;
}

// =============================================================================
//  ZDRAVÍ PRO KALENDÁŘOVOU HEATMAPU
// =============================================================================
// ─── SEKCE 6: ZDRAVÍ SYSTÉMU (dailyHealth) ───────────────────────────────────

function evaluateHealth(netStarts, shorts, totalHours = 24, month = -1) {
const daysCount       = totalHours > 0 ? (totalHours / 24) : 1;
const avgStartsPerDay = netStarts / daysCount;
const avgShortsPerDay = shorts    / daysCount;

// Sezonní prahy: v létě TČ topí jen TUV → méně startů = norma
// Topná sezona (říjen–duben, month 0-3 a 9-11): vyšší tolerované starty
// Letní provoz (květen–září, month 4-8): nižší prahy
const isSummer = month >= 4 && month <= 8;
const redS    = isSummer ? 8  : 20; // červená: příliš mnoho startů
const orangeS = isSummer ? 5  : 12; // oranžová: zvýšené
const yellowS = isSummer ? 3  :  7; // žlutá: mírně zvýšené

if (avgShortsPerDay >= 2 || avgStartsPerDay >= redS)
    return { code: 'red',    class: 'st-crit',   color: 'var(--danger)' };
if (avgShortsPerDay >= 1 || avgStartsPerDay >= orangeS)
    return { code: 'orange', class: 'st-orange',  color: '#f97316' };
if (avgStartsPerDay >= yellowS)
    return { code: 'yellow', class: 'st-warn',    color: '#eab308' };
return { code: 'green',  class: 'st-ideal',   color: 'var(--success)' };
}

self.onmessage = async function (e) {
const { type, jobId, text, config, startTs, endTs, prefetchDates, exportType, includeSummary } = e.data;

if (type === 'CLEAR_CACHE') {
    memCache = null;
    return;
}

if (config && config.system && config.system.hpMatrix) {
    parseCopData(config.system.hpMatrix);
}

// Pojmenované výchozí konstanty (fallbacky) — hodnoty zachovány beze změny
const DEFAULT_STANDBY_W = 145;        // výchozí klidový příkon [W], když nejsou data o standby
const DEFAULT_THERMAL_POWER_W = 2400; // výchozí tepelný výkon TČ [W] pro odhad doby chodu
const MIN_THERMAL_POWER_W = 1800;     // minimální věrohodný tepelný výkon [W] — pod ním fallback
const FALLBACK_MONTHLY_COP = 4.0;     // výchozí měsíční COP, když chybí v dynamicMonthlyCop

if (type === 'GENERATE_EXPORT') {
    if (!memCache) {
        self.postMessage({ type: 'EXPORT_RESULT', jobId, textDisplay: 'Chyba: Žádná data v paměti.' });
        return;
    }

    const sStats = memCache.globalMetrics.seasonalStats;
    let globHeatWh = 0, globTuvWh = 0, globHeatTpWh = 0, globTuvTpWh = 0, globHdd = 0, globTWh = 0;
    let globStandbyWh = 0, globStandbyHours = 0;
    let globTotalHours = 0;
    let globDefrostWh = 0;
    let tempSum = 0, tempCount = 0, minTs = 9999999999, maxTs = 0;
    
    Object.values(sStats).forEach(b => {
        globTWh += (b.tWh || 0);
        globHeatWh += (b.hWh || 0);
        globTuvWh += (b.tuWh || 0);
        globHeatTpWh += (b.heatTpWh || 0);
        globTuvTpWh += (b.tuvTpWh || 0);
        globHdd += (b.hdd || 0);
        globStandbyWh += (b.standbyWh || 0);
        globStandbyHours += (b.standbyHours || 0);
        globTotalHours += (b.totalHours || 0);
        globDefrostWh += (b.defrostWh || 0);
        tempSum += (b.tempSum || 0);
        tempCount += (b.tempCount || 0);
        if (b.fTs < minTs) minTs = b.fTs;
        if (b.lTs > maxTs) maxTs = b.lTs;
    });

    let vSumGlob = 0, vCountGlob = 0;
    memCache.globalMetrics.dailyStats.forEach(d => {
        if (d.minVolt !== null) {
            vSumGlob += d.minVolt;
            vCountGlob++;
        }
    });
    const globAvgMinVolt = vCountGlob > 0 ? (vSumGlob / vCountGlob) : null;

    let recentStandbyW = 0;
    const daily = memCache.globalMetrics.dailyStats;
    if (daily && daily.length > 0) {
        const trendDays = config.system.trendDays || 7;
        const recentDays = daily.slice(-trendDays);
        let rStWh = 0, rStHrs = 0;
        recentDays.forEach(d => {
            rStWh += (d.standbyWh || 0);
            rStHrs += (d.standbyHours || 0);
        });
        if (rStHrs > 0) recentStandbyW = rStWh / rStHrs;
    }

    let avgStandbyW = recentStandbyW > 0 ? recentStandbyW : (globStandbyHours > 0 ? globStandbyWh / globStandbyHours : DEFAULT_STANDBY_W);
    // Sanity guard: standby musí být konečný a nezáporný, jinak výchozí hodnota
    if (!Number.isFinite(avgStandbyW) || avgStandbyW < 0) avgStandbyW = DEFAULT_STANDBY_W;

    const gainW_zima = (memCache.physics && memCache.physics.dynamicGainW_zima !== undefined) ? memCache.physics.dynamicGainW_zima : (config.internalGainW || 0);
    const gainW_prechod = (memCache.physics && memCache.physics.dynamicGainW_prechod !== undefined) ? memCache.physics.dynamicGainW_prechod : (config.internalGainW || 0);
    
    const houseK_Total = memCache.physics ? memCache.physics.k_zima : 0; 
    const loss_Total = houseK_Total * (config.targetIndoorTemp - config.designTemp);
    const area = config.floorArea || 100;

    const loss_HP = loss_Total > 0 ? Math.max(0, loss_Total - gainW_zima) : 0;
    const wm2_HP = loss_HP / area;

    const bivalence = calculateExactBivalence(houseK_Total, memCache.maxTcCurve, config.targetIndoorTemp, gainW_zima);
    let overallEfficiency = globHdd > 0 ? (globHeatWh / 1000) / globHdd : 0;
    // Sanity guard: měrná spotřeba kWh/HDD musí být konečná a nezáporná, jinak výchozí 0
    if (!Number.isFinite(overallEfficiency) || overallEfficiency < 0) overallEfficiency = 0;

    let days = (maxTs - minTs) / 86400; if (days < 1) days = 1;
    const avgTuvKwh = (globTuvWh / 1000) / days;
    const avgTuvThermalWh = days > 0 ? globTuvTpWh / days : 0;
    // „Letní data" = chybí model budovy (fyzika) nebo je topení zanedbatelné.
    // Roční odhad stojí na fyzice budovy + klimatických normálech (evanTemps),
    // takže NEZÁVISÍ na tom, zda log obsahuje léto. Dřív se chybně posuzovalo
    // podle průměrné teploty CELÉHO logu — ta u datasetu zima+léto klamně
    // přeroste práh a zablokuje odhad, i když je k dispozici celá zima dat.
    const isSummerData = !memCache.physics || (globTWh > 0 && (globHeatWh / globTWh) < 0.3);

    let totalRunTimeHours = 0;
    Object.values(sStats).forEach(b => { totalRunTimeHours += (b.runTimeHours || 0); });
    let avgThermalPowerW = totalRunTimeHours > 0 ? (globHeatTpWh / totalRunTimeHours) : DEFAULT_THERMAL_POWER_W;
    // Sanity guard: tepelný výkon musí být konečný a nad minimem, jinak výchozí hodnota
    if (!Number.isFinite(avgThermalPowerW) || avgThermalPowerW < MIN_THERMAL_POWER_W) avgThermalPowerW = DEFAULT_THERMAL_POWER_W;

    let yearlyHeatWhEl = 0, yearlyHeatWhThermal = 0;
    let yearlyTuvWhEl = 0, yearlyTuvWhThermal = 0;
    let estRunHours = 0;
    let modelYearHdd = 0;

    config.evanTemps.forEach((tOut, index) => {
        const daysInMonth = config.estimations.monthDays;
        
        let monthTuvCop = estimateCOP(tOut, true, config);
        let monthTuvThermalWh = avgTuvThermalWh * daysInMonth * config.estimations.tuvLoss;
        if(monthTuvThermalWh === 0 && avgTuvKwh > 0) monthTuvThermalWh = avgTuvKwh * 1000 * monthTuvCop * daysInMonth * config.estimations.tuvLoss;
        yearlyTuvWhEl += (monthTuvThermalWh / monthTuvCop);
        yearlyTuvWhThermal += monthTuvThermalWh;
        estRunHours += (monthTuvThermalWh / 3500); 

        if (tOut < config.heatingThreshold && memCache.physics) {
            const mDiff = config.targetIndoorTemp - tOut;
            const usedK = (tOut < 3) ? memCache.physics.k_zima : memCache.physics.k_prechod;
            const usedGain = (tOut < 3) ? gainW_zima : gainW_prechod;
            
            let thermalReq = Math.max(0, (usedK * mDiff) - usedGain) * 24 * daysInMonth;
            const currentCop = memCache.dynamicMonthlyCop[index] || FALLBACK_MONTHLY_COP;
            yearlyHeatWhEl += (thermalReq / currentCop);
            yearlyHeatWhThermal += thermalReq;
            estRunHours += (thermalReq / avgThermalPowerW); 
            modelYearHdd += Math.max(0, config.targetIndoorTemp - tOut) * daysInMonth;
        }
    });
    
    let standbyHoursYear = Math.max(0, (365 * 24) - estRunHours);
    let yearlyStandbyWhEl = standbyHoursYear * avgStandbyW;

    const estTuvKwh = yearlyTuvWhEl / 1000;
    const totalEstElKwh = (yearlyHeatWhEl / 1000) + estTuvKwh + (yearlyStandbyWhEl / 1000);
    const totalEstThermalKwh = (yearlyHeatWhThermal / 1000) + (yearlyTuvWhThermal / 1000);
    let estScop = totalEstElKwh > 0 ? totalEstThermalKwh / totalEstElKwh : 0;
    // Sanity guard: SCOP musí být konečný a nezáporný, jinak výchozí 0
    if (!Number.isFinite(estScop) || estScop < 0) estScop = 0;

    let remainingHddRatio = modelYearHdd > 0 ? Math.max(0, 1 - ((globHdd || 0) / modelYearHdd)) : 0;
    let remainingDaysRatio = Math.max(0, 1 - (days / 365));

    let remHeatKwh = (yearlyHeatWhEl / 1000) * remainingHddRatio;
    let remTuvKwh = estTuvKwh * remainingDaysRatio;
    let remStandbyKwh = (yearlyStandbyWhEl / 1000) * remainingDaysRatio;

    let realEstKwh = (globTWh / 1000) + remHeatKwh + remTuvKwh + remStandbyKwh;

    const ltCopMix = globTWh > 0 ? (globHeatTpWh + globTuvTpWh) / globTWh : 0;
    const ltCopHeat = globHeatWh > 0 ? globHeatTpWh / globHeatWh : 0;
    const ltCopTuv = globTuvWh > 0 ? globTuvTpWh / globTuvWh : 0;

    const formatD = (ts) => { const dt = new Date(ts * 1000); return `${dt.getDate()}.${dt.getMonth() + 1}.${dt.getFullYear()}`; };
    const formatDays = (d) => { if (d === 1) return 'den'; if (d >= 2 && d <= 4) return 'dny'; return 'dní'; };

    let headerLines = [];

    if (includeSummary) {
        const globalDaysRounded = Math.round(days);
        const histStart = minTs !== 9999999999 ? formatD(minTs) : '-';
        const histEnd = maxTs !== 0 ? formatD(maxTs) : '-';
        const dateNowStr = new Date().toLocaleString('cs-CZ');

        const curveText = `${config.curve.lwtMin.toFixed(1).replace('.', ',')} °C (při ${config.curve.tOutMax.toFixed(1).replace('.', ',')} °C) až ${config.curve.lwtMax.toFixed(1).replace('.', ',')} °C (při ${config.curve.tOutMin.toFixed(1).replace('.', ',')} °C)`;
        
        let heatingDays = memCache.globalMetrics.dailyStats.filter(d => d.heatWh > 0 && d.tempCount > 0);
        heatingDays.sort((a, b) => (b.tempSum / b.tempCount) - (a.tempSum / a.tempCount));
        let boundaryTempStr = "-";
        if (heatingDays.length > 0) {
            let topCount = Math.max(1, Math.ceil(heatingDays.length * 0.05));
            let sumT = 0;
            for(let i = 0; i < topCount; i++) sumT += (heatingDays[i].tempSum / heatingDays[i].tempCount);
            boundaryTempStr = (sumT / topCount).toFixed(1).replace('.', ',') + " °C";
        }

        let minModP = Infinity;
        let minModTp = 0;
        let currentSegStart = -1;
        const typesArr = memCache.analysis.types;
        const dataArr = memCache.filledData;

        for (let i = 0; i < dataArr.length; i++) {
            if (typesArr[i] === TYPE.HEAT_STD || typesArr[i] === TYPE.HEAT_ECO) {
                if (currentSegStart === -1) currentSegStart = i;
            } else {
                if (currentSegStart !== -1) {
                    let durMins = (dataArr[i-1].ts - dataArr[currentSegStart].ts) / 60;
                    if (durMins >= 50) {
                        let sumP = 0, sumTp = 0, count = 0;
                        for(let j = currentSegStart; j < i; j++) { sumP += dataArr[j].p; sumTp += dataArr[j].tp || 0; count++; }
                        let avgP = sumP / count;
                        if (avgP < minModP && avgP > 100) { minModP = avgP; minModTp = sumTp / count; }
                    }
                    currentSegStart = -1;
                }
            }
        }
        
        if (currentSegStart !== -1) {
            let durMins = (dataArr[dataArr.length-1].ts - dataArr[currentSegStart].ts) / 60;
            if (durMins >= 50) {
                let sumP = 0, sumTp = 0, count = 0;
                for(let j = currentSegStart; j < dataArr.length; j++) { sumP += dataArr[j].p; sumTp += dataArr[j].tp || 0; count++; }
                let avgP = sumP / count;
                if (avgP < minModP && avgP > 100) { minModP = avgP; minModTp = sumTp / count; }
            }
        }
        let modStr = minModP !== Infinity ? `${Math.round(minModP)} W el. / cca ${Math.round(minModTp)} W teplo` : "Nedostatek plynulých dat";

        let coldDays = 0, coldStarts = 0, coldTuv = 0, coldDefrost = 0, coldHeatHrs = 0, coldHeatRuns = 0;
        let warmDays = 0, warmStarts = 0, warmTuv = 0, warmDefrost = 0, warmHeatHrs = 0, warmHeatRuns = 0;

        memCache.globalMetrics.dailyStats.forEach(d => {
            if (d.tempCount === 0) return;
            let avgT = d.tempSum / d.tempCount;
            if (avgT < 3) { 
                coldDays++; coldStarts += d.netStarts; coldTuv += d.tuvRuns; coldDefrost += d.defrostRuns; coldHeatHrs += d.runTimeHours; coldHeatRuns += d.heatRuns;
            } else {
                warmDays++; warmStarts += d.netStarts; warmTuv += d.tuvRuns; warmDefrost += d.defrostRuns; warmHeatHrs += d.runTimeHours; warmHeatRuns += d.heatRuns;
            }
        });

        const formatBucket = (days, starts, tuv, defr, hHrs, hRuns) => {
            if (days === 0) return "Žádná data v tomto pásmu";
            let avgRun = hRuns > 0 ? Math.round((hHrs * 60) / hRuns) : 0;
            let avgStarts = (starts / days).toFixed(1).replace('.', ',');
            let avgTuv = (tuv / days).toFixed(1).replace('.', ',');
            let avgDefr = (defr / days).toFixed(1).replace('.', ',');
            return `Ø běh ${avgRun} min, průměrně ${avgStarts} startů / den (plus ${avgTuv}x TUV a ${avgDefr}x Defrost)`;
        };

        headerLines.push("=================================================");
        headerLines.push("       TČ EXPERT PRO - EXPORT DAT PROVOZU        ");
        headerLines.push(`       (Generováno: ${dateNowStr})`);
        headerLines.push("=================================================");
        headerLines.push(" INFORMACE O SYSTÉMU A FYZIKA BUDOVY");
        headerLines.push("-------------------------------------------------");
        headerLines.push(`Typ čerpadla:        ${config.system.hpName}`);
        headerLines.push(`Vytápěná plocha:     ${area} m²`);
        headerLines.push(`Nastavená křivka:    ${curveText}`);
        headerLines.push(`Bod rovnováhy z dat: ${boundaryTempStr}`);
        headerLines.push(`Minimální modulace:  ${modStr}`);
        headerLines.push(`Průměrný Standby:    ${Math.round(avgStandbyW)} W`);
        if (memCache.physics) {
            headerLines.push(`Interní zisky zima:  ${Math.round(gainW_zima)} W ${memCache.physics.isFallbackZima ? '(Pevné)' : '(Vypočtené)'}`);
            headerLines.push(`Interní zisky přech.:${Math.round(gainW_prechod)} W ${memCache.physics.isFallbackPrechod ? '(Pevné)' : '(Vypočtené)'}`);
            headerLines.push(`Ztráta - zima (<3°C):${memCache.physics.k_zima > 0 ? Math.round(memCache.physics.k_zima) + ' W/K' : 'Málo dat'}`);
            headerLines.push(`Ztráta - přechod:    ${memCache.physics.k_prechod > 0 ? Math.round(memCache.physics.k_prechod) + ' W/K' : 'Málo dat'}`);
        }
        headerLines.push(`Tepelná ztráta domu: ${loss_Total > 0 ? Math.round(loss_Total) + ' W (při ' + config.designTemp + ' °C)' : 'Málo dat'}`);
        headerLines.push(`Zátěž TČ (zima):     ${loss_HP > 0 ? Math.round(loss_HP) + ' W (při ' + config.designTemp + ' °C)' : 'Málo dat'}`);
        headerLines.push(`Měrná zátěž TČ:      ${loss_HP > 0 ? wm2_HP.toFixed(1) + ' W/m²' : 'Málo dat'}`);
        headerLines.push(`Odhad bivalence:     ${bivalence !== null ? ' ' + bivalence.toFixed(1).replace('.', ',') + ' °C' : ' Málo dat'}`);
        
        headerLines.push("-------------------------------------------------");
        headerLines.push(` REÁLNÁ DATA ZA ZAZNAMENANOU HISTORII`);
        headerLines.push(` (Od ${histStart} do ${histEnd}, celkem ${globalDaysRounded} ${formatDays(globalDaysRounded)})`);
        headerLines.push("-------------------------------------------------");
        headerLines.push(`Celková spotřeba el.:${Math.round(globTWh/1000)} kWh (${Math.round((globTWh/1000) * config.priceKwh)} Kč)`);
        headerLines.push(`Z toho Topení:       ${Math.round(globHeatWh/1000)} kWh`);
        headerLines.push(`Z toho TUV:          ${Math.round(globTuvWh/1000)} kWh`);
        headerLines.push(`Dodané teplo celkem: ${Math.round((globHeatTpWh + globTuvTpWh) / 1000)} kWh`);
        headerLines.push(`Z toho Topení:       ${Math.round(globHeatTpWh / 1000)} kWh`);
        headerLines.push(`Z toho TUV:          ${Math.round(globTuvTpWh / 1000)} kWh`);
        headerLines.push(`Ztráty odtáváním:    ${Math.round(globDefrostWh / 1000)} kWh`);
        headerLines.push(`Min. napětí sítě (Ø):${globAvgMinVolt !== null ? ' ' + globAvgMinVolt.toFixed(1).replace('.', ',') + ' V' : ' -'}`);
        headerLines.push("");
        
        let histAvgTotalKwh = (globTWh/1000) / globalDaysRounded;
        let histAvgHeatKwh = (globHeatWh/1000) / globalDaysRounded;
        let histAvgTuvKwh = (globTuvWh/1000) / globalDaysRounded;
        
        headerLines.push(`Průměry na den (El): ${histAvgTotalKwh.toFixed(1).replace('.', ',')} kWh (${Math.round(histAvgTotalKwh * config.priceKwh)} Kč)`);
        headerLines.push(`z toho Topení:       ${histAvgHeatKwh.toFixed(1).replace('.', ',')} kWh`);
        headerLines.push(`z toho TUV:          ${histAvgTuvKwh.toFixed(1).replace('.', ',')} kWh`);
        headerLines.push("");
        headerLines.push(`Dlouhodobý COP MIX:  ${ltCopMix > 0 ? ltCopMix.toFixed(2).replace('.', ',') : '-'}`);
        headerLines.push(`Dlouhodobý COP Top.: ${ltCopHeat > 0 ? ltCopHeat.toFixed(2).replace('.', ',') : '-'}`);
        headerLines.push(`Dlouhodobý COP TUV:  ${ltCopTuv > 0 ? ltCopTuv.toFixed(2).replace('.', ',') : '-'}`);
        headerLines.push(`Spotřeba na 1 HDD:   ${overallEfficiency > 0 ? ' ' + overallEfficiency.toFixed(2).replace('.', ',') + ' kWh/HDD' : ' Málo dat'}`);
        headerLines.push("");
        headerLines.push(`Provoz v mrazech (< 3 °C):   ${formatBucket(coldDays, coldStarts, coldTuv, coldDefrost, coldHeatHrs, coldHeatRuns)}`);
        headerLines.push(`Přechodné období (>= 3 °C):  ${formatBucket(warmDays, warmStarts, warmTuv, warmDefrost, warmHeatHrs, warmHeatRuns)}`);

        headerLines.push("-------------------------------------------------");
        headerLines.push(` ODHAD NA CELOU TOPNOU SEZÓNU (ROK)`);
        headerLines.push("-------------------------------------------------");
        if (isSummerData) {
            headerLines.push(`Očekávaný účet:                  Nedostatek dat z topné sezóny`);
            headerLines.push(`Modelový rok:                    Nedostatek dat z topné sezóny`);
            headerLines.push(`Odhad SCOP:                      Nedostatek dat`);
        } else {
            headerLines.push(`Očekávaný účet (Realita+Odhad):   ${Math.round(realEstKwh)} kWh (${Math.round(realEstKwh * config.priceKwh)} Kč)`);
            headerLines.push(`Modelový rok (Teoretický ideál):  ${Math.round(totalEstElKwh)} kWh (${Math.round(totalEstElKwh * config.priceKwh)} Kč)`);
            headerLines.push(`Odhad SCOP (Top|Mix):             ${(yearlyHeatWhEl > 0 ? yearlyHeatWhThermal / yearlyHeatWhEl : 0).toFixed(2).replace('.', ',')} | ${estScop.toFixed(2).replace('.', ',')}`);
            headerLines.push(`Z toho Topení (Model):            ${Math.round(yearlyHeatWhEl / 1000)} kWh (${Math.round((yearlyHeatWhEl / 1000) * config.priceKwh)} Kč)`);
            headerLines.push(`Z toho TUV (Model):               ${Math.round(estTuvKwh)} kWh (${Math.round(estTuvKwh * config.priceKwh)} Kč)`);
            headerLines.push(`Z toho Standby (Model):           ${Math.round(yearlyStandbyWhEl / 1000)} kWh (${Math.round((yearlyStandbyWhEl / 1000) * config.priceKwh)} Kč)`);
        }
        
        if (memCache.expertScore && memCache.expertScore.hasEnoughData) {
            headerLines.push("-------------------------------------------------");
            headerLines.push(` EXPERTNÍ HODNOCENÍ SYSTÉMU`);
            headerLines.push("-------------------------------------------------");
            headerLines.push(`Celkové skóre:       ${memCache.expertScore.total} b (z 1000)`);
            headerLines.push(`Izolace budovy:      ${Math.round(memCache.expertScore.insulation)} %`);
            headerLines.push(`Účinnost TČ (SCOP):  ${Math.round(memCache.expertScore.efficiency)} %`);
            headerLines.push(`Zdraví a dynamika:   ${Math.round(memCache.expertScore.health)} %`);
            headerLines.push(`Akumulace a zisky:   ${Math.round(memCache.expertScore.accumulation)} %`);
        }
        
        headerLines.push("");
        headerLines.push("");

        let sIdx = -1, eIdx = -1;
        const cData = memCache.filledData;
        for (let i = 0; i < cData.length; i++) { if (cData[i].ts >= startTs) { sIdx = i; break; } }
        for (let i = cData.length - 1; i >= 0; i--) { if (cData[i].ts <= endTs) { eIdx = i; break; } }

        if (sIdx !== -1 && eIdx !== -1 && sIdx <= eIdx) {
            const winData = cData.slice(sIdx, eIdx + 1);
            const winTypes = memCache.analysis.types.slice(sIdx, eIdx + 1);
            const winRuns = memCache.analysis.runs.filter(r => {
                const rEndTs = cData[r.end].ts;
                const rStartTs = cData[r.start].ts;
                return rEndTs >= startTs && rStartTs <= endTs;
            });
            const winStats = calculateWindowStats(winData, winTypes, winRuns, config, memCache.physics);
            
            if (winStats && winStats.raw !== undefined) {
                const winStartD = formatD(cData[sIdx].ts);
                const winEndD = formatD(cData[eIdx].ts);
                const winDays = Math.max(1, Math.round((cData[eIdx].ts - cData[sIdx].ts) / 86400));
                
                const avgTotalKwh = winStats.totalKwh / winDays;
                const avgHeatKwh = winStats.heatKwh / winDays;
                const avgTuvKwh = winStats.tuvKwh / winDays;

                headerLines.push("-------------------------------------------------");
                headerLines.push(` SOUHRN VYBRANÉHO OBDOBÍ (Od ${winStartD} do ${winEndD}, délka: ${winDays} ${formatDays(winDays)})`);
                headerLines.push("-------------------------------------------------");
                headerLines.push("1. Spotřeba a Efektivita");
                headerLines.push(`Spotřeba celkem:     ${Math.round(winStats.totalKwh)} kWh (${Math.round(winStats.totalKwh * config.priceKwh)} Kč)`);
                headerLines.push(`Z toho Topení:       ${Math.round(winStats.heatKwh)} kWh`);
                headerLines.push(`Z toho TUV:          ${Math.round(winStats.tuvKwh)} kWh`);
                headerLines.push(`Dodané teplo celkem: ${Math.round((winStats.heatTpWh + winStats.tuvTpWh) / 1000)} kWh`);
                headerLines.push(`Efektivita (COP Mix):${winStats.avgCop > 0 ? winStats.avgCop.toFixed(2).replace('.', ',') : '-'}`);
                headerLines.push("");
                
                headerLines.push("2. Průměry na den");
                headerLines.push(`Spotřeba celkem:     ${avgTotalKwh.toFixed(1).replace('.', ',')} kWh/den (${Math.round(avgTotalKwh * config.priceKwh)} Kč/den)`);
                headerLines.push(`Z toho Topení:       ${avgHeatKwh.toFixed(1).replace('.', ',')} kWh/den`);
                headerLines.push(`Z toho TUV:          ${avgTuvKwh.toFixed(1).replace('.', ',')} kWh/den`);
                headerLines.push("");

                headerLines.push("3. Diagnostika cyklů a startů");
                headerLines.push(`Celkové starty:      ${winStats.raw}x (z toho ${winStats.tuv}x TUV, ${winStats.pauses}x Pauza)`);
                headerLines.push(`Cyklování:           ${winStats.maxStartsPerHour} x/h`);
                headerLines.push(`Defrost a Oil:       ${winStats.defrosts}x Defrost, ${winStats.oil}x Oil`);
                headerLines.push("");
                
                headerLines.push("4. Charakteristika a plynulost chodu");
                let rH = Math.floor(winStats.totalRunHours);
                let rM = Math.round((winStats.totalRunHours - rH) * 60);
                if (rM === 60) { rH++; rM = 0; }
                headerLines.push(`Čas TČ v chodu:      ${Math.round(winStats.runTimePercent)} % / ${rH}h ${String(rM).padStart(2, '00')}m`);
                headerLines.push(`Eko režim (<${String(config.limits.ecoMax).padEnd(4, ' ')}W):   ${Math.round(winStats.ecoPercent)} % času chodu`);
                headerLines.push(`Plynulost (stabilní výkon): ${Math.round(winStats.lowModPercent)} % času chodu`);
                headerLines.push("");
                
                headerLines.push("5. Průměrné provozní časy (Ø na 1 běh)");
                headerLines.push(`Ø Modulace:          ${Math.round(winStats.avgPower)} W`);
                headerLines.push(`Ø Délka běhu:        ${Math.round(winStats.avgRun)} min`);
                headerLines.push(`Ø Pauza:             ${Math.round(winStats.avgPause)} min`);
            }
        }
        headerLines.push("-------------------------------------------------");
        headerLines.push("");
    }

    let tableRows = [];
    let sIdx = -1, eIdx = -1;
    const cData = memCache.filledData;
    for (let i = 0; i < cData.length; i++) { if (cData[i].ts >= startTs) { sIdx = i; break; } }
    for (let i = cData.length - 1; i >= 0; i--) { if (cData[i].ts <= endTs) { eIdx = i; break; } }

    const hkGlobal = memCache.physics ? memCache.physics.k_zima || 0 : 0;

    if (exportType === 'daily' || exportType === 'service_report') {
        tableRows.push(["Datum", "Prum. Teplota [°C]", "Min. Teplota [°C]", "Max. Teplota [°C]", "Starty", "Kratke cykly", "Cas behu [h]", "Eko [%]", "Celkova spotreba [kWh]", "Topeni spotreba [kWh]", "TUV spotreba [kWh]", "Dodane teplo Topeni [kWh]", "Dodane teplo TUV [kWh]", "Potreba domu [kWh]", "Odtavani [kWh]", "Celkovy COP", "COP Topeni", "COP TUV", "Cena celkem [Kc]", "Dennostupne (HDD)", "kWh na 1 HDD", "Nejnizsi napeti [V]"]);
        const daily = memCache.globalMetrics.dailyStats;
        for (let d of daily) {
            const parts = d.dateStr.split('-');
            const ts = new Date(parts[0], parts[1] - 1, parts[2]).getTime() / 1000;
            if (ts >= startTs && ts <= endTs) {
                const avgTForDemand = d.tempCount > 0 ? (d.tempSum / d.tempCount) : null;
                const avgTStr = avgTForDemand !== null ? avgTForDemand.toFixed(1).replace('.', ',') : '-';
                const minTStr = d.minTemp !== null ? d.minTemp.toFixed(1).replace('.', ',') : '-';
                const maxTStr = d.maxTemp !== null ? d.maxTemp.toFixed(1).replace('.', ',') : '-';
                
                let demandKwh = 0;
                if (avgTForDemand !== null && hkGlobal > 0) {
                    let usedGain = (avgTForDemand < 3) ? gainW_zima : gainW_prechod;
                    demandKwh = Math.max(0, (hkGlobal * (config.targetIndoorTemp - avgTForDemand)) - usedGain) * (d.totalHours || 24) / 1000;
                }

                tableRows.push([
                    d.dateStr, avgTStr, minTStr, maxTStr, d.netStarts, d.shorts, 
                    d.runTimeHours.toFixed(1).replace('.', ','), d.ecoPercent.toFixed(1).replace('.', ','), 
                    d.tWh > 0 ? (d.tWh/1000).toFixed(2).replace('.', ',') : '0',
                    d.heatKwh > 0 ? d.heatKwh.toFixed(2).replace('.', ',') : '0',
                    d.tuvKwh > 0 ? d.tuvKwh.toFixed(2).replace('.', ',') : '0',
                    d.heatTpWh > 0 ? (d.heatTpWh / 1000).toFixed(2).replace('.', ',') : '0',
                    d.tuvTpWh > 0 ? (d.tuvTpWh / 1000).toFixed(2).replace('.', ',') : '0',
                    demandKwh > 0 ? demandKwh.toFixed(2).replace('.', ',') : '0',
                    d.defrostWh > 0 ? (d.defrostWh/1000).toFixed(2).replace('.', ',') : '0',
                    d.cop > 0 ? d.cop.toFixed(2).replace('.', ',') : '-',
                    d.heatKwh > 0 ? (d.heatTpWh / (d.heatKwh * 1000)).toFixed(2).replace('.', ',') : '-',
                    d.tuvKwh > 0 ? (d.tuvTpWh / (d.tuvKwh * 1000)).toFixed(2).replace('.', ',') : '-',
                    d.value > 0 ? d.value.toFixed(0) : '0',
                    d.hdd > 0 ? d.hdd.toFixed(2).replace('.', ',') : '0',
                    d.kwhPerHdd > 0 ? d.kwhPerHdd.toFixed(2).replace('.', ',') : '-',
                    d.minVolt !== null ? d.minVolt.toFixed(1).replace('.', ',') : '-'
                ]);
            }
        }
    } else if (exportType === 'monthly') {
        tableRows.push(["Mesic", "Starty", "Kratke cykly", "Cas behu [h]", "Eko [%]", "Celkova spotreba [kWh]", "Topeni spotreba [kWh]", "TUV spotreba [kWh]", "Dodane teplo Topeni [kWh]", "Dodane teplo TUV [kWh]", "Potreba domu [kWh]", "Odtavani [kWh]", "Celkovy SCOP", "COP Topeni", "COP TUV", "Cena celkem [Kc]", "Dennostupne (HDD)", "kWh na 1 HDD", "Nejnizsi napeti [V]"]);
        const monthly = memCache.globalMetrics.monthlyStats;
        for (let m of monthly) {
            const parts = m.isoKey.split('-');
            const ts = new Date(parts[0], parts[1] - 1, 15).getTime() / 1000;
            if (ts >= startTs && ts <= endTs) {
                const avgTForDemand = m.tempCount > 0 ? (m.tempSum / m.tempCount) : null;
                let demandKwh = 0;
                if (avgTForDemand !== null && hkGlobal > 0) {
                    let usedGain = (avgTForDemand < 3) ? gainW_zima : gainW_prechod;
                    demandKwh = Math.max(0, (hkGlobal * (config.targetIndoorTemp - avgTForDemand)) - usedGain) * (m.totalHours || 730) / 1000;
                }

                tableRows.push([
                    m.label, m.netStarts, m.shorts, m.runTimeHours.toFixed(1).replace('.', ','), 
                    m.ecoPercent.toFixed(1).replace('.', ','), 
                    m.tWh > 0 ? (m.tWh/1000).toFixed(2).replace('.', ',') : '0',
                    m.heatKwh > 0 ? m.heatKwh.toFixed(2).replace('.', ',') : '0',
                    m.tuvKwh > 0 ? m.tuvKwh.toFixed(2).replace('.', ',') : '0',
                    m.heatTpWh > 0 ? (m.heatTpWh / 1000).toFixed(2).replace('.', ',') : '0',
                    m.tuvTpWh > 0 ? (m.tuvTpWh / 1000).toFixed(2).replace('.', ',') : '0',
                    demandKwh > 0 ? demandKwh.toFixed(2).replace('.', ',') : '0',
                    m.defrostWh > 0 ? (m.defrostWh/1000).toFixed(2).replace('.', ',') : '0',
                    m.cop > 0 ? m.cop.toFixed(2).replace('.', ',') : '-',
                    m.heatKwh > 0 ? (m.heatTpWh / (m.heatKwh * 1000)).toFixed(2).replace('.', ',') : '-',
                    m.tuvKwh > 0 ? (m.tuvTpWh / (m.tuvKwh * 1000)).toFixed(2).replace('.', ',') : '-',
                    m.value > 0 ? m.value.toFixed(0) : '0',
                    m.hdd > 0 ? m.hdd.toFixed(2).replace('.', ',') : '0',
                    m.kwhPerHdd > 0 ? m.kwhPerHdd.toFixed(2).replace('.', ',') : '-',
                    m.minVolt !== null ? m.minVolt.toFixed(1).replace('.', ',') : '-'
                ]);
            }
        }
    } else if (exportType === 'raw_enriched') {
        tableRows.push(["Cas", "Teplota [°C]", "Prikon [W]", "Napeti [V]", "Spotreba [Wh]", "Dodane teplo [Wh]", "Potreba domu [W]", "Stav", "Vypočtený COP"]);
        if (sIdx !== -1 && eIdx !== -1 && sIdx <= eIdx) {
            for (let i = sIdx; i <= eIdx; i++) {
                const pt = cData[i];
                const dsc = pt.isMissing ? "Chybejici data" : (memCache.analysis.descriptions[i] || "Neznamo");
                const timeStr = new Date(pt.ts * 1000).toLocaleString('cs-CZ');
                
                let durationHours = (i < cData.length - 1) ? (cData[i+1].ts - pt.ts) / 3600 : 1/60;
                if (durationHours > 2) durationHours = 0;
                const energy = getEnergyFromPoint(pt, durationHours);
                const thermal = (pt.tp || 0) * durationHours;
                
                let demandW = 0;
                if (pt.temp != null && hkGlobal > 0) {
                    let usedGain = (pt.temp < 3) ? gainW_zima : gainW_prechod;
                    demandW = Math.max(0, hkGlobal * (config.targetIndoorTemp - pt.temp) - usedGain);
                }

                tableRows.push([
                    timeStr, 
                    pt.temp != null ? pt.temp.toFixed(1).replace('.',',') : '-', 
                    pt.p.toFixed(0), pt.v.toFixed(1).replace('.',','), 
                    energy.toFixed(2).replace('.',','), 
                    thermal.toFixed(2).replace('.',','), 
                    demandW.toFixed(0),
                    dsc, 
                    pt.cop ? pt.cop.toFixed(2).replace('.',',') : '-'
                ]);
            }
        }
    } else { 
        let tblStartD = sIdx !== -1 ? formatD(cData[sIdx].ts) : '-';
        let tblEndD = eIdx !== -1 ? formatD(cData[eIdx].ts) : '-';
        if (includeSummary) {
            headerLines.push(` DETAILNÍ VÝPIS CYKLŮ (Zvolené období: ${tblStartD} - ${tblEndD})`);
        }
        tableRows.push(["Od", "Do", "Prum. Venk. Teplota [°C]", "Trvani [min]", "Stav / Typ Cyklu", "Prum. Prikon [W]", "Max. Prikon [W]", "Spotreba [Wh]", "Dodane Teplo [Wh]", "Potreba domu [Wh]", "Vypočtený COP", "Cena [Kc]"]);
        
        if (sIdx !== -1 && eIdx !== -1 && sIdx <= eIdx) {
            let currentDesc = null;
            let cStartTs = 0, cEndTs = 0;
            let sumP = 0, sumTemp = 0, count = 0, cWh = 0, cTpWh = 0, cMaxP = 0;
            
            const flushCycle = () => {
                if (count > 0 && currentDesc) {
                    const durMin = (cEndTs - cStartTs) / 60;
                    const avgP = sumP / count;
                    const avgTemp = sumTemp / count;
                    const avgCop = cWh > 0 ? cTpWh / cWh : 0;
                    const cCost = (cWh / 1000) * config.priceKwh;
                    const formatTime = (dt) => dt.toLocaleDateString('cs-CZ') + " " + dt.toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'});
                    
                    let demandWh = 0;
                    if (avgTemp != null && hkGlobal > 0) {
                         let usedGain = (avgTemp < 3) ? gainW_zima : gainW_prechod;
                         let demandW = Math.max(0, hkGlobal * (config.targetIndoorTemp - avgTemp) - usedGain);
                         demandWh = demandW * (durMin / 60);
                    }
                    
                    if (durMin > 1 || currentDesc !== "Standby") {
                        tableRows.push([
                            formatTime(new Date(cStartTs * 1000)), formatTime(new Date(cEndTs * 1000)),
                            avgTemp.toFixed(1).replace('.', ','), durMin.toFixed(1).replace('.', ','), currentDesc,
                            avgP.toFixed(0), cMaxP.toFixed(0), cWh.toFixed(1).replace('.', ','), cTpWh.toFixed(1).replace('.', ','),
                            demandWh.toFixed(1).replace('.', ','),
                            avgCop > 0 ? avgCop.toFixed(2).replace('.', ',') : '-', cCost.toFixed(2).replace('.', ',')
                        ]);
                    }
                }
            };

            for (let i = sIdx; i <= eIdx; i++) {
                const pt = cData[i];
                const dsc = pt.isMissing ? "Chybějící data" : memCache.analysis.descriptions[i];
                let durationHours = (i < cData.length - 1) ? (cData[i+1].ts - pt.ts) / 3600 : 1/60;
                if (durationHours > 2) durationHours = 0;

                if (dsc !== currentDesc) {
                    flushCycle(); currentDesc = dsc; cStartTs = pt.ts; cEndTs = pt.ts;
                    sumP = 0; sumTemp = 0; count = 0; cWh = 0; cTpWh = 0; cMaxP = 0;
                }
                cEndTs = pt.ts + (durationHours * 3600);
                if (!pt.isMissing) {
                    sumP += pt.p; if (pt.p > cMaxP) cMaxP = pt.p; if (pt.temp != null) sumTemp += pt.temp; count++;
                    cWh += getEnergyFromPoint(pt, durationHours); cTpWh += (pt.tp || 0) * durationHours;
                }
            }
            flushCycle();
        }
    }
    
    let colWidths = [];
    tableRows.forEach(row => { row.forEach((cell, i) => { let len = String(cell).length; if (!colWidths[i] || len > colWidths[i]) colWidths[i] = len; }); });
    
    let displayTable = tableRows.map(row => row.map((cell, i) => String(cell).padEnd(colWidths[i] + 3)).join('')).join('\n');
    let clipboardTable = tableRows.map(row => row.join('\t')).join('\n');
    let csvTable = tableRows.map(row => row.join(';')).join('\n');

    const finalHeaderText = headerLines.length > 0 ? headerLines.join('\n') + '\n' : '';

    self.postMessage({ 
        type: 'EXPORT_RESULT', 
        jobId, 
        textDisplay: finalHeaderText + displayTable,
        textClipboard: finalHeaderText + clipboardTable,
        textCsv: finalHeaderText + csvTable
    });
    return;
}

if (type !== 'PROCESS') return;

if (text && text !== "A" && (!memCache || memCache.rawText !== text)) {
    const minTs = (config && Number.isFinite(config.minTs)) ? config.minTs : 0;
    
    self.postMessage({ type: 'STATUS', jobId, textDisplay: 'Čistím data a hledám výpadky...' });
    let rawData = [];
    try {
        rawData = parseData(text, config).filter(d => d.ts >= minTs);
        rawData.sort((a, b) => a.ts - b.ts);
    } catch(e) {
        self.postMessage({ type: 'ERROR', jobId, error: 'Chyba parsování dat: ' + e.message });
        return;
    }
    
    let uniqueData = [];
    for (let i = 0; i < rawData.length; i++) {
        if (uniqueData.length === 0 || uniqueData[uniqueData.length - 1].ts !== rawData[i].ts) {
            uniqueData.push(rawData[i]);
        } else {
            let lastItem = uniqueData[uniqueData.length - 1];
            if (rawData[i].e > lastItem.e) lastItem.e = rawData[i].e;
            if (rawData[i].p > lastItem.p) lastItem.p = rawData[i].p;
        }
    }

    const filledData = fillGapsSafe(uniqueData, config);
    if (filledData.length === 0) { self.postMessage({ type: 'NO_DATA', jobId }); return; }
    
    const firstTs = filledData[0].ts;
    const lastTs = filledData[filledData.length - 1].ts;
    
    self.postMessage({ type: 'STATUS', jobId, textDisplay: 'Stahuji historická data o počasí...' });
    let weather = null;
    try {
        weather = await fetchWeatherData(config.locLat || 50.3840, config.locLon || 14.0289, firstTs, lastTs);
    } catch (e) {
        console.error("Weather fetch failed:", e);
    }
    const isOfflineWeather = !weather || !weather.times || weather.times.length === 0;
    
    let wIdx = 0;
    for (let i = 0; i < filledData.length; i++) {
        const d = filledData[i];
        if (!isOfflineWeather) {
            while (wIdx < weather.times.length - 1 && weather.times[wIdx + 1] <= d.ts) {
                wIdx++;
            }
            d.temp = weather.temps[wIdx];
            d.humidity = weather.humidity ? weather.humidity[wIdx] : null;
        } else {
            const date = new Date(d.ts * 1000);
            d.temp = config.evanTemps[date.getMonth()];
            d.humidity = null;
        }
    }
    
    self.postMessage({ type: 'STATUS', jobId, textDisplay: 'Klasifikuji provozní cykly...' });
    let analysis = { types: [], descriptions: [], runs: [] };
    try {
        analysis = analyzeData(filledData, config);
    } catch(e) {
        self.postMessage({ type: 'ERROR', jobId, error: 'Chyba detekce cyklů: ' + e.message });
        return;
    }
    
    self.postMessage({ type: 'STATUS', jobId, textDisplay: 'Počítám výkonnost a COP...' });
    for (let i = 0; i < filledData.length; i++) {
        const d = filledData[i];
        const t = analysis.types[i];
        let cop = 1.0;
        let tpRaw = 0;
        
        if (t === TYPE.TUV) { cop = estimateCOP(d.temp, true, config, d.humidity); tpRaw = d.p * cop; }
        else if (t === TYPE.HEAT_STD || t === TYPE.HEAT_ECO || t === TYPE.OIL || t === TYPE.RISK) { cop = estimateCOP(d.temp, false, config, d.humidity); tpRaw = d.p * cop; }
        else if (t === TYPE.DEFROST) { 
            cop = 1.0; 
            // Tepelná ztráta při odmrazování: reverzní cyklus extrahuje teplo z domu.
        // Ztráta ≈ 1.2 × elektrický příkon (COP_reverse ≈ 1.0-1.5 pro odmraz).
        // Pokud d.p není k dispozici, fallback na defrostLossW (výchozí 1500 W).
        // Zdroj: Open Energy Monitor → roční ztráty odmrazováním 2-3 % výstupu.
        const defrostElW = d.p || 0;
        tpRaw = -(defrostElW > 100 ? defrostElW * 1.2 : (config.estimations.defrostLossW || 1500));
        }
        else { cop = 1.0; tpRaw = 0; }
        
        d.cop = cop; 
        
        const MAX_LIMIT = config.limits.maxThermal || 9000;
        const THRESHOLD = config.limits.softCap || 5000;
        
        if (tpRaw > THRESHOLD) {
            d.tp = THRESHOLD + (MAX_LIMIT - THRESHOLD) * (1 - Math.exp(-(tpRaw - THRESHOLD) / (MAX_LIMIT - THRESHOLD)));
        } else {
            d.tp = tpRaw;
        }
    }
    
    self.postMessage({ type: 'STATUS', jobId, textDisplay: 'Modeluji termodynamiku budovy...' });
    let globalMetrics = { dailyStats: [], monthlyStats: [], seasonalStats: {}, dailyHealth: {} };
    try {
        globalMetrics = calculateGlobalMetrics(filledData, analysis.runs, analysis.types, config);
    } catch(e) { console.error("Error in global metrics:", e); }

    const computedMonthlyCop = config.evanTemps.map(t => estimateCOP(t, false, config));
    const maxTcCurve = [];
    for (let t = -20; t <= 15; t++) { maxTcCurve.push({ temp: t, maxTc: estimateMaxTC(t, config) }); }

    let physics = null;
    try {
        physics = calculatePurePhysics(globalMetrics.dailyStats, config);
    } catch(e) { console.error("Error in physics:", e); }

    let boundaryTemp = null;
    let boundaryTempAutumn = null; // #7: podzimní hranice (srpen–leden)
    let boundaryTempSpring  = null; // #7: jarní hranice (únor–červenec)
    let avgNormCopLongTerm  = null; // #6: průměrný normCop za celou historii
    let copCurveWarning     = false; // #6: křivka neodpovídá realitě?
    try {
        // Topné dny ≥ 1h, seřazené od nejteplejšího
        const htDays = globalMetrics.dailyStats.filter(d =>
            (d.heatRunHours || 0) >= 1 && d.tempCount > 0
        ).sort((a, b) => (b.tempSum / b.tempCount) - (a.tempSum / a.tempCount));

        // Helper: 95. percentil shora (vyřadit top 5% outlierů)
        const get95 = (days) => {
            if (days.length === 0) return null;
            const excl = Math.floor(days.length * 0.05);
            const f = days.slice(excl);
            return f.length > 0 ? f[0].tempSum / f[0].tempCount : null;
        };

        boundaryTemp = get95(htDays);

        // #7: Hystereze — podzim vs. jaro mají různou tepelnou kapacitu budovy
        // Podzim (srp-led): dům naakumulován po létě → topí při nižší venkovní teplotě
        // Jaro (úno-čer): slunce a teplo prodlužují sezónu → přestává topit při vyšší teplotě
        const autumnDays = htDays.filter(d => { const m = parseInt(d.dateStr.split('-')[1]); return m >= 8 || m <= 1; });
        const springDays = htDays.filter(d => { const m = parseInt(d.dateStr.split('-')[1]); return m >= 2 && m <= 7; });
        boundaryTempAutumn = get95(autumnDays);
        boundaryTempSpring  = get95(springDays);
    } catch(e) {}

    // #6: Validace ekvitermní křivky přes dlouhodobý normCop
    // Pokud normCop trvale < 0.75 nebo > 1.15 → nastavená křivka (LWT) neodpovídá realitě
    try {
        const degradF = getDegradFactor(config);
        let ncs = 0, ncc = 0;
        (globalMetrics.dailyStats || []).forEach(d => {
            if ((d.heatRunHours || 0) < 1) return;
            const copH = (d.heatWhClean > 0 && d.heatTpWhClean > 0) ? d.heatTpWhClean / d.heatWhClean : 0;
            if (copH <= 0) return;
            const avgT = d.avgTempHeat !== null && d.avgTempHeat !== undefined
                ? d.avgTempHeat : (d.tempCount > 0 ? d.tempSum / d.tempCount : null);
            if (avgT === null) return;
            const expCop = estimateCOPRaw(avgT, config);
            if (expCop <= 0) return;
            const nc = copH / (expCop * degradF);
            if (nc > 0.3 && nc < 2.0) { ncs += nc; ncc++; }
        });
        if (ncc >= 10) {
            avgNormCopLongTerm = ncs / ncc;
            copCurveWarning = avgNormCopLongTerm < 0.75 || avgNormCopLongTerm > 1.15;
        }
    } catch(e) {}

    let minModP = Infinity;
    let minModTp = 0;
    let currentSegStart = -1;
    for (let i = 0; i < filledData.length; i++) {
        if (analysis.types[i] === TYPE.HEAT_STD || analysis.types[i] === TYPE.HEAT_ECO) {
            if (currentSegStart === -1) currentSegStart = i;
        } else {
            if (currentSegStart !== -1) {
                let durMins = (filledData[i-1].ts - filledData[currentSegStart].ts) / 60;
                if (durMins >= 50) {
                    let sumP = 0, sumTp = 0, count = 0;
                    for(let j = currentSegStart; j < i; j++) { sumP += filledData[j].p; sumTp += filledData[j].tp || 0; count++; }
                    let avgP = sumP / count;
                    if (avgP < minModP && avgP > 100) { minModP = avgP; minModTp = sumTp / count; }
                }
                currentSegStart = -1;
            }
        }
    }
    if (currentSegStart !== -1) {
        let durMins = (filledData[filledData.length-1].ts - filledData[currentSegStart].ts) / 60;
        if (durMins >= 50) {
            let sumP = 0, sumTp = 0, count = 0;
            for(let j = currentSegStart; j < filledData.length; j++) { sumP += filledData[j].p; sumTp += filledData[j].tp || 0; count++; }
            let avgP = sumP / count;
            if (avgP < minModP && avgP > 100) { minModP = avgP; minModTp = sumTp / count; }
        }
    }
    
    self.postMessage({ type: 'STATUS', jobId, textDisplay: 'Sestavuji konečné metriky...' });
    
    let thermoMetrics = null;
    try { thermoMetrics = calculateThermoMetrics(globalMetrics.dailyStats, maxTcCurve, config, physics); } catch(e) { console.error(e); }
    
    let financeMetrics = null;
    try { financeMetrics = calculateFinanceMetrics(globalMetrics.seasonalStats, globalMetrics.dailyStats, computedMonthlyCop, config, physics); } catch(e) { console.error(e); }
    
    let fullWindowStats = {};
    try { fullWindowStats = calculateWindowStats(filledData, analysis.types, analysis.runs, config, physics); } catch(e) { console.error(e); }
    
    let expertScore = null;
    try { expertScore = calculateExpertScore(physics, financeMetrics ? financeMetrics.total : null, fullWindowStats, config); } catch(e) { console.error(e); }

    memCache = { 
        rawText: text, 
        filledData: filledData, 
        analysis: analysis, 
        globalMetrics: globalMetrics, 
        dynamicMonthlyCop: computedMonthlyCop, 
        isOfflineWeather: isOfflineWeather, 
        maxTcCurve: maxTcCurve,
        heatingBoundary: boundaryTemp,
        heatingBoundaryAutumn: boundaryTempAutumn,
        heatingBoundarySpring: boundaryTempSpring,
        avgNormCopLongTerm: avgNormCopLongTerm,
        copCurveWarning: copCurveWarning,
        minModulationEl: minModP !== Infinity ? minModP : null,
        minModulationTh: minModP !== Infinity ? minModTp : null,
        physics: physics,
        thermoMetrics: thermoMetrics,
        financeMetrics: financeMetrics,
        expertScore: expertScore
    };
}

if (!memCache) { self.postMessage({ type: 'NO_DATA', jobId }); return; }

let mainResult = { stats: {}, windowData: [], colors: [], descriptions: [] };
let noobScore = null;

try {
    mainResult = extractDay(memCache, startTs, endTs, config);
    mainResult.stats.isOfflineWeather = memCache.isOfflineWeather;
    
    try {
        noobScore = generateNoobScoreAndStory(mainResult.stats, config, memCache.physics, memCache.globalMetrics);
    } catch(e) { console.error("NoobScore error:", e); }
} catch(e) {
    self.postMessage({ type: 'ERROR', jobId, error: 'Chyba při přípravě výřezu dat: ' + e.message });
    return;
}

self.postMessage({ 
    type: 'RESULT', 
    jobId: jobId, 
    stats: mainResult.stats, 
    seasonalStats: memCache.globalMetrics.seasonalStats, 
    dailyStats: memCache.globalMetrics.dailyStats, 
    monthlyStats: memCache.globalMetrics.monthlyStats, 
    dailyHealth: memCache.globalMetrics.dailyHealth, 
    colors: mainResult.colors, 
    descriptions: mainResult.descriptions, 
    windowData: mainResult.windowData, 
    dynamicMonthlyCop: memCache.dynamicMonthlyCop, 
    maxTcCurve: memCache.maxTcCurve,
    heatingBoundary: memCache.heatingBoundary,
    heatingBoundaryAutumn: memCache.heatingBoundaryAutumn,
    heatingBoundarySpring: memCache.heatingBoundarySpring,
    avgNormCopLongTerm: memCache.avgNormCopLongTerm,
    copCurveWarning: memCache.copCurveWarning,
    minModulationEl: memCache.minModulationEl,
    minModulationTh: memCache.minModulationTh,
    thermoMetrics: memCache.thermoMetrics,
    financeMetrics: memCache.financeMetrics,
    expertScore: memCache.expertScore,
    noobScore: noobScore
});

if (prefetchDates && prefetchDates.length > 0) {
    for (let pf of prefetchDates) {
        try {
            const pfResult = extractDay(memCache, pf.sTs, pf.eTs, config);
            pfResult.stats.isOfflineWeather = memCache.isOfflineWeather;
            self.postMessage({ type: 'CACHE_RESULT', jobId: jobId, dateKey: pf.key, stats: pfResult.stats, colors: pfResult.colors, descriptions: pfResult.descriptions, windowData: pfResult.windowData });
        } catch(e) { /* ignore prefetch errors silently */ }
    }
}
};

// ==========================================
// 4. POMOCNÁ FUNKCE PRO VÝŘEZ DNE
// ==========================================
// ─── SEKCE 7: EXTRAKCE VÝŘEZU (den/měsíc/rok) ────────────────────────────────

function extractDay(mem, sTs, eTs, config) {
let startIdx = -1, endIdx = -1;
const { filledData, analysis } = mem;

for (let i = 0; i < filledData.length; i++) { if (filledData[i].ts >= sTs) { startIdx = i; break; } }
for (let i = filledData.length - 1; i >= 0; i--) { if (filledData[i].ts <= eTs) { endIdx = i; break; } }

let windowData = [], windowTypes = [], windowDescriptions = [], windowStats = {};

if (startIdx !== -1 && endIdx !== -1 && startIdx <= endIdx) {
    windowData = filledData.slice(startIdx, endIdx + 1);
    windowTypes = analysis.types.slice(startIdx, endIdx + 1);
    windowDescriptions = analysis.descriptions.slice(startIdx, endIdx + 1);
    const windowRuns = analysis.runs.filter(r => {
        const rEndTs = filledData[r.end].ts;
        const rStartTs = filledData[r.start].ts;
        return rEndTs >= sTs && rStartTs <= eTs;
    });
    windowStats = calculateWindowStats(windowData, windowTypes, windowRuns, config, mem.physics);
} else {
    windowStats = { 
        raw: 0, netStarts: 0, short: 0, defrosts: 0, tuv: 0, avgRun: 0, avgPower: 0, ecoPercent: 0, 
        totalKwh: 0, heatKwh: 0, tuvKwh: 0, heatTpWh: 0, tuvTpWh: 0, defrostWh: 0, minVolt: null,
        totalHours: 0, runTimePercent: 0, totalRunHours: 0, pauses: 0, avgPause: 0, oil: 0, 
        avgTemp: null, loss15: null, houseK: 0, wm2: 0, hdd: 0, kwhPerHdd: 0, avgCop: 0, copHeat: 0, copTuv: 0,
        health: { code: 'green', class: 'st-ideal', color: 'var(--success)' }, maxStartsPerHour: 0, lowModPercent: 0,
        standbyKwh: 0, standbyHours: 0 
    };
}

const windowColors = windowTypes.map(t => {
    if (t === TYPE.GRAY) return config.colors.gray;
    if (t === TYPE.HEAT_STD) return config.colors.heatStd;
    if (t === TYPE.HEAT_ECO) return config.colors.heatEco;
    if (t === TYPE.TUV) return config.colors.tuv;
    if (t === TYPE.OIL) return config.colors.oil;
    if (t === TYPE.DEFROST) return config.colors.defrost;
    if (t === TYPE.RISK) return config.colors.risk;
    if (t === TYPE.MISSING) return config.colors.missing;
    if (t === TYPE.PRESSURE) return config.colors.pressure || '#2dd4bf';
    return config.colors.gray;
});

return { windowData, stats: windowStats, colors: windowColors, descriptions: windowDescriptions };
}

// ==========================================
// 5. METRIKY A VÝPOČTY
// ==========================================
function calculateWindowStats(data, types, runs, config, physicsObj = null) {
if (!data || data.length === 0) return {};
let heatRunSum = 0, heatRunCount = 0, tuvCount = 0, shortCount = 0, oilCount = 0, healthStarts = 0;
 
let maxStartsPerHour = 0;
let heatStartsWindow = [];
let trueRawStarts = 0;
let isPhysRun = false;

runs.forEach((run, ridx) => {
    if (run.type === 'TUV') {
        tuvCount++;
    } else if (run.type === 'HEAT' || run.type === 'RUNNING_HEAT' || run.type === 'MIXED') {
        heatRunSum += run.duration; 
        heatRunCount++; 
        
        if (!run.isContinuation && run.isValidStart) {
            healthStarts++;
            if (run.isShort) shortCount++;
            
            let startTs = run.startTs; 
            heatStartsWindow.push(startTs);
            while(heatStartsWindow.length > 0 && startTs - heatStartsWindow[0] > 3600) {
                heatStartsWindow.shift();
            }
            if (heatStartsWindow.length > maxStartsPerHour) {
                maxStartsPerHour = heatStartsWindow.length;
            }
        }
    }
    if (run.type === 'MIXED') tuvCount++;
});

let defrostCount = 0;
let inDefrost = false;
 
let totalWh = 0, heatWh = 0, tuvWh = 0, defrostWh = 0;
let heatTpWh = 0, tuvTpWh = 0;
let standbyWh = 0, standbyHours = 0;

let modSum = 0, modCount = 0, ecoTicks = 0, totalRunTicks = 0, runTimeHours = 0, totalTimeHours = 0, inOil = false;
let tempSum = 0, tempCount = 0;
let tempHeatSum = 0, tempHeatCount = 0; // teplota jen při chodu TČ
let lowModTicks = 0;
let minVolt = 999;
let hdd = 0;
 
for (let k = 0; k < data.length; k++) {
    if (types[k] === TYPE.MISSING) continue;
    
    if (data[k].p > config.limits.run) {
        if (!isPhysRun) {
            isPhysRun = true;
            if (k > 0) trueRawStarts++;
        }
    } else {
        isPhysRun = false;
    }
    
    let durationHours = (k < data.length - 1) ? (data[k + 1].ts - data[k].ts) / 3600 : 1 / 60;
    if (durationHours > 2) durationHours = 0;

    if (data[k].temp !== null && data[k].temp !== undefined) { 
        tempSum += data[k].temp; 
        tempCount++; 
        hdd += Math.max(0, config.targetIndoorTemp - data[k].temp) * (durationHours / 24);
        // Průměrná teplota jen při aktivním topení (pro přesný copRatio)
        if (types[k] === TYPE.HEAT_STD || types[k] === TYPE.HEAT_ECO || types[k] === TYPE.OIL) {
            tempHeatSum += data[k].temp;
            tempHeatCount++;
        }
    }
    if (data[k].v > config.system.minVolt && data[k].v < minVolt) minVolt = data[k].v;
 
    const energy = getEnergyFromPoint(data[k], durationHours);
    
    totalWh += energy;
    totalTimeHours += durationHours;
 
    const t = types[k];

    if (t === TYPE.DEFROST || t === TYPE.PRESSURE) {
        if (!inDefrost) {
            defrostCount++;
            inDefrost = true;
        }
    } else {
        inDefrost = false;
    }

    if (t === TYPE.GRAY || t === TYPE.MISSING) {
        standbyWh += energy;
        standbyHours += durationHours;
    }
    
    if (t === TYPE.TUV) {
        tuvWh += energy;
        tuvTpWh += (data[k].tp || 0) * durationHours;
    } else {
        heatWh += energy;
        heatTpWh += (data[k].tp || 0) * durationHours;
        if (t === TYPE.DEFROST || t === TYPE.PRESSURE) defrostWh += energy;
    }

    if (t !== TYPE.GRAY && t !== TYPE.MISSING) {
        runTimeHours += durationHours; 
        totalRunTicks++;
        
        if (t === TYPE.HEAT_STD || t === TYPE.HEAT_ECO) {
            let k_back = k;
            let minP = data[k].p;
            let maxP = data[k].p;
            let cCount = 0;
            // 15 minutové okno pro detekci stabilní modulace
            // (invertor mění výkon každých 5-7 minut, kratší okno podhodnocovalo plynulost)
            while (k_back >= 0 && (data[k].ts - data[k_back].ts) <= 900) {
                if (types[k_back] === TYPE.HEAT_STD || types[k_back] === TYPE.HEAT_ECO) {
                    if (data[k_back].p < minP) minP = data[k_back].p;
                    if (data[k_back].p > maxP) maxP = data[k_back].p;
                    cCount++;
                }
                k_back--;
            }
            if (cCount > 3) {
                let diff = maxP - minP;
                let avgP = (maxP + minP) / 2;
                if (diff < 150 || diff < (avgP * 0.15)) {
                    lowModTicks++;
                }
            }
        }
    }
    
    if (t === TYPE.HEAT_STD || t === TYPE.HEAT_ECO) { modSum += data[k].p; modCount++; }
    if (t === TYPE.HEAT_ECO) ecoTicks++;
    if (t === TYPE.OIL) { if (!inOil) { oilCount++; inOil = true; } } else { inOil = false; }
}
 
let totalPauseSeconds = 0, pauseCountVal = 0;
for (let i = 0; i < runs.length - 1; i++) {
    const gapSeconds = runs[i + 1].startTs - runs[i].endTs;
    if (gapSeconds > config.durations.maxDefrostGap * 60) { totalPauseSeconds += gapSeconds; pauseCountVal++; }
}
const avgPauseMins = pauseCountVal > 0 ? (totalPauseSeconds / 60) / pauseCountVal : 0;
 
const avgTemp = tempCount > 0 ? tempSum / tempCount : null;
const avgTempHeat = tempHeatCount > 0 ? tempHeatSum / tempHeatCount : null;
const avgCop = totalWh > 0 ? ((heatTpWh + tuvTpWh) / totalWh) : 0;
const copHeat = heatWh > 0 ? (heatTpWh / heatWh) : 0;
const copTuv = tuvWh > 0 ? (tuvTpWh / tuvWh) : 0;
// copExpected a copRatio nejsou počítány zde — dochází ke kruhové závislosti
// (copHeat = estimateCOP × degradace, copExpected = estimateCOPRaw → ratio = vždy konstanta)
// normCop se počítá v generateNoobScoreAndStory s avgTempHeat pro správný kontext
const copExpected = 0;
const copRatio = 0;
const lowModPercent = totalRunTicks > 0 ? (lowModTicks / totalRunTicks) * 100 : 0;
 
let houseK = 0, loss15 = null, kwhPerHdd = 0, wm2 = 0;

if (avgTemp !== null && totalTimeHours > 0) {
    if (hdd > 0) kwhPerHdd = (heatWh / 1000) / hdd;
    
    const avgPowerThermal = heatTpWh / totalTimeHours;
    const gainW = (physicsObj) ? ((avgTemp < 3) ? physicsObj.dynamicGainW_zima : physicsObj.dynamicGainW_prechod) : (config.internalGainW || 550);
    const totalPowerThermal = avgPowerThermal + gainW;

    const tempDiff = Math.max(2, config.targetIndoorTemp - avgTemp);
    
    houseK = totalPowerThermal / tempDiff;
    loss15 = houseK * (config.targetIndoorTemp - config.designTemp);
    
    let area = (config.floorArea && config.floorArea > 0) ? config.floorArea : 100;
    wm2 = loss15 / area;
}
 
return {
    raw: trueRawStarts, netStarts: healthStarts, short: shortCount, defrosts: defrostCount, tuv: tuvCount,
    avgRun: heatRunCount > 0 ? heatRunSum / heatRunCount : 0,
    avgPower: modCount > 0 ? modSum / modCount : 0,
    ecoPercent: totalRunTicks > 0 ? (ecoTicks / totalRunTicks) * 100 : 0,
    totalKwh: totalWh / 1000, heatKwh: heatWh / 1000, tuvKwh: tuvWh / 1000,
    heatTpWh: heatTpWh, tuvTpWh: tuvTpWh, copHeat: copHeat, copTuv: copTuv, defrostWh: defrostWh,
    minVolt: minVolt === 999 ? null : minVolt,
    totalHours: totalTimeHours, runTimePercent: totalTimeHours > 0 ? (runTimeHours / totalTimeHours) * 100 : 0,
    totalRunHours: runTimeHours,
    heatOnlyHours: heatRunSum / 60,
    pauses: pauseCountVal, avgPause: avgPauseMins, oil: oilCount,
    avgTemp: avgTemp, avgTempHeat: avgTempHeat, loss15: loss15, houseK: houseK, wm2: wm2, hdd: hdd, kwhPerHdd: kwhPerHdd, avgCop: avgCop,
    maxStartsPerHour: maxStartsPerHour, lowModPercent: lowModPercent,
    standbyKwh: standbyWh / 1000, standbyHours: standbyHours,
    health: evaluateHealth(healthStarts, shortCount, totalTimeHours,
        data[0] ? new Date(data[0].ts * 1000).getMonth() : -1)
};
}
 
// ─── SEKCE 8: GLOBÁLNÍ METRIKY (celá historie) ───────────────────────────────

function calculateGlobalMetrics(data, runs, types, config) {
if (!data || data.length === 0) return { dailyStats: [], monthlyStats: [], dailyHealth: {}, seasonalStats: {} };
const dayMetrics = {}; const seasonalStats = {}; const monthMetrics = {};
let inDefrostTracker = false;
let isRunningPhysical = false;
let prevDayKeyIso = null;

for (let i = 0; i < data.length; i++) {
    const d = data[i]; if (types[i] === TYPE.MISSING) continue;
    const date = new Date(d.ts * 1000);
    const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), dStr = String(date.getDate()).padStart(2, '0');
    const dayKeyIso = `${y}-${m}-${dStr}`;
    const monthKeyIso = `${y}-${m}`;
    // Reset inDefrostTracker při přechodu přes půlnoc (odmraz přes půlnoc by jinak způsobil zdvojení)
    if (dayKeyIso !== prevDayKeyIso) { inDefrostTracker = false; prevDayKeyIso = dayKeyIso; }
    
    if (!dayMetrics[dayKeyIso]) dayMetrics[dayKeyIso] = { 
        cost: 0, netStarts: 0, shorts: 0, rawStarts: 0, heatWh: 0, tuvWh: 0, tWh: 0, heatTpWh: 0, tuvTpWh: 0, hdd: 0, defrostWh: 0, minVolt: 999, tempSum: 0, tempCount: 0,
        minTemp: 99, maxTemp: -99, runTimeHours: 0, heatRunHours: 0, hddStd: 0, ecoTicks: 0, runTicks: 0, totalHours: 0, tuvRuns: 0, defrostRuns: 0, heatRuns: 0, heatWhClean: 0, heatTpWhClean: 0, tempHeatSum: 0, tempHeatCount: 0, standbyWh: 0, standbyHours: 0
    };
    if (!monthMetrics[monthKeyIso]) monthMetrics[monthKeyIso] = { 
        cost: 0, heatWh: 0, tuvWh: 0, tWh: 0, heatTpWh: 0, tuvTpWh: 0, hdd: 0, hddStd: 0, defrostWh: 0, minVolt: 999, tempSum: 0, tempCount: 0,
        minTemp: 99, maxTemp: -99, netStarts: 0, shorts: 0, rawStarts: 0, runTimeHours: 0, heatRunHours: 0, ecoTicks: 0, runTicks: 0, totalHours: 0, tuvRuns: 0, defrostRuns: 0, heatRuns: 0,
        heatWhClean: 0, heatTpWhClean: 0, tempHeatSum: 0, tempHeatCount: 0
    };
    
    const sY = date.getMonth() >= 7 ? y : y - 1; const sKey = sY + "/" + (sY + 1);
    
    if (!seasonalStats[sKey]) seasonalStats[sKey] = { 
        tWh: 0, hWh: 0, tuWh: 0, fTs: d.ts, lTs: d.ts, pSum: 0, pCount: 0, tempSum: 0, tempCount: 0, heatTpWh: 0, tuvTpWh: 0, hdd: 0, defrostWh: 0, minVolt: 999, totalHours: 0, standbyWh: 0, standbyHours: 0, runTimeHours: 0
    };

    if (d.p > config.limits.run) {
        if (!isRunningPhysical) {
            isRunningPhysical = true;
            if (i > 0) {
                dayMetrics[dayKeyIso].rawStarts++;
                monthMetrics[monthKeyIso].rawStarts++;
            }
        }
    } else {
        isRunningPhysical = false;
    }

    const t = types[i];
    if (t === TYPE.DEFROST || t === TYPE.PRESSURE) {
        if (!inDefrostTracker) {
            dayMetrics[dayKeyIso].defrostRuns++;
            monthMetrics[monthKeyIso].defrostRuns++;
            inDefrostTracker = true;
        }
    } else {
        inDefrostTracker = false;
    }
 
    let durationHours = (i < data.length - 1) ? (data[i + 1].ts - d.ts) / 3600 : 1 / 60;
    if (durationHours > 2) durationHours = 0;

    const wh = getEnergyFromPoint(d, durationHours);
    const cost = (wh / 1000) * config.priceKwh;
    dayMetrics[dayKeyIso].cost += cost; 
    monthMetrics[monthKeyIso].cost += cost;
 
    const thermalWh = (d.tp || 0) * durationHours;
 
    seasonalStats[sKey].tWh += wh; seasonalStats[sKey].pSum += d.p; seasonalStats[sKey].pCount++;
    seasonalStats[sKey].totalHours += durationHours;
    
    dayMetrics[dayKeyIso].tWh += wh;
    dayMetrics[dayKeyIso].totalHours += durationHours;
    
    monthMetrics[monthKeyIso].tWh += wh;
    monthMetrics[monthKeyIso].totalHours += durationHours;
    
    if (d.v > config.system.minVolt) {
        if (d.v < seasonalStats[sKey].minVolt) seasonalStats[sKey].minVolt = d.v;
        if (d.v < dayMetrics[dayKeyIso].minVolt) dayMetrics[dayKeyIso].minVolt = d.v;
        if (d.v < monthMetrics[monthKeyIso].minVolt) monthMetrics[monthKeyIso].minVolt = d.v;
    }

    if (d.temp !== null && d.temp !== undefined) { 
        let currentHdd = Math.max(0, config.targetIndoorTemp - d.temp) * (durationHours / 24);
        seasonalStats[sKey].tempSum += d.temp; 
        seasonalStats[sKey].tempCount++;
        seasonalStats[sKey].hdd += currentHdd;
        
        dayMetrics[dayKeyIso].hdd += currentHdd;
        monthMetrics[monthKeyIso].hdd += currentHdd;
        // hddStd: Eurostat základ 18°C, počítá se jen když avgTemp < 15°C
        // Slouží pro kWhHDD srovnatelné s průmyslovými benchmarky (EN ISO 15927)
        if (d.temp < 15) {
            const hddStdTick = Math.max(0, 18 - d.temp) * (durationHours / 24);
            dayMetrics[dayKeyIso].hddStd += hddStdTick;
            monthMetrics[monthKeyIso].hddStd = (monthMetrics[monthKeyIso].hddStd || 0) + hddStdTick;
        }
        dayMetrics[dayKeyIso].tempSum += d.temp;
        dayMetrics[dayKeyIso].tempCount++;
        monthMetrics[monthKeyIso].tempSum += d.temp;
        monthMetrics[monthKeyIso].tempCount++;

        if (d.temp < dayMetrics[dayKeyIso].minTemp) dayMetrics[dayKeyIso].minTemp = d.temp;
        if (d.temp > dayMetrics[dayKeyIso].maxTemp) dayMetrics[dayKeyIso].maxTemp = d.temp;
        if (d.temp < monthMetrics[monthKeyIso].minTemp) monthMetrics[monthKeyIso].minTemp = d.temp;
        if (d.temp > monthMetrics[monthKeyIso].maxTemp) monthMetrics[monthKeyIso].maxTemp = d.temp;
    }
    
    if (t !== TYPE.GRAY && t !== TYPE.MISSING) {
        dayMetrics[dayKeyIso].runTimeHours += durationHours;
        monthMetrics[monthKeyIso].runTimeHours += durationHours;
        seasonalStats[sKey].runTimeHours += durationHours;
        dayMetrics[dayKeyIso].runTicks++;
        monthMetrics[monthKeyIso].runTicks++;
        if (t === TYPE.HEAT_ECO) {
            dayMetrics[dayKeyIso].ecoTicks++;
            monthMetrics[monthKeyIso].ecoTicks++;
        }
        // Čisté topné hodiny + teplota při topení + clean energie (bez defrostu/tlaku)
        if (t === TYPE.HEAT_STD || t === TYPE.HEAT_ECO || t === TYPE.OIL) {
            dayMetrics[dayKeyIso].heatRunHours   += durationHours;
            monthMetrics[monthKeyIso].heatRunHours += durationHours;
            // clean = bez defrostu/tlaku → přesnější copHeat a houseK
            dayMetrics[dayKeyIso].heatWhClean    += wh;
            dayMetrics[dayKeyIso].heatTpWhClean  += thermalWh;
            monthMetrics[monthKeyIso].heatWhClean   += wh;
            monthMetrics[monthKeyIso].heatTpWhClean += thermalWh;
            // teplota jen při aktivním topení (pro houseK a copHeat)
            if (d.temp !== null && d.temp !== undefined) {
                dayMetrics[dayKeyIso].tempHeatSum    += d.temp;
                dayMetrics[dayKeyIso].tempHeatCount++;
                monthMetrics[monthKeyIso].tempHeatSum   += d.temp;
                monthMetrics[monthKeyIso].tempHeatCount++;
            }
        }
    }

    if (t === TYPE.GRAY || t === TYPE.MISSING) {
        seasonalStats[sKey].standbyWh += wh;
        seasonalStats[sKey].standbyHours += durationHours;
        dayMetrics[dayKeyIso].standbyWh += wh;
        dayMetrics[dayKeyIso].standbyHours += durationHours;
    }

    if (t === TYPE.TUV) {
        seasonalStats[sKey].tuWh += wh;
        seasonalStats[sKey].tuvTpWh += thermalWh;
        dayMetrics[dayKeyIso].tuvWh += wh;
        dayMetrics[dayKeyIso].tuvTpWh += thermalWh;
        monthMetrics[monthKeyIso].tuvWh += wh;
        monthMetrics[monthKeyIso].tuvTpWh += thermalWh;
    } else {
        seasonalStats[sKey].hWh += wh;
        seasonalStats[sKey].heatTpWh += thermalWh;
        dayMetrics[dayKeyIso].heatWh += wh;
        dayMetrics[dayKeyIso].heatTpWh += thermalWh;
        monthMetrics[monthKeyIso].heatWh += wh;
        monthMetrics[monthKeyIso].heatTpWh += thermalWh;
        
        // PRESSURE (vyrovnání tlaků) je součástí odmrazovacího cyklu → patří do defrostWh
        if (t === TYPE.DEFROST || t === TYPE.PRESSURE) {
            seasonalStats[sKey].defrostWh += wh;
            dayMetrics[dayKeyIso].defrostWh += wh;
            monthMetrics[monthKeyIso].defrostWh += wh;
        }
    }
    seasonalStats[sKey].lTs = d.ts;
}

runs.forEach((run) => {
    const date = new Date(data[run.start].ts * 1000);
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (dayMetrics[dayKey]) {
        if (run.type === 'TUV' || run.type === 'MIXED') dayMetrics[dayKey].tuvRuns++;
        if (run.type === 'HEAT' || run.type === 'RUNNING_HEAT' || run.type === 'MIXED') dayMetrics[dayKey].heatRuns++;
    }
    if (monthMetrics[monthKey]) {
        if (run.type === 'TUV' || run.type === 'MIXED') monthMetrics[monthKey].tuvRuns++;
        if (run.type === 'HEAT' || run.type === 'RUNNING_HEAT' || run.type === 'MIXED') monthMetrics[monthKey].heatRuns++;
    }

    if (run.type !== 'TUV') { 
        if (!run.isContinuation && run.isValidStart) {
            if (dayMetrics[dayKey]) dayMetrics[dayKey].netStarts++;
            if (monthMetrics[monthKey]) monthMetrics[monthKey].netStarts++;
            if (run.isShort) {
                if (dayMetrics[dayKey]) dayMetrics[dayKey].shorts++;
                if (monthMetrics[monthKey]) monthMetrics[monthKey].shorts++;
            }
        }
    }
});

const finalDailyStats = [], finalDailyHealth = {};
Object.keys(dayMetrics).sort().forEach(isoKey => {
    const parts = isoKey.split('-');
    finalDailyStats.push({ 
        dateStr: isoKey,
        label: `${parseInt(parts[2])}.${parseInt(parts[1])}.`, 
        value: dayMetrics[isoKey].cost,
        tWh: dayMetrics[isoKey].tWh,
        heatWh: dayMetrics[isoKey].heatWh,
        tuvWh: dayMetrics[isoKey].tuvWh,
        heatTpWh: dayMetrics[isoKey].heatTpWh,
        heatWhClean: dayMetrics[isoKey].heatWhClean || 0,
        heatTpWhClean: dayMetrics[isoKey].heatTpWhClean || 0,
        avgTempHeat: dayMetrics[isoKey].tempHeatCount > 0
            ? dayMetrics[isoKey].tempHeatSum / dayMetrics[isoKey].tempHeatCount
            : null,
        tuvTpWh: dayMetrics[isoKey].tuvTpWh,
        hdd: dayMetrics[isoKey].hdd,
        hddStd: dayMetrics[isoKey].hddStd || 0,
        defrostWh: dayMetrics[isoKey].defrostWh,
        minVolt: dayMetrics[isoKey].minVolt === 999 ? null : dayMetrics[isoKey].minVolt,
        tempSum: dayMetrics[isoKey].tempSum,
        tempCount: dayMetrics[isoKey].tempCount,
        minTemp: dayMetrics[isoKey].minTemp === 99 ? null : dayMetrics[isoKey].minTemp,
        maxTemp: dayMetrics[isoKey].maxTemp === -99 ? null : dayMetrics[isoKey].maxTemp,
        heatKwh: dayMetrics[isoKey].heatWh / 1000,
        tuvKwh: dayMetrics[isoKey].tuvWh / 1000,
        cop: dayMetrics[isoKey].tWh > 0 ? ((dayMetrics[isoKey].heatTpWh + dayMetrics[isoKey].tuvTpWh) / dayMetrics[isoKey].tWh) : 0,
        kwhPerHdd: dayMetrics[isoKey].hdd > 0 ? (dayMetrics[isoKey].heatWh / 1000) / dayMetrics[isoKey].hdd : 0,
        runTimeHours: dayMetrics[isoKey].runTimeHours,
        heatRunHours: dayMetrics[isoKey].heatRunHours || 0,
        totalHours: dayMetrics[isoKey].totalHours || 0,
        ecoPercent: dayMetrics[isoKey].runTicks > 0 ? (dayMetrics[isoKey].ecoTicks / dayMetrics[isoKey].runTicks) * 100 : 0,
        rawStarts: dayMetrics[isoKey].rawStarts,
        netStarts: dayMetrics[isoKey].netStarts,
        shorts: dayMetrics[isoKey].shorts,
        tuvRuns: dayMetrics[isoKey].tuvRuns,
        defrostRuns: dayMetrics[isoKey].defrostRuns,
        heatRuns: dayMetrics[isoKey].heatRuns,
        standbyWh: dayMetrics[isoKey].standbyWh,
        standbyHours: dayMetrics[isoKey].standbyHours
    });
    const _hMonth = isoKey ? parseInt(isoKey.split('-')[1], 10) - 1 : -1; // 0-11
    finalDailyHealth[isoKey] = evaluateHealth(dayMetrics[isoKey].netStarts, dayMetrics[isoKey].shorts, dayMetrics[isoKey].totalHours, _hMonth);
});

const finalMonthlyStats = [];
const monthNames = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
Object.keys(monthMetrics).sort().forEach(isoKey => {
    const parts = isoKey.split('-');
    finalMonthlyStats.push({ 
        isoKey: isoKey,
        label: `${monthNames[parseInt(parts[1]) - 1]} ${parts[0]}`, 
        value: monthMetrics[isoKey].cost,
        tWh: monthMetrics[isoKey].tWh,
        heatWh: monthMetrics[isoKey].heatWh,
        tuvWh: monthMetrics[isoKey].tuvWh,
        heatTpWh: monthMetrics[isoKey].heatTpWh,
        tuvTpWh: monthMetrics[isoKey].tuvTpWh,
        heatKwh: monthMetrics[isoKey].heatWh / 1000,
        tuvKwh: monthMetrics[isoKey].tuvWh / 1000,
        defrostWh: monthMetrics[isoKey].defrostWh,
        hdd: monthMetrics[isoKey].hdd,
        hddStd: monthMetrics[isoKey].hddStd || 0,
        minVolt: monthMetrics[isoKey].minVolt === 999 ? null : monthMetrics[isoKey].minVolt,
        cop: monthMetrics[isoKey].tWh > 0 ? ((monthMetrics[isoKey].heatTpWh + monthMetrics[isoKey].tuvTpWh) / monthMetrics[isoKey].tWh) : 0,
        kwhPerHdd: monthMetrics[isoKey].hdd > 0 ? (monthMetrics[isoKey].heatWh / 1000) / monthMetrics[isoKey].hdd : 0,
        runTimeHours: monthMetrics[isoKey].runTimeHours,
        totalHours: monthMetrics[isoKey].totalHours || 0,
        ecoPercent: monthMetrics[isoKey].runTicks > 0 ? (monthMetrics[isoKey].ecoTicks / monthMetrics[isoKey].runTicks) * 100 : 0,
        rawStarts: monthMetrics[isoKey].rawStarts,
        netStarts: monthMetrics[isoKey].netStarts,
        shorts: monthMetrics[isoKey].shorts,
        tuvRuns: monthMetrics[isoKey].tuvRuns,
        defrostRuns: monthMetrics[isoKey].defrostRuns,
        heatRuns: monthMetrics[isoKey].heatRuns
    });
});

return { dailyStats: finalDailyStats, monthlyStats: finalMonthlyStats, dailyHealth: finalDailyHealth, seasonalStats: seasonalStats };
}
 
function getEnergyFromPoint(d, durationHours) {
if (!d || d.isMissing || durationHours <= 0) return 0;
if (d.e && d.e > 0 && Number.isFinite(d.e)) return d.e;
return ((Number.isFinite(d.p) && d.p > 0) ? d.p : 0) * durationHours;
}
 
// ==========================================
// 6. ROBUSTNÍ PARSER
// ==========================================
// ─── SEKCE 9: PARSING VSTUPNÍCH DAT ──────────────────────────────────────────

function parseData(text, config) {
if (!text || typeof text !== 'string') return [];
let lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
if (lines.length === 0) return [];
const delimiter = detectDelimiter(lines[0]);
let colMap = null;
if (looksLikeHeader(lines[0], delimiter)) { colMap = mapColumnsFromHeader(lines[0], delimiter); lines.shift(); }
const fallback = { ts: 0, e: 1, pMax: 5, pMin: 6, v: 11 };
const toFloatSafe = (s) => {
    if (s === null || s === undefined) return NaN;
    const cleaned = String(s).trim().replace(/\s+/g, '').replace(',', '.');
    const v = parseFloat(cleaned);
    return Number.isFinite(v) ? v : NaN;
};
const toIntSafe = (s) => {
    if (s === null || s === undefined) return NaN;
    const cleaned = String(s).trim().replace(/\s+/g, '');
    const v = parseInt(cleaned, 10);
    return Number.isFinite(v) ? v : NaN;
};
const res = [];
for (let i = 0; i < lines.length; i++) {
    const parts = splitLine(lines[i], delimiter);
    const idx = colMap || fallback;
    // Dynamický minimální počet sloupců: potřebujeme alespoň ts a pMax
    // (ostatní sloupce mají fallback hodnoty)
    const minCols = Math.max(idx.ts, idx.pMax,
        (idx.pMin > 0 ? idx.pMin : 0),
        (idx.v    > 0 ? idx.v    : 0),
        (idx.e    > 0 ? idx.e    : 0)) + 1;
    if (parts.length < minCols) continue;
    const ts = toIntSafe(parts[idx.ts]);
    const e = (idx.e >= 0 && parts[idx.e] !== undefined) ? toFloatSafe(parts[idx.e]) : 0;
    const pMaxRaw = toFloatSafe(parts[idx.pMax]);
    const pMinRaw = (idx.pMin >= 0 && parts[idx.pMin] !== undefined) ? toFloatSafe(parts[idx.pMin]) : pMaxRaw;
    const vRaw    = (idx.v    >= 0 && parts[idx.v]    !== undefined) ? toFloatSafe(parts[idx.v])    : NaN;
    if (!Number.isFinite(ts) || !Number.isFinite(pMaxRaw)) continue;
    const pMax = pMaxRaw < 0 ? 0 : pMaxRaw;
    const pMin = pMinRaw < 0 ? 0 : pMinRaw;
    res.push({ ts, p_max: pMax, p_min: pMin, p: pMax, v: Number.isFinite(vRaw) ? vRaw : config.system.defVolt, e: Number.isFinite(e) ? e : 0 });
}
return res;
}
 
function detectDelimiter(sampleLine) {
if (sampleLine.includes(';')) return ';';
if (sampleLine.includes('\t')) return '\t';
return ',';
}
function splitLine(line, delimiter) { return line.split(delimiter).map(x => x.trim()); }
function looksLikeHeader(line, delimiter) {
const parts = splitLine(line, delimiter);
if (parts.length === 0) return false;
const first = parts[0];
return /[a-zA-Z_]/.test(line) || !/^\d+$/.test(first);
}
function mapColumnsFromHeader(headerLine, delimiter) {
const cols = splitLine(headerLine, delimiter).map(c => c.toLowerCase().trim().replace(/['"]/g, ''));
const findIndex = (candidates) => {
    for (const cand of candidates) {
        // Nejdřív přesná shoda, pak substring
        const exactIdx = cols.findIndex(x => x === cand);
        if (exactIdx !== -1) return exactIdx;
        const partIdx = cols.findIndex(x => x.includes(cand));
        if (partIdx !== -1) return partIdx;
    }
    return -1;
};
// Aliasy pro různé formáty: Shelly Gen1/Gen2, vlastní export, Victron, obecný
const tsIdx   = findIndex(['timestamp', 'cas', 'time', 'datetime', 'date_time', 'unix', 'epoch', 'ts']);
const eIdx    = findIndex(['total_act_energy', 'spotreba', 'energy', 'kwh', 'consumption', 'act_energy', 'celkova_spotreba']);
const pMaxIdx = findIndex(['max_act_power', 'prikon', 'power', 'p_max', 'pmax', 'act_power', 'watt', 'load', 'vykon']);
const pMinIdx = findIndex(['min_act_power', 'p_min', 'pmin', 'power_min']);
const vIdx    = findIndex(['avg_voltage', 'napeti', 'voltage', 'volt', 'u_avg', 'napetie']);
if (tsIdx === -1 || pMaxIdx === -1) return null; // Minimum: časová značka + výkon
return {
    ts:   tsIdx,
    e:    eIdx    !== -1 ? eIdx    : -1,    // -1 = sloupec chybí → e=0
    pMax: pMaxIdx,
    pMin: pMinIdx !== -1 ? pMinIdx : pMaxIdx, // fallback: pMin = pMax
    v:    vIdx    !== -1 ? vIdx    : -1     // -1 = sloupec chybí → defVolt
};
}
 
// ─── SEKCE 10: VÝPLŇ MEZER A INTERPOLACE ─────────────────────────────────────

function fillGapsSafe(data, config) {
if (!data || data.length < 2) return data;
const filled = [];
const MAX_GAP = config.durations.maxGapS;
// Výpadky se plní minutu po minutě (isMissing=true) — bez omezení délky.
// Pipeline tyto body přeskočí (TYPE.MISSING → žádné výpočty).
// Graf je zobrazí jako prázdný/šedý úsek zachovávající správné časové měřítko.
// Začátek výpadku nese isGapStart=true pro případné UI označení.
for (let i = 0; i < data.length - 1; i++) {
    const curr = data[i], next = data[i + 1];
    filled.push(curr);
    const diff = next.ts - curr.ts;
    if (diff > MAX_GAP) {
        const mCount = Math.floor((diff - 60) / 60);
        for (let m = 1; m <= mCount; m++) {
            filled.push({
                ts: curr.ts + (m * 60),
                p_max: 0, p_min: 0, p: 0,
                v: config.system.defVolt, e: 0,
                isMissing: true,
                isGapStart: m === 1 // první bod výpadku — označení pro UI
            });
        }
    }
}
filled.push(data[data.length - 1]);
return filled;
}

// ==========================================
// 7. DETEKCE CYKLŮ A TYPŮ BĚHU
// ==========================================
// ─── SEKCE 11: DETEKCE CYKLŮ (TUV, DEFROST, OIL) ────────────────────────────

function getDynamicTuvLimit(temp, config) {
if (temp == null) temp = 0;
if (temp <= config.designTemp) return config.tuv.dynMax;
if (temp >= 5) return config.tuv.dynMin;
// Ochrana proti dělení nulou: pokud designTemp === 5, vrať krajní hodnotu
if (5 - config.designTemp === 0) return config.tuv.dynMax;
return config.tuv.dynMax - ((temp - config.designTemp) * ((config.tuv.dynMax - config.tuv.dynMin) / (5 - config.designTemp)));
}

function detectCycles(data, config) {
const runs = identifyRuns(data, config);
runs.forEach(run => {
    const metrics = calculateRunMetrics(run, data);
    run.rMax = metrics.rMax; run.startTs = data[run.start].ts; run.endTs = data[run.end].ts;
    run.duration = (run.endTs - run.startTs) / 60;
    if (run.duration < 1) run.duration = 1;
});
return { runs: runs };
}

function markDefrostCyclesPattern(data, types, descriptions, config) {
let i = 1;
while (i < data.length - 5) {
    if (types[i] === TYPE.TUV || types[i] === TYPE.MISSING) {
        i++;
        continue;
    }
    // Teplotní guard: odmrazování je fyzikálně nemožné nad ~8°C
    // (vzduch při teplotách > 8°C nekondenzuje na výparníku, námraza nevzniká)
    if (data[i].temp !== null && data[i].temp !== undefined && data[i].temp > 8) {
        i++;
        continue;
    }

    // Klouzavý průměr předchozích 3 ticků pro preMax — stabilnější než jediný tick
    // (eliminuje falešné triggery z jednorázových výkyvů příkonu)
    let preMaxSum = 0, preMaxCount = 0;
    for (let pm = Math.max(1, i - 3); pm < i; pm++) {
        if (data[pm].p_max) { preMaxSum += data[pm].p_max; preMaxCount++; }
    }
    let preMax = preMaxCount > 0 ? preMaxSum / preMaxCount : data[i-1].p_max;
    let currMax = data[i].p_max;
    let currMin = data[i].p_min;

// isDrop: výrazný pokles výkonu oproti předchozímu minutu — signál začátku odmrazu
// Vyloučíme DEFROST, PRESSURE a Recovery jako základ (ty samy jsou výsledkem odmrazu)
let isDrop = false;
if (preMax > 500 && types[i-1] !== TYPE.OIL
&& types[i-1] !== TYPE.DEFROST
&& types[i-1] !== TYPE.PRESSURE
&& descriptions[i-1] !== "Dohřev (Recovery)") {
if (currMax < preMax * 0.70) isDrop = true;
if (currMin < preMax * 0.5 && currMin < 400) isDrop = true;
}


    if (isDrop) {
        let foundSpikeIdx = -1;
        let maxInside = 0;
        let minInside = 9999;
        
        for (let j = i; j < Math.min(data.length, i + 20); j++) {
            if (types[j] === TYPE.TUV || types[j] === TYPE.MISSING) break; 
            
if (data[j].p_max > 1200 && data[j].p_max > preMax * 0.85) {
if (types[j] === TYPE.OIL) break;
foundSpikeIdx = j;
break;
}
            if (data[j].p_max > maxInside) maxInside = data[j].p_max;
            if (data[j].p_min < minInside) minInside = data[j].p_min;
        }

        if (foundSpikeIdx !== -1) {
            let durationMins = (data[foundSpikeIdx].ts - data[i].ts) / 60;
            
            // Odmraz trvá reálně 2-10 minut (EN 14511 testuje do 10 min)
            // Limit 15 minut poskytuje bezpečnostní rezervu
            if (durationMins >= 1 && durationMins <= 15) {
                
                let phase = 1; 
                const PRESSURE_THRESHOLD = 350; 
                
                for (let k = i; k < foundSpikeIdx; k++) {
                    let p = data[k].p_max;
                    
                    // Fáze 1: vyrovnání tlaků → fáze 2: aktivní odmraz → fáze 3: zpět na tlak
                    if (phase === 1) {
                        if (p < PRESSURE_THRESHOLD || data[k].p_min < PRESSURE_THRESHOLD) {
                            types[k] = TYPE.PRESSURE;
                            descriptions[k] = "Vyrovnání tlaků";
                        } else {
                            phase = 2;
                            types[k] = TYPE.DEFROST;
                            descriptions[k] = "Odmrazování";
                        }
                    } else if (phase === 2) {
                        types[k] = TYPE.DEFROST;
                        descriptions[k] = "Odmrazování";
                        
                        if (p < PRESSURE_THRESHOLD || data[k].p_min < PRESSURE_THRESHOLD) {
                            phase = 3;
                            types[k] = TYPE.PRESSURE;
                            descriptions[k] = "Vyrovnání tlaků";
                        }
                    } else {
                        types[k] = TYPE.PRESSURE;
                        descriptions[k] = "Vyrovnání tlaků";
                    }
                }
                
                let dohrevEnd = Math.min(data.length - 1, foundSpikeIdx + 15);
                for (let k = foundSpikeIdx; k <= dohrevEnd; k++) {
                    if (types[k] === TYPE.TUV || types[k] === TYPE.MISSING) break;
                    if (k > foundSpikeIdx && data[k].p_max < preMax * 1.1 && data[k].p_max < 1200) break;
                    types[k] = TYPE.HEAT_STD;
                    descriptions[k] = "Dohřev (Recovery)";
                }
                
                i = foundSpikeIdx; 
                continue;
            }
        }
    }
    i++;
}
}
 
// ─── SEKCE 12: ANALÝZA TYPŮ A BĚHŮ ──────────────────────────────────────────

function analyzeData(data, config) {
const types = new Array(data.length);
const descriptions = new Array(data.length);
for (let k = 0; k < data.length; k++) {
    if (data[k].isMissing) { types[k] = TYPE.MISSING; descriptions[k] = "Chybějící data"; }
    else { types[k] = TYPE.GRAY; descriptions[k] = "Standby"; }
}
if (data.length < 2) return { types, descriptions, runs: [] };
const cycleData = detectCycles(data, config);
const runs = cycleData.runs;
 
runs.forEach((run) => {
    if (run.end === data.length - 1 && run.duration <= 30) {
        run.type = 'RUNNING'; fillData(types, descriptions, run, TYPE.GRAY, "Probíhající"); return;
    }
    
    let maxP = 0;
    let peakIdx = run.start;
    let avgTemp = 0;
    let tempCount = 0;

    for (let k = run.start; k <= run.end; k++) { 
        if (data[k].p > maxP) { maxP = data[k].p; peakIdx = k; }
        if (data[k].temp != null) { avgTemp += data[k].temp; tempCount++; }
    }
    if (tempCount > 0) avgTemp /= tempCount; else avgTemp = 0;

    const dynamicLimit = getDynamicTuvLimit(avgTemp, config);

    if (maxP > dynamicLimit) {
        if (run.duration < config.tuv.maxTuv) {
            fillData(types, descriptions, run, TYPE.TUV, "Ohřev TUV");
            run.type = 'TUV';
        } else {
            let tuvStart = peakIdx;
            for (let k = peakIdx; k >= run.start; k--) {
                tuvStart = k;
                if (data[k].p < config.tuv.endW) break;
            }

            let tuvEnd = peakIdx;
            for (let k = peakIdx; k <= run.end; k++) {
                tuvEnd = k;
                if (data[k].p < config.tuv.endW) break;
                if (k + 1 <= run.end && (data[k].p - data[k+1].p) > config.tuv.dropW) {
                    tuvEnd = k;
                    break;
                }
            }
            
            let sliceDuration = (data[tuvEnd].ts - data[tuvStart].ts) / 60;

            if (sliceDuration < config.tuv.maxTuv) {
                let startDiffMins = (data[tuvStart].ts - data[run.start].ts) / 60;
                if (startDiffMins <= 15) {
                    tuvStart = run.start;
                }

                let endDiffMins = (data[run.end].ts - data[tuvEnd].ts) / 60;
                if (endDiffMins <= 5) {
                    tuvEnd = run.end;
                }

                fillData(types, descriptions, {start: tuvStart, end: tuvEnd}, TYPE.TUV, "Ohřev TUV");
                run.type = 'MIXED'; 
                
                if (tuvStart > run.start) {
                    classifyHeatCycle(types, descriptions, {start: run.start, end: tuvStart - 1, duration: (data[tuvStart - 1].ts - data[run.start].ts)/60}, data, config);
                }
                if (tuvEnd < run.end) {
                    classifyHeatCycle(types, descriptions, {start: tuvEnd + 1, end: run.end, duration: (data[run.end].ts - data[tuvEnd + 1].ts)/60}, data, config);
                }
            } else {
                classifyHeatCycle(types, descriptions, run, data, config);
                run.type = 'HEAT';
            }
        }
    } else {
        classifyHeatCycle(types, descriptions, run, data, config);
        run.type = 'HEAT';
    }
});

markDefrostCyclesPattern(data, types, descriptions, config);
 
runs.forEach((run, i) => {
    if (run.type !== 'TUV' && run.type !== 'MIXED' && isRiskCycle(run, runs, i, data, config)) {
        run.isShort = true; fillData(types, descriptions, run, TYPE.RISK, "Rizikový (< " + config.limits.minRun + "m)");
    }
    
    run.isContinuation = false;
    if (i > 0) {
        const prevRun = runs[i - 1];
        const gapMins = (data[run.start].ts - data[prevRun.end].ts) / 60;
        if (gapMins < 20) {
            for (let k = prevRun.end; k < run.start; k++) {
                if (types[k] === TYPE.DEFROST || types[k] === TYPE.PRESSURE) {
                    run.isContinuation = true;
                    break;
                }
            }
        }
    }

    run.isValidStart = false;
    if (run.start > 0 && data[run.start - 1].p <= config.limits.run) {
        run.isValidStart = true;
    }
});

return { types, descriptions, runs };
}
 
function identifyRuns(data, config) {
let rawRuns = [], isR = false, sI = -1;
data.forEach((pt, i) => {
    if (!pt || pt.isMissing) { if (isR) { rawRuns.push({ start: sI, end: i - 1 }); isR = false; } return; }
    if (pt.p > config.limits.run) { if (!isR) { isR = true; sI = i; } }
    else { if (isR) { rawRuns.push({ start: sI, end: i - 1 }); isR = false; } }
});
if (isR) rawRuns.push({ start: sI, end: data.length - 1 });
if (rawRuns.length === 0) return [];
if (!config.filters.noiseFilter) return rawRuns;
const noiseThreshold = config.limits.run + config.filters.noiseW;
return rawRuns.filter(r => {
    const dur = (data[r.end].ts - data[r.start].ts) / 60;
    let maxP = 0; for (let k = r.start; k <= r.end; k++) maxP = Math.max(maxP, data[k].p);
    return (dur >= config.filters.noiseMins || maxP >= noiseThreshold);
});
}
 
function calculateRunMetrics(run, data) {
let rMax = 0;
for (let k = run.start; k <= run.end; k++) {
    const val = data[k] ? data[k].p : 0;
    if (val > rMax) rMax = val;
}
return { rMax };
}

function classifyHeatCycle(types, descriptions, run, data, config) {
let spikeStart = -1, ecoStart = -1;
const OIL_RATIO = config.filters.oilRatio;
// ECO práh: relativní k maximálnímu výkonu běhu.
// Moderní invertorová TČ modulují na ~20-25% jmenovitého příkonu.
// max(ecoMax, rMax×0.22) zachytí ECO u velkých TČ i dodržuje absolutní minimum.
const runMax = run.rMax || config.limits.softCap;
const ecoThreshold = Math.max(config.limits.ecoMax, Math.round(runMax * 0.22));
for (let k = run.start; k <= run.end; k++) {
    const val = data[k].p;
    if (val > config.limits.oilWatts) { if (spikeStart === -1) spikeStart = k; }
    else {
        if (spikeStart !== -1) {
            const spikeEnd = k - 1;
            if ((data[spikeEnd].ts - data[spikeStart].ts) / 60 < 4) {
                let sSum = 0; for (let i = spikeStart; i <= spikeEnd; i++) sSum += data[i].p;
                const sAvg = sSum / (spikeEnd - spikeStart + 1);
                let bS = 0, bC = 0; for (let i = Math.max(run.start, spikeStart - 5); i < spikeStart; i++) { bS += data[i].p; bC++; }
                let aS = 0, aC = 0; for (let i = k; i < Math.min(run.end + 1, k + 5); i++) { aS += data[i].p; aC++; }
                if (bC > 0 && aC > 0 && sAvg > (bS / bC) * OIL_RATIO && sAvg > (aS / aC) * OIL_RATIO) { for (let j = spikeStart; j <= spikeEnd; j++) { types[j] = TYPE.OIL; descriptions[j] = "Oil Return"; } ecoStart = -1; }
            }
            spikeStart = -1;
        }
    }
    if (types[k] === TYPE.OIL) continue;
    if (val < ecoThreshold) { if (ecoStart === -1) ecoStart = k; }
    else { if (ecoStart !== -1) { if ((data[k].ts - data[ecoStart].ts) / 60 > 5) { for (let j = ecoStart; j < k; j++) { if (types[j] !== TYPE.OIL) { types[j] = TYPE.HEAT_ECO; descriptions[j] = "Eko Modulace"; } } } ecoStart = -1; } }
    if (types[k] === TYPE.GRAY) { types[k] = TYPE.HEAT_STD; descriptions[k] = "Standard"; }
}

if (ecoStart !== -1) {
    if ((data[run.end].ts - data[ecoStart].ts) / 60 > 5) {
        for (let j = ecoStart; j <= run.end; j++) {
            if (types[j] !== TYPE.OIL) { 
                types[j] = TYPE.HEAT_ECO; 
                descriptions[j] = "Eko Modulace"; 
            }
        }
    }
}
}
 
function isRiskCycle(run, allRuns, index, data, config) {
if ((run.type !== 'HEAT' && run.type !== 'MIXED') || run.start === 0 || run.duration <= 3) return false;
if (run.duration < config.limits.minRun) {
    const gapLimit = config.durations.riskGap || 45;
    const pauseBefore = index > 0 ? (data[run.start].ts - data[allRuns[index - 1].end].ts) / 60 : Infinity;
    const pauseAfter = index < allRuns.length - 1 ? (data[allRuns[index + 1].start].ts - data[run.end].ts) / 60 : Infinity;
    if (pauseBefore > gapLimit || pauseAfter > gapLimit) return false;
    const isPrecededByTuv = index > 0 && (allRuns[index - 1].type === 'TUV' || allRuns[index - 1].type === 'MIXED');
    const isFollowedByTuv = index < allRuns.length - 1 && (allRuns[index + 1].type === 'TUV' || allRuns[index + 1].type === 'MIXED');
    if (isPrecededByTuv || isFollowedByTuv) return false;
    
    // Kontrola zda po krátkém cyklu nenásleduje odmraz (pak nejde o rizikový start)
    // Skenujeme až OD bodu za koncem běhu (run.end + 1) — run.end je poslední bod
    // samotného běhu, nepatří do "následujícího" úseku a způsoboval off-by-one.
    let hasDefrostNext = false;
    for (let k = run.end + 1; k <= Math.min(data.length-1, run.end + 10); k++) {
        if (data[k].p_max > config.limits.defrostSpike) hasDefrostNext = true;
    }
    if (hasDefrostNext) return false;

    return true;
}
return false;
}
 
function fillData(types, descriptions, run, type, text) {
for (let k = run.start; k <= run.end; k++) { types[k] = type; descriptions[k] = text; }
}

// ==========================================
// 8. AGREGACE TERMO A FINANCE
// ==========================================

// ─── SEKCE 13: TERMOSTATIKA A FINANCE (long-term) ────────────────────────────

function calculateThermoMetrics(dailyStats, maxTcCurve, config, physics) {
if (!dailyStats || dailyStats.length === 0) return null;

const sorted = [...dailyStats].sort((a,b) => a.dateStr.localeCompare(b.dateStr));
const trendDays = config.system.trendDays || 7;
const recentArr = sorted.slice(-trendDays);
const olderArr = sorted.slice(0, -trendDays);

const agg = (arr) => {
    let r = { tWh:0, heatWh:0, tuvWh:0, heatTpWh:0, tuvTpWh:0, hdd:0, defrostWh:0, minVolt:null, days:arr.length, totalHours:0 };
    let vSum = 0, vCount = 0;
    arr.forEach(d => {
        r.tWh += d.tWh; r.heatWh += d.heatWh; r.tuvWh += d.tuvWh;
        r.heatTpWh += d.heatTpWh; r.tuvTpWh += d.tuvTpWh;
        r.hdd += d.hdd; r.defrostWh += d.defrostWh;
        r.totalHours += (d.totalHours || 0);
        if (d.minVolt !== null) {
            vSum += d.minVolt;
            vCount++;
        }
    });
    if (vCount > 0) r.minVolt = vSum / vCount;
    return r;
};

const all = agg(sorted);
const recent = agg(recentArr);
const older = agg(olderArr);

const gainW_zima = physics && physics.dynamicGainW_zima !== undefined ? physics.dynamicGainW_zima : (config.internalGainW || 0);
const gainW_prechod = physics && physics.dynamicGainW_prechod !== undefined ? physics.dynamicGainW_prechod : (config.internalGainW || 0);

let hkAll = physics ? physics.k_zima : 0; 

const getWeightedK = (arr) => {
    let k_sum = 0, w_sum = 0;
    arr.forEach(d => {
        if (d.hdd <= 0 || d.heatWh === 0) return;
        if ((d.heatRunHours || 0) < 1) return;
        // Průměrná teplota celého dne (konzistentní s heatTpWh/hdd/24 výpočtem)
        let avgT = d.tempCount > 0 ? (d.tempSum / d.tempCount) : 10;
        if (avgT >= 12) return;
        
        let usedGain = (avgT < 3) ? gainW_zima : gainW_prechod;
        let daily_k = (d.heatTpWh + (usedGain * (d.totalHours || 24))) / (d.hdd * 24);
        let deltaT = Math.max(1, config.targetIndoorTemp - avgT);
        let weight = Math.pow(deltaT, 6);
        k_sum += daily_k * weight;
        w_sum += weight;
    });
    return w_sum > 0 ? (k_sum / w_sum) : hkAll;
};

let hkRecent = getWeightedK(recentArr);
let hkOlder = getWeightedK(olderArr);

let lossAll_HP = (hkAll * (config.targetIndoorTemp - config.designTemp)) - gainW_zima;
let lossRecent_HP = (hkRecent * (config.targetIndoorTemp - config.designTemp)) - gainW_zima;
let lossOlder_HP = (hkOlder * (config.targetIndoorTemp - config.designTemp)) - gainW_zima;

let area = (config && config.floorArea > 0) ? config.floorArea : 100;
let wm2All_HP = lossAll_HP / area; 
let wm2Recent_HP = lossRecent_HP / area; 
let wm2Older_HP = lossOlder_HP / area;

let bivExact = calculateExactBivalence(hkAll, maxTcCurve, config.targetIndoorTemp, gainW_zima);

let kwhHddAll    = all.hdd    > 0 ? (all.heatWh    / 1000) / all.hdd    : 0;
let kwhHddRecent = recent.hdd > 0 ? (recent.heatWh / 1000) / recent.hdd : 0;
let kwhHddOlder  = older.hdd  > 0 ? (older.heatWh  / 1000) / older.hdd  : 0;
// kWhHDD dle Eurostat (základ 18°C, práh 15°C) — srovnatelné s průmyslovými benchmarky
const allHddStd    = sorted.reduce((s, d) => s + (d.hddStd || 0), 0);
const recentHddStd = recentArr.reduce((s, d) => s + (d.hddStd || 0), 0);
const olderHddStd  = olderArr.reduce((s, d) => s + (d.hddStd || 0), 0);
let kwhHddStdAll    = allHddStd    > 0 ? (all.heatWh    / 1000) / allHddStd    : 0;
let kwhHddStdRecent = recentHddStd > 0 ? (recent.heatWh / 1000) / recentHddStd : 0;
let kwhHddStdOlder  = olderHddStd  > 0 ? (older.heatWh  / 1000) / olderHddStd  : 0;
// Měřený SPF (Seasonal Performance Factor) z historických dat
// Přesnější než bin projekce — skutečný výkon tohoto TČ v této instalaci
const spfAll = (() => {
    let tpSum = 0, elSum = 0;
    sorted.forEach(d => {
        if ((d.heatRunHours || 0) >= 1) {
            tpSum += d.heatTpWhClean > 0 ? d.heatTpWhClean : d.heatTpWh;
            elSum += d.heatWhClean   > 0 ? d.heatWhClean   : d.heatWh;
        }
    });
    const spf = elSum > 0 ? tpSum / elSum : 0;
    // Sanity guard: měřený SPF musí být konečný a nezáporný, jinak výchozí 0
    return (Number.isFinite(spf) && spf >= 0) ? spf : 0;
})();

return {
    all, recent, older,
    houseK: { all: hkAll, recent: hkRecent, older: hkOlder },
    lossHP: { all: lossAll_HP, recent: lossRecent_HP, older: lossOlder_HP },
    wm2HP: { all: wm2All_HP, recent: wm2Recent_HP, older: wm2Older_HP },
    bivExact,
    kwhHdd:    { all: kwhHddAll,    recent: kwhHddRecent,    older: kwhHddOlder    },
    kwhHddStd: { all: kwhHddStdAll, recent: kwhHddStdRecent, older: kwhHddStdOlder },
    measuredSpf: spfAll, // skutečný SPF z naměřených dat (přesnější než bin projekce)
    gains: { zima: gainW_zima, prechod: gainW_prechod }
};
}

function calculateFinanceMetrics(seasonalStats, dailyStats, dynamicMonthlyCop, config, physics) {
if (!seasonalStats) return null;

// Pojmenované výchozí konstanty (fallbacky) — hodnoty zachovány beze změny
const FIN_DEFAULT_STANDBY_W = 145;        // výchozí klidový příkon [W], když nejsou data o standby
const FIN_DEFAULT_THERMAL_POWER_W = 2400; // výchozí tepelný výkon TČ [W] pro odhad doby chodu
const FIN_MIN_THERMAL_POWER_W = 1800;     // minimální věrohodný tepelný výkon [W] — pod ním fallback
const FIN_FALLBACK_MONTHLY_COP = 4.0;     // výchozí měsíční COP, když chybí v dynamicMonthlyCop

const gainW_zima = physics && physics.dynamicGainW_zima !== undefined ? physics.dynamicGainW_zima : (config.internalGainW || 0);
const gainW_prechod = physics && physics.dynamicGainW_prechod !== undefined ? physics.dynamicGainW_prechod : (config.internalGainW || 0);

const processSeason = (s) => {
    let days = (s.lTs - s.fTs) / 86400; if (days < 1) days = 1;
    const avgTotalKwh = (s.tWh / 1000) / days;
    const avgHeatKwh = (s.hWh / 1000) / days;
    const avgTuvKwh = (s.tuWh / 1000) / days;
    
    const avgStandbyKwh = s.standbyWh ? (s.standbyWh / 1000) / days : 0;
    const totalStandbyKwh = s.standbyWh ? (s.standbyWh / 1000) : 0;
    
    let recentStandbyW = 0;
    if (dailyStats && dailyStats.length > 0) {
        const trendDays = config.system.trendDays || 7;
        const recentDays = dailyStats.slice(-trendDays);
        let rStWh = 0, rStHrs = 0;
        recentDays.forEach(d => {
            rStWh += (d.standbyWh || 0);
            rStHrs += (d.standbyHours || 0);
        });
        if (rStHrs > 0) recentStandbyW = rStWh / rStHrs;
    }
    
    let seasonAvgStandbyW = s.standbyHours > 0 ? s.standbyWh / s.standbyHours : FIN_DEFAULT_STANDBY_W;
    let avgStandbyW = recentStandbyW > 0 ? recentStandbyW : seasonAvgStandbyW;
    // Sanity guard: standby musí být konečný a nezáporný, jinak výchozí hodnota
    if (!Number.isFinite(avgStandbyW) || avgStandbyW < 0) avgStandbyW = FIN_DEFAULT_STANDBY_W;
    
    let avgTuvThermalWh = (s.tuvTpWh || 0) / days;
    
    // Viz globální isSummerData: posuzuj podle modelu budovy + obsahu topení
    // v reálných datech, NE podle průměrné teploty celého období.
    const isSummerData = !physics || (s.tWh > 0 && (s.hWh / s.tWh) < 0.3);

    let yearlyHeatWhEl = 0; let yearlyHeatWhThermal = 0;
    let yearlyTuvWhEl = 0; let yearlyTuvWhThermal = 0;
    let estRunHours = 0;
    let modelYearHdd = 0;

    let avgThermalPowerW = (s.runTimeHours && s.runTimeHours > 0) ? (s.heatTpWh / s.runTimeHours) : FIN_DEFAULT_THERMAL_POWER_W;
    // Sanity guard: tepelný výkon musí být konečný a nad minimem, jinak výchozí hodnota
    if (!Number.isFinite(avgThermalPowerW) || avgThermalPowerW < FIN_MIN_THERMAL_POWER_W) avgThermalPowerW = FIN_DEFAULT_THERMAL_POWER_W;

    (config.evanTemps || []).forEach((tOut, index) => {
        const daysInMonth = config.estimations.monthDays;
        
        let mCop = estimateCOP(tOut, true, config);
        let mTuvTh = avgTuvThermalWh * daysInMonth * config.estimations.tuvLoss;
        if(mTuvTh === 0 && avgTuvKwh > 0) mTuvTh = avgTuvKwh * 1000 * mCop * daysInMonth * config.estimations.tuvLoss;
        yearlyTuvWhEl += (mTuvTh / mCop);
        yearlyTuvWhThermal += mTuvTh;
        estRunHours += (mTuvTh / 3500); 

        if (tOut < config.heatingThreshold && physics) {
            const mDiff = config.targetIndoorTemp - tOut;
            const usedK = (tOut < 3) ? physics.k_zima : physics.k_prechod;
            const usedGain = (tOut < 3) ? gainW_zima : gainW_prechod;
            
            let thermalReq = Math.max(0, (usedK * mDiff) - usedGain) * 24 * daysInMonth;
            const currentCop = (dynamicMonthlyCop && dynamicMonthlyCop[index]) ? dynamicMonthlyCop[index] : FIN_FALLBACK_MONTHLY_COP;
            // Korekce Jensenovy nerovnosti: COP(T) je konkávní → COP(avg T) > avg COP(T)
            // Pro měsíční průměrné teploty SCOP je nadhodnocen o ~5-9%.
            // Korekční faktor závisí na teplotní variabilitě (σ) a zakřivení COP(T).
            // Přibližná korekce: multiplicativní faktor 0.93 pro zimní měsíce (σ≈5°C),
            // 0.97 pro přechodné měsíce (σ≈3°C). Zdroj: EN 14825 binová analýza.
            const jensenCorr = tOut < 0 ? 0.93 : (tOut < 7 ? 0.95 : 0.97);
            const correctedCop = currentCop * jensenCorr;
            yearlyHeatWhEl += (thermalReq / correctedCop);
            yearlyHeatWhThermal += thermalReq;
            
            estRunHours += (thermalReq / avgThermalPowerW);
            modelYearHdd += Math.max(0, config.targetIndoorTemp - tOut) * daysInMonth;
        }
    });
    
    let standbyHoursYear = Math.max(0, (365 * 24) - estRunHours);
    let yearlyStandbyWhEl = standbyHoursYear * avgStandbyW;

    const estTuvKwh = yearlyTuvWhEl / 1000;
    const totalEstElKwh = (yearlyHeatWhEl / 1000) + estTuvKwh + (yearlyStandbyWhEl / 1000);
    const totalEstThermalKwh = (yearlyHeatWhThermal / 1000) + (yearlyTuvWhThermal / 1000);
    let finalSCOP = totalEstElKwh > 0 ? totalEstThermalKwh / totalEstElKwh : 0;
    let finalScopHeat = yearlyHeatWhEl > 0 ? yearlyHeatWhThermal / yearlyHeatWhEl : 0;
    // Sanity guard: SCOP / SCOP topení musí být konečné a nezáporné, jinak výchozí 0
    if (!Number.isFinite(finalSCOP) || finalSCOP < 0) finalSCOP = 0;
    if (!Number.isFinite(finalScopHeat) || finalScopHeat < 0) finalScopHeat = 0;

    let remainingHddRatio = modelYearHdd > 0 ? Math.max(0, 1 - ((s.hdd || 0) / modelYearHdd)) : 0;
    let remainingDaysRatio = Math.max(0, 1 - (days / 365));

    let remHeatKwh = (yearlyHeatWhEl / 1000) * remainingHddRatio;
    let remTuvKwh = estTuvKwh * remainingDaysRatio;
    let remStandbyKwh = (yearlyStandbyWhEl / 1000) * remainingDaysRatio;

    let realEstKwh = (s.tWh / 1000) + remHeatKwh + remTuvKwh + remStandbyKwh;

    return {
        days,
        avgTotalKwh, avgHeatKwh, avgTuvKwh,
        totalKwh: s.tWh / 1000, totalHeatKwh: s.hWh / 1000, totalTuvKwh: s.tuWh / 1000,
        avgStandbyKwh, totalStandbyKwh,
        hdd: s.hdd,
        isSummerData,
        estTuvKwh, yearlyHeatWhEl, totalEstElKwh, finalSCOP, finalScopHeat,
        yearlyStandbyKwh: yearlyStandbyWhEl / 1000,
        avgStandbyW,
        realEstKwh
    };
};

const seasons = {};
for (const [key, s] of Object.entries(seasonalStats)) {
    seasons[key] = processSeason(s);
}

const totalStat = Object.values(seasonalStats).reduce((a, b) => ({
    tWh: a.tWh + b.tWh, hWh: a.hWh + b.hWh, tuWh: a.tuWh + b.tuWh, fTs: Math.min(a.fTs, b.fTs), lTs: Math.max(a.lTs, b.lTs),
    pSum: a.pSum + b.pSum, pCount: a.pCount + b.pCount, tempSum: a.tempSum + b.tempSum, tempCount: a.tempCount + b.tempCount, 
    heatTpWh: (a.heatTpWh||0) + (b.heatTpWh||0), 
    tuvTpWh: (a.tuvTpWh||0) + (b.tuvTpWh||0), 
    hdd: a.hdd + (b.hdd || 0),
    totalHours: (a.totalHours || 0) + (b.totalHours || 0),
    standbyWh: (a.standbyWh || 0) + (b.standbyWh || 0),
    standbyHours: (a.standbyHours || 0) + (b.standbyHours || 0),
    runTimeHours: (a.runTimeHours || 0) + (b.runTimeHours || 0)
}), { tWh: 0, hWh: 0, tuWh: 0, fTs: 9999999999, lTs: 0, pSum: 0, pCount: 0, tempSum: 0, tempCount: 0, heatTpWh: 0, tuvTpWh: 0, hdd: 0, totalHours: 0, standbyWh: 0, standbyHours: 0, runTimeHours: 0 });

const total = totalStat.fTs === 9999999999 ? null : processSeason(totalStat);

return { seasons, total };
}




