/* ---------- Constantes ---------- */
const DAY = 864e5;
/* Taxa de IVA nos combustíveis em Portugal continental, por data */
function ivaRate(t){ if (t < Date.UTC(2005,6,1)) return .19; if (t < Date.UTC(2008,6,1)) return .21; if (t < Date.UTC(2010,6,1)) return .20; if (t < Date.UTC(2011,0,1)) return .21; return .23; }

/* ---------- Formatação ---------- */
const MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const nf0 = new Intl.NumberFormat('pt-PT', {maximumFractionDigits:0});
const nf1 = new Intl.NumberFormat('pt-PT', {minimumFractionDigits:1, maximumFractionDigits:1});
const nf2 = new Intl.NumberFormat('pt-PT', {minimumFractionDigits:2, maximumFractionDigits:2});
const eur2 = v => nf2.format(v) + ' €';
const usd2 = v => nf2.format(v) + ' USD';
const fmtDate = t => { const d = new Date(t); return d.getUTCDate() + ' ' + MES[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
const fmtPct = v => (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + nf1.format(Math.abs(v)) + '%';
const $ = s => document.querySelector(s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Estado ---------- */
let D = null;
const charts = {};
const S = { main:{start:0,end:0,period:'5a'}, hidden:[false,false,false], base:0, comp:{fuel:'gasolina',start:0,end:0,period:'tudo'} };
const PERIODS = [['1a','1 ano',52],['5a','5 anos',261],['10a','10 anos',522],['tudo','Tudo',Infinity]];
const SERIES = [['brent','Brent'],['gasolina','Gasolina 95'],['gasoleo','Gasóleo']];

function prepare(payload){
  const rows = payload.weeks, t = rows.map(r => Date.parse(r.date + 'T00:00:00Z'));
  return {
    n: rows.length, t,
    brent: rows.map(r => r.brent_usd),
    gasolina: rows.map(r => r.gasolina), gasoleo: rows.map(r => r.gasoleo),
    gasolina_s: rows.map(r => r.gasolina_sem_imp), gasoleo_s: rows.map(r => r.gasoleo_sem_imp),
    updatedAt: Date.parse(payload.generated)
  };
}
function weekIndexFrom(ts){ const i = D.t.findIndex(t => t >= ts); return i < 0 ? D.n - 1 : i; }

/* ---------- Cores do tema ---------- */
function C(){
  const s = getComputedStyle(document.documentElement), g = n => s.getPropertyValue(n).trim();
  return { ink:g('--ink'), muted:g('--muted'), line:g('--line'), soft:g('--line-soft'), surface:g('--surface'),
           brent:g('--brent'), gasolina:g('--gasolina'), gasoleo:g('--gasoleo'), isp:g('--isp'), iva:g('--iva') };
}
function alpha(hex, a){ const h = hex.replace('#',''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }

/* ---------- Leitura de dados ---------- */
async function getData(){
  const r = await fetch('dados/semanal.json', {cache:'no-cache'});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function load(){
  setState('loading');
  destroyCharts();
  try {
    if (typeof Chart === 'undefined') throw new Error('Biblioteca de gráficos indisponível');
    const payload = await getData();
    if (!payload || !Array.isArray(payload.weeks) || payload.weeks.length < 60 || !payload.generated) throw new Error('Dados incompletos');
    D = prepare(payload);
    if (!S.main.end) initState();
    setState('ready');
    renderAll();
  } catch (e) {
    console.error(e);
    setState('error');
  }
}
function setState(st){
  document.body.dataset.state = st;
}
function initState(){
  const last = D.n - 1;
  S.main.end = last; S.main.start = Math.max(0, last - 261);
  S.comp.end = last; S.comp.start = 0;
  S.base = weekIndexFrom(Date.UTC(2021,0,1));
}

/* ---------- Texto e cartões ---------- */
function renderText(){
  const i = D.n - 1, y = Math.max(0, i - 52);
  $('#updated').innerHTML = `Atualizado a <b>${fmtDate(D.updatedAt)}</b><br>Preços da semana de ${fmtDate(D.t[i])}`;
  $('#lede').textContent = `Esta semana, um barril de Brent custa em média ${usd2(D.brent[i])} e um litro de gasóleo ${eur2(D.gasoleo[i])}.`;
  $('#lede-sub').textContent = `Há um ano, o barril custava ${usd2(D.brent[y])} e o gasóleo ${eur2(D.gasoleo[y])}. A gasolina 95 está hoje a ${eur2(D.gasolina[i])} por litro.`;
  $('#c-brent').textContent = usd2(D.brent[i]);
  $('#c-gas').textContent = eur2(D.gasolina[i]);
  $('#c-dsl').textContent = eur2(D.gasoleo[i]);
  spark('#s-brent', D.brent, 'var(--brent)');
  spark('#s-gas', D.gasolina, 'var(--gasolina)');
  spark('#s-dsl', D.gasoleo, 'var(--gasoleo)');
  const up = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1 9.5 9h-9z" fill="currentColor"/></svg>';
  const dn = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 9 .5 1h9z" fill="currentColor"/></svg>';
  const eq = '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="4" width="8" height="2" fill="currentColor"/></svg>';
  $('#var-list').innerHTML = SERIES.map(([k,label]) => {
    const p = (D[k][i] / D[k][i-1] - 1) * 100, abs = Math.abs(p) < .05;
    const word = abs ? 'sem alteração' : p > 0 ? 'sobe' : 'desce';
    return `<li><span class="name"><i class="dot" style="background:var(--${k})"></i>${label}</span><span class="chg">${abs ? eq : p > 0 ? up : dn}${fmtPct(p)}<span class="sr"> (${word})</span></span></li>`;
  }).join('');
}
function spark(sel, arr, color){
  const a = arr.slice(-26), mn = Math.min(...a), mx = Math.max(...a), sp = (mx - mn) || 1;
  const d = a.map((v,i) => `${i ? 'L' : 'M'}${(i / (a.length - 1) * 100).toFixed(2)} ${(27 - (v - mn) / sp * 24).toFixed(2)}`).join('');
  $(sel).innerHTML = `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.75" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
}

/* ---------- Comum aos gráficos ---------- */
function buildTimeTicks(scale){
  const min = scale.min, max = scale.max, span = (max - min) / DAY, narrow = scale.chart.width < 560, out = [];
  if (span <= 430){
    const step = narrow ? 3 : 2, d = new Date(min); let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    for (let g = 0; g < 30; g++){ if (m > 11){ m -= 12; y++; } const v = Date.UTC(y,m,1); if (v > max) break; if (m % step === 0) out.push({value:v}); m++; }
  } else {
    const yrs = span / 365.25, step = yrs <= 6 ? 1 : narrow ? (yrs > 12 ? 5 : 2) : (yrs > 12 ? 2 : 1);
    for (let y = new Date(min).getUTCFullYear() + 1; ; y++){ const v = Date.UTC(y,0,1); if (v > max) break; if (y % step === 0) out.push({value:v}); }
  }
  scale.ticks = out;
}
function xScale(c){
  return { type:'linear', bounds:'data', grid:{display:false}, border:{color:c.line},
    ticks:{ color:c.muted, maxRotation:0, autoSkip:false, font:{size:12},
      callback(v){ const d = new Date(v), span = (this.max - this.min) / DAY; return span <= 430 ? MES[d.getUTCMonth()] + (d.getUTCMonth() === 0 ? ' ' + d.getUTCFullYear() : '') : String(d.getUTCFullYear()); } },
    afterBuildTicks: buildTimeTicks };
}
function baseOpts(c){
  return {
    responsive:true, maintainAspectRatio:false, normalized:true,
    animation: reduceMotion ? false : {duration:450},
    interaction:{mode:'index', intersect:false},
    layout:{padding:{top:4}},
    plugins:{
      legend:{display:false},
      tooltip:{ backgroundColor:c.surface, titleColor:c.ink, bodyColor:c.ink, footerColor:c.muted, borderColor:c.line, borderWidth:1,
        padding:10, boxPadding:5, usePointStyle:true, titleFont:{weight:'600'}, bodyFont:{size:13}, footerFont:{size:12, weight:'400'},
        callbacks:{ title: it => 'Semana de ' + fmtDate(it[0].parsed.x),
          labelColor: ctx => ({borderColor:ctx.dataset.borderColor, backgroundColor:ctx.dataset.borderColor}),
          labelPointStyle: () => ({pointStyle:'circle', rotation:0}) } }
    }
  };
}
const crosshair = { id:'crosshair', afterDatasetsDraw(ch){
  const a = ch.tooltip && ch.tooltip.getActiveElements(); if (!a || !a.length) return;
  const x = a[0].element.x, {top,bottom} = ch.chartArea, ctx = ch.ctx;
  ctx.save(); ctx.strokeStyle = ch.options.plugins.crosshairColor || '#888'; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore(); } };
function slice(arr, s, e, f = v => v){ const o = new Array(e - s + 1); for (let i = s; i <= e; i++) o[i-s] = {x:D.t[i], y:f(arr[i], i)}; return o; }
function line(label, data, color, axis, w){
  return { label, data, borderColor:color, backgroundColor:color, yAxisID:axis, borderWidth:w, pointRadius:0, pointHoverRadius:4,
           pointHoverBorderWidth:2, pointHoverBorderColor:getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(), tension:0, fill:false };
}
function periodButtons(sel, current, onPick){
  const el = $(sel);
  el.innerHTML = PERIODS.map(([k,l]) => `<button data-k="${k}" aria-pressed="${k === current}">${l}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button'); if (!b) return; onPick(b.dataset.k); el.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
}
function periodRange(k){ const w = PERIODS.find(p => p[0] === k)[2], end = D.n - 1; return [Math.max(0, end - w), end]; }

/* ---------- Gráfico principal ---------- */
function buildMain(){
  const c = C(), {start,end} = S.main;
  charts.main = new Chart($('#chart-main'), {
    type:'line',
    data:{ datasets:[
      line('Brent', slice(D.brent,start,end), c.brent, 'yB', 2.25),
      line('Gasolina 95', slice(D.gasolina,start,end), c.gasolina, 'yF', 1.75),
      line('Gasóleo', slice(D.gasoleo,start,end), c.gasoleo, 'yF', 1.75) ].map((d,i) => (d.hidden = S.hidden[i], d)) },
    options:{ ...baseOpts(c),
      scales:{ x:xScale(c),
        yB:{ position:'left', display:'auto', grid:{color:c.soft}, border:{display:false}, ticks:{color:c.muted, font:{size:12}, maxTicksLimit:6, callback:v => nf0.format(v) + ' USD'} },
        yF:{ position:'right', display:'auto', grid:{display:false}, border:{display:false}, ticks:{color:c.muted, font:{size:12}, maxTicksLimit:6, callback:v => nf2.format(v) + ' €'} } },
      plugins:{ ...baseOpts(c).plugins, crosshairColor:c.muted,
        tooltip:{ ...baseOpts(c).plugins.tooltip, callbacks:{ ...baseOpts(c).plugins.tooltip.callbacks,
          label: ctx => ctx.dataset.yAxisID === 'yB' ? `Brent: ${usd2(ctx.parsed.y)} por barril` : `${ctx.dataset.label}: ${eur2(ctx.parsed.y)} por litro` } } } },
    plugins:[crosshair]
  });
  // legenda clicável
  const leg = $('#leg-main');
  leg.innerHTML = SERIES.map(([k,l],i) => `<button data-i="${i}" aria-pressed="${!S.hidden[i]}"><span class="sw" style="background:var(--${k})"></span>${l}</button>`).join('');
  leg.onclick = e => { const b = e.target.closest('button'); if (!b) return; const i = +b.dataset.i;
    S.hidden[i] = !S.hidden[i]; charts.main.setDatasetVisibility(i, !S.hidden[i]); charts.main.update(); b.setAttribute('aria-pressed', String(!S.hidden[i])); };
  periodButtons('#per-main', S.main.period, k => { S.main.period = k; [S.main.start, S.main.end] = periodRange(k); syncRange(); updateMain(); });
  buildRange();
}
function updateMain(){
  const {start,end} = S.main, ch = charts.main; if (!ch) return;
  ch.data.datasets[0].data = slice(D.brent,start,end);
  ch.data.datasets[1].data = slice(D.gasolina,start,end);
  ch.data.datasets[2].data = slice(D.gasoleo,start,end);
  ch.update('none');
  $('#rng-text').textContent = `${fmtDate(D.t[start])} a ${fmtDate(D.t[end])}`;
}
function buildRange(){
  const from = $('#r-from'), to = $('#r-to'), max = D.n - 1;
  [from,to].forEach(r => { r.min = 0; r.max = max; r.step = 1; });
  const mn = Math.min(...D.brent), mx = Math.max(...D.brent);
  const d = D.brent.map((v,i) => `${i ? 'L' : 'M'}${(i / max * 1000).toFixed(1)} ${(29 - (v - mn) / (mx - mn) * 27).toFixed(1)}`).join('');
  $('#ov').innerHTML = `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.25" vector-effect="non-scaling-stroke"/>`;
  const GAP = 8;
  const onInput = e => {
    let a = +from.value, b = +to.value;
    if (b - a < GAP){ if (e.target === from) a = b - GAP; else b = a + GAP; }
    S.main.start = Math.max(0, a); S.main.end = Math.min(max, b); S.main.period = null;
    $('#per-main').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed','false'));
    syncRange(); updateMain();
  };
  from.oninput = to.oninput = onInput;
  syncRange(); updateMain();
}
function syncRange(){
  const max = D.n - 1, from = $('#r-from'), to = $('#r-to');
  from.value = S.main.start; to.value = S.main.end;
  from.setAttribute('aria-valuetext', fmtDate(D.t[S.main.start])); to.setAttribute('aria-valuetext', fmtDate(D.t[S.main.end]));
  const w = $('#win'); w.style.left = (S.main.start / max * 100) + '%'; w.style.width = ((S.main.end - S.main.start) / max * 100) + '%';
}

/* ---------- Comparação indexada ---------- */
const baseline = { id:'baseline', beforeDatasetsDraw(ch){
  const y = ch.scales.y.getPixelForValue(100), {left,right} = ch.chartArea, ctx = ch.ctx;
  ctx.save(); ctx.strokeStyle = ch.options.plugins.baselineColor; ctx.lineWidth = 1.25; ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(right,y); ctx.stroke();
  ctx.fillStyle = ch.options.plugins.baselineColor; ctx.font = '12px ' + Chart.defaults.font.family; ctx.fillText('100', left + 4, y - 5); ctx.restore(); } };
function idxData(k){ const b = D[k][S.base]; return slice(D[k], S.base, D.n - 1, v => v / b * 100); }
function buildIdx(){
  const c = C();
  charts.idx = new Chart($('#chart-idx'), {
    type:'line',
    data:{ datasets: SERIES.map(([k,l]) => line(l, idxData(k), c[k], 'y', k === 'brent' ? 2.25 : 1.75)) },
    options:{ ...baseOpts(c),
      scales:{ x:xScale(c), y:{ grid:{color:c.soft}, border:{display:false}, ticks:{color:c.muted, font:{size:12}, maxTicksLimit:6, callback:v => nf0.format(v)} } },
      plugins:{ ...baseOpts(c).plugins, crosshairColor:c.muted, baselineColor:c.muted,
        tooltip:{ ...baseOpts(c).plugins.tooltip, callbacks:{ ...baseOpts(c).plugins.tooltip.callbacks,
          label: ctx => `${ctx.dataset.label}: ${nf0.format(ctx.parsed.y)} (${fmtPct(ctx.parsed.y - 100)})` } } } },
    plugins:[crosshair, baseline]
  });
  const r = $('#r-base'); r.min = 0; r.max = D.n - 9; r.step = 1; r.value = S.base;
  r.oninput = () => { S.base = +r.value; markBase(null); updateIdx(); };
  const opts = [['Há 1 ano', D.n - 53], ['2021', weekIndexFrom(Date.UTC(2021,0,1))], ['2015', weekIndexFrom(Date.UTC(2015,0,1))], ['2005', 0]];
  const el = $('#base-btns');
  el.innerHTML = opts.map(([l,i]) => `<button data-i="${i}" aria-pressed="${i === S.base}">${l}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button'); if (!b) return; S.base = +b.dataset.i; r.value = S.base; markBase(b); updateIdx(); };
  updateIdx(true);
}
function markBase(btn){ $('#base-btns').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === btn))); }
function updateIdx(skipChart){
  const last = D.n - 1;
  $('#base-text').textContent = fmtDate(D.t[S.base]);
  $('#r-base').setAttribute('aria-valuetext', fmtDate(D.t[S.base]));
  const res = SERIES.map(([k,l]) => [k, l, (D[k][last] / D[k][S.base] - 1) * 100]);
  $('#idx-stats').innerHTML = res.map(([k,l,p]) => `<span><i class="dot" style="background:var(--${k})"></i>${l} <b>${fmtPct(p)}</b></span>`).join('');
  if (skipChart || !charts.idx) return;
  charts.idx.data.datasets.forEach((d,i) => d.data = idxData(SERIES[i][0]));
  charts.idx.update('none');
}

/* ---------- Composição do preço ---------- */
function parts(fuel, i){
  const tot = D[fuel][i], sem = D[fuel + '_s'][i], r = ivaRate(D.t[i]);
  const iva = tot * r / (1 + r); return { tot, sem, iva, isp: tot - sem - iva };
}
function compData(fuel, key){ const {start,end} = S.comp; return slice(D[fuel], start, end, (v,i) => parts(fuel,i)[key]); }
function buildComp(){
  const c = C(), f = S.comp.fuel;
  const area = (label, key, stroke, fill, order) => ({ label, data:compData(f,key), borderColor:stroke, backgroundColor:fill, borderWidth:1, pointRadius:0, pointHoverRadius:3, fill: order ? '-1' : 'origin', tension:0, key });
  charts.comp = new Chart($('#chart-comp'), {
    type:'line',
    data:{ datasets:[ area('Sem impostos','sem', c[f], alpha(c[f], .55), 0), area('ISP','isp', c.isp, alpha(c.isp,.85), 1), area('IVA','iva', c.iva, alpha(c.iva,.95), 2) ] },
    options:{ ...baseOpts(c),
      scales:{ x:xScale(c), y:{ stacked:true, beginAtZero:true, grid:{color:c.soft}, border:{display:false}, ticks:{color:c.muted, font:{size:12}, maxTicksLimit:6, callback:v => nf2.format(v) + ' €'} } },
      plugins:{ ...baseOpts(c).plugins, crosshairColor:c.muted,
        tooltip:{ ...baseOpts(c).plugins.tooltip, itemSort:(a,b) => b.datasetIndex - a.datasetIndex, callbacks:{ ...baseOpts(c).plugins.tooltip.callbacks,
          label: ctx => `${ctx.dataset.label}: ${eur2(ctx.parsed.y)}`,
          footer: it => { const p = parts(S.comp.fuel, D.t.indexOf(it[0].parsed.x)); return `Total ${eur2(p.tot)} por litro, ${nf0.format((p.isp + p.iva) / p.tot * 100)}% em impostos`; } } } } },
    plugins:[crosshair]
  });
  periodButtons('#per-comp', S.comp.period, k => { S.comp.period = k; [S.comp.start, S.comp.end] = periodRange(k); updateComp(); });
  $('#fuel-btns').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.comp.fuel = b.dataset.fuel;
    $('#fuel-btns').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); charts.comp.destroy(); buildComp(); };
  renderMix();
}
function updateComp(){
  const ch = charts.comp; if (!ch) return;
  ch.data.datasets.forEach(d => d.data = compData(S.comp.fuel, d.key)); ch.update('none');
}
function renderMix(){
  const f = S.comp.fuel, p = parts(f, D.n - 1), name = f === 'gasolina' ? 'da gasolina 95' : 'do gasóleo';
  const pct = v => v / p.tot * 100;
  $('#mix').innerHTML = `
    <p class="mix-title">Esta semana, <b>${nf0.format(pct(p.isp + p.iva))}%</b> do preço ${name} (${eur2(p.tot)} por litro) são impostos.</p>
    <div class="mix-bar" role="img" aria-label="Sem impostos ${eur2(p.sem)}, ISP ${eur2(p.isp)}, IVA ${eur2(p.iva)}">
      <span style="width:${pct(p.sem)}%;background:${alpha(C()[f], .55)}"></span><span style="width:${pct(p.isp)}%;background:var(--isp)"></span><span style="width:${pct(p.iva)}%;background:var(--iva)"></span>
    </div>
    <div class="mix-key">
      <span><i class="sq" style="background:${alpha(C()[f], .55)}"></i>Sem impostos <b>${eur2(p.sem)}</b></span>
      <span><i class="sq" style="background:var(--isp)"></i>ISP <b>${eur2(p.isp)}</b></span>
      <span><i class="sq" style="background:var(--iva)"></i>IVA (23%) <b>${eur2(p.iva)}</b></span>
    </div>`;
}

/* ---------- Ciclo ---------- */
function destroyCharts(){ Object.keys(charts).forEach(k => { charts[k].destroy(); delete charts[k]; }); }
function renderAll(){
  destroyCharts();
  Chart.defaults.font.family = '"IBM Plex Sans", system-ui, sans-serif';
  renderText(); buildMain(); buildIdx(); buildComp();
}

/* Redesenhar os gráficos quando o tema do sistema muda */
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (document.body.dataset.state === 'ready') renderAll(); });
$('#retry').addEventListener('click', () => load());
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (document.body.dataset.state === 'ready') Object.values(charts).forEach(c => c.update('none')); });

load();
