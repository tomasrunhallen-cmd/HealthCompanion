// ── Constants ────────────────────────────────────────────────────────────────

const STATE_COLORS = { balanced:'#22c55e', manic:'#f59e0b', depressed:'#6366f1', mixed:'#ec4899', nodata:'#e5e7eb' };
const STATE_LABELS = { balanced:'Balanserad', manic:'Hypoman tendens', depressed:'Depressiv tendens', mixed:'Blandtillstånd', nodata:'Ingen data' };

const DIARY_SECTIONS = [
  { title: 'Skyddande beteenden', fields: [
    {key:'med',  label:'Medicin'},
    {key:'tra',  label:'Träning'},
    {key:'min',  label:'Mindfulness'},
    {key:'bad',  label:'Bad / Kallbad'},
    {key:'ute',  label:'Utomhus på lunchen'},
    {key:'tid',  label:'Sluta jobb i tid'},
    {key:'t30',  label:'Jobba med 30 min timer'},
    {key:'sork', label:'Använt SORK'},
    {key:'kmi',  label:'Känner mig mindful'},
  ]},
  { title: 'Risk & avvikelse', fields: [
    {key:'av',  label:'Sömnavvikelse'},
    {key:'alk', label:'Alkohol'},
    {key:'hmv', label:'Handlat mer än vanligt'},
  ]},
  { title: 'Depression & ångest', fields: [
    {key:'ss',  label:'Stress-symptom'},
    {key:'ang', label:'Ångest'},
    {key:'oro', label:'Stor oro'},
  ]},
  { title: 'Mani-indikatorer', fields: [
    {key:'hoe',   label:'Hög Energi'},
    {key:'funkar',label:'Allt Bara Funkar'},
    {key:'eng',   label:'Högt Engagemang'},
    {key:'eflo',  label:'Energi flödar i kroppen'},
    {key:'ideer', label:'Många ideer på jobbet'},
    {key:'hojs',  label:'Högt självförtroende'},
    {key:'sam',   label:'Ser sammanhang tydligt'},
    {key:'vant',  label:'Svårt att vänta när andra pratar'},
    {key:'musik', label:'Lyssnar på hetsig och hög musik'},
    {key:'brad',  label:'Upplevd brådska för något'},
    {key:'mag',   label:'Upplevt starkt magstöd vid prat och sång'},
    {key:'dof',   label:'Dofter och färger är tydligare'},
    {key:'brom',  label:'Upplever att jag måste bromsa hjärnan'},
    {key:'ovan',  label:'Handlat något ovanligt'},
    {key:'inn',   label:'Spontan ex inlägg på sociala medier'},
    {key:'smart', label:'Jag är smartare än andra'},
  ]},
  { title: 'Kontext', fields: [
    {key:'nbra', label:'Nåt BRA har hänt'},
    {key:'ndal', label:'Nåt DÅLIGT har hänt'},
    {key:'soc',  label:'Social Aktivitet'},
  ]},
];

const MANIA_KEYS = ['hoe','funkar','eng','eflo','ideer','hojs','sam','vant','musik','brad','mag','dof','brom','ovan','inn','smart','hmv'];

// ── Alpine app ────────────────────────────────────────────────────────────────

function app() {
  // Build mutable copy of entries (newest first)
  const entries = window.MOCK_ENTRIES
    .map(r => Object.assign({}, r))
    .sort((a,b) => b.date.localeCompare(a.date));

  // Build date → entry map
  const entryMap = {};
  entries.forEach(e => entryMap[e.date] = e);

  return {
    tab: 'diary',
    currentDate: '2025-04-30',
    entries,
    entryMap,
    chart: null,
    STATE_COLORS,
    STATE_LABELS,
    TABS: [
      {id:'diary',    icon:'📖', label:'Dagbok'},
      {id:'dashboard',icon:'📊', label:'Översikt'},
      {id:'analysis', icon:'🧠', label:'Analys'},
      {id:'settings', icon:'⚙️', label:'Inst.'},
    ],

    // ── Scoring ──────────────────────────────────────────────────────────────

    maniaScore(e) {
      if (!e) return 0;
      return MANIA_KEYS.filter(k => e[k] === 1 || e[k] === true).length;
    },

    depressionScore(e) {
      if (!e) return 0;
      let s = 0;
      if (e.ang) s++;
      if (e.oro) s++;
      if (e.ss)  s++;
      if (e.ml === 'Lite' || e.ml === 'Mycket') s++;
      return s;
    },

    dayState(e) {
      if (!e) return 'nodata';
      const m = this.maniaScore(e) >= 4;
      const d = this.depressionScore(e) >= 2;
      if (m && d) return 'mixed';
      if (m) return 'manic';
      if (d) return 'depressed';
      return 'balanced';
    },

    stateColor(s) { return STATE_COLORS[s] || STATE_COLORS.nodata; },
    stateLabel(s) { return STATE_LABELS[s] || '–'; },

    // ── Heatmap ──────────────────────────────────────────────────────────────

    heatmapWeeks() {
      const today = new Date('2025-04-30');
      const dates = [];
      for (let i = 83; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().slice(0,10));
      }
      const first = new Date(dates[0]).getDay();
      const pad = first === 0 ? 6 : first - 1;
      const padded = [...Array(pad).fill(null), ...dates];
      const weeks = [];
      for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i+7));
      return weeks;
    },

    // ── Chart ────────────────────────────────────────────────────────────────

    initChart() {
      const ctx = document.getElementById('moodChart');
      if (!ctx) return;
      if (this.chart) { this.chart.destroy(); this.chart = null; }
      const last30 = [...this.entries].slice(0,30).reverse();
      this.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: last30.map(e => e.date.slice(5)),
          datasets: [
            { label:'Mani-score',      data: last30.map(e => this.maniaScore(e)),      borderColor:'#f59e0b', backgroundColor:'rgba(245,158,11,0.08)', tension:0.35, fill:true, pointRadius:2 },
            { label:'Depression-score',data: last30.map(e => this.depressionScore(e)), borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,0.08)',  tension:0.35, fill:true, pointRadius:2 },
          ],
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          interaction:{ mode:'index', intersect:false },
          plugins:{ legend:{ position:'top', labels:{ boxWidth:10, font:{size:10}, padding:8 } } },
          scales:{
            y:{ min:0, max:17, ticks:{ stepSize:4, font:{size:9} }, grid:{ color:'#f3f4f6' } },
            x:{ ticks:{ font:{size:9}, maxRotation:0, maxTicksLimit:10 }, grid:{ display:false } },
          },
        },
      });
    },

    // ── Diary helpers ─────────────────────────────────────────────────────────

    get currentEntry() {
      if (!this.entryMap[this.currentDate]) {
        const e = { date: this.currentDate, mh:null, ml:null, ant:'' };
        this.entryMap[this.currentDate] = e;
        this.entries.unshift(e);
      }
      return this.entryMap[this.currentDate];
    },

    get isToday() { return this.currentDate === '2025-04-30'; },

    prevDay() {
      const d = new Date(this.currentDate); d.setDate(d.getDate()-1);
      this.currentDate = d.toISOString().slice(0,10);
    },
    nextDay() {
      if (this.isToday) return;
      const d = new Date(this.currentDate); d.setDate(d.getDate()+1);
      this.currentDate = d.toISOString().slice(0,10);
    },

    formatDate(ds) {
      return new Date(ds+'T12:00:00').toLocaleDateString('sv-SE',{weekday:'long',day:'numeric',month:'long'});
    },

    cycleBool(key) {
      const e = this.currentEntry;
      const v = e[key];
      e[key] = (v === null || v === undefined) ? 1 : v === 1 ? 0 : null;
    },

    cycleMood(field, val) {
      const e = this.currentEntry;
      e[field] = e[field] === val ? null : val;
    },

    boolLabel(v) { return v === 1 ? 'JA' : v === 0 ? 'NEJ' : '–'; },
    boolBg(v)    { return v === 1 ? 'bg-green-500 text-white' : v === 0 ? 'bg-red-400 text-white' : 'bg-gray-100 text-gray-400'; },
    rowBg(v)     { return v === 1 ? 'bg-green-50 border-green-300' : v === 0 ? 'bg-red-50 border-red-200 opacity-60' : 'bg-white border-gray-200'; },

    // ── HTML generators (keeps template clean) ────────────────────────────────

    diaryHTML() {
      const e = this.currentEntry;
      const ms = this.maniaScore(e);
      const ds = this.depressionScore(e);

      const moodOpts = (field) => ['–','Balanserad','Lite','Mycket'].map(opt => {
        const val = opt === '–' ? null : opt;
        const active = e[field] === val;
        const cls = active ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-100 text-gray-500 border-transparent';
        return `<button onclick="document.querySelector('[x-data]').__x.$data.cycleMood('${field}','${val}')" class="flex-1 h-10 rounded-lg text-xs font-medium border transition-colors ${cls}">${opt}</button>`;
      }).join('');

      const sections = DIARY_SECTIONS.map(sec => {
        const rows = sec.fields.map(f => {
          const v = e[f.key];
          const rowCls = this.rowBg(v);
          const dotCls = this.boolBg(v);
          return `<button onclick="document.querySelector('[x-data]').__x.$data.cycleBool('${f.key}')" class="w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors min-h-[48px] text-left ${rowCls}">
            <span class="text-sm font-medium flex-1 pr-2">${f.label}</span>
            <span class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${dotCls}">${this.boolLabel(v)}</span>
          </button>`;
        }).join('');
        return `<div class="mb-6"><h3 class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">${sec.title}</h3><div class="space-y-2">${rows}</div></div>`;
      }).join('');

      return `
      <div class="sticky top-6 bg-white border-b px-4 py-3 z-10">
        <div class="flex items-center justify-between">
          <button onclick="document.querySelector('[x-data]').__x.$data.prevDay()" class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 text-xl">←</button>
          <div class="text-center">
            <div class="font-semibold text-sm">${this.formatDate(this.currentDate)}</div>
            ${this.isToday ? '<div class="text-xs text-blue-500">Idag</div>' : ''}
          </div>
          <button onclick="document.querySelector('[x-data]').__x.$data.nextDay()" ${this.isToday?'disabled':''} class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 text-xl disabled:opacity-30">→</button>
        </div>
      </div>
      <div class="px-4 py-4">
        <div class="mb-6">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Humör</h3>
          <div class="mb-3"><div class="text-xs text-gray-500 mb-1.5">Högt Humör</div><div class="flex gap-2">${moodOpts('mh')}</div></div>
          <div><div class="text-xs text-gray-500 mb-1.5">Lågt Humör</div><div class="flex gap-2">${moodOpts('ml')}</div></div>
        </div>
        ${sections}
        <div class="mb-6">
          <h3 class="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Anteckningar</h3>
          <textarea rows="4" class="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" placeholder="Hur var dagen?">${e.ant||''}</textarea>
        </div>
        <div class="flex gap-3 mb-8">
          <div class="flex-1 bg-amber-50 rounded-xl p-3 text-center">
            <div class="text-xs text-gray-400">Mani-score</div>
            <div class="text-3xl font-bold text-amber-500">${ms}<span class="text-base text-gray-300">/17</span></div>
          </div>
          <div class="flex-1 bg-indigo-50 rounded-xl p-3 text-center">
            <div class="text-xs text-gray-400">Depression-score</div>
            <div class="text-3xl font-bold text-indigo-500">${ds}<span class="text-base text-gray-300">/4</span></div>
          </div>
        </div>
      </div>`;
    },

    dashboardHeaderHTML() {
      return `<div class="sticky top-6 bg-white border-b px-4 py-3 z-10 flex items-center justify-between">
        <h1 class="font-bold text-lg">Översikt</h1>
        <div class="flex gap-1">
          <button class="px-3 py-1 rounded-lg text-sm bg-blue-600 text-white">30d</button>
          <button class="px-3 py-1 rounded-lg text-sm text-gray-400">90d</button>
          <button class="px-3 py-1 rounded-lg text-sm text-gray-400">365d</button>
        </div>
      </div>`;
    },

    analysisHTML() {
      return `
      <div class="sticky top-6 bg-white border-b px-4 py-3 z-10 flex items-center gap-2">
        <span class="text-xl">🧠</span><h1 class="font-bold text-lg">AI-analys</h1>
      </div>
      <div class="px-4 py-4 space-y-4">
        <div class="bg-card border border-gray-200 rounded-xl p-4 space-y-3">
          <p class="text-sm font-medium">Välj period</p>
          <div class="flex gap-2">
            <button class="flex-1 h-9 rounded-lg text-sm bg-blue-600 text-white">30 dagar</button>
            <button class="flex-1 h-9 rounded-lg text-sm bg-gray-100 text-gray-500">90 dagar</button>
            <button class="flex-1 h-9 rounded-lg text-sm bg-gray-100 text-gray-500">365 dagar</button>
          </div>
          <button class="w-full h-12 bg-blue-600 text-white rounded-xl font-medium flex items-center justify-center gap-2">
            🧠 Analysera mönster
          </button>
        </div>
        <div class="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p class="text-sm leading-relaxed text-gray-700">Under de senaste 30 dagarna syns ett tydligt mönster med två hypomana episoder (7–9 april och 24–26 april), separerade av en kortvarig depressiv period (13–15 april). Båda episoderna föregicks av sömnavvikelse och minskad användning av skyddande beteenden.</p>
        </div>
        <div class="border-2 border-orange-400 bg-orange-50 rounded-xl p-3">
          <div class="flex items-start gap-2">
            <span>⚠️</span>
            <div>
              <p class="text-sm font-semibold">Potentiellt mönster för ny episod</p>
              <p class="text-xs text-gray-600 mt-1">Mani-score steg till 11/17 den 26 april. Om trenden fortsätter bör du kontakta din psykiater.</p>
            </div>
          </div>
        </div>
        ${this._analysisSection('Tidiga varningssignaler', [
          ['Sömnavvikelse föregår episoder', 'Registrerades 2 dagar innan båda episoderna startade (5 apr och 22 apr).', ['2025-04-05','2025-04-22']],
          ['Hög energi + Många idéer = risk', 'Kombinationen på samma dag föregick alltid mani-score ≥ 6.', []],
          ['Minskat medicin-fokus = röd flagga', 'Vid båda episoderna minskade registrerat medicin 3–4 dagar innan peak.', []],
        ])}
        ${this._analysisSection('Skyddande faktorer', [
          ['✅ Träning stabiliserar', 'Dagar med träning (14 av 30) hade 40% lägre mani-score dagen efter.', []],
          ['✅ 30-min timer + SORK', 'Perioden 16–22 april, med konsekventa strategier, var den stabilaste.', []],
        ])}
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div class="px-4 py-3 border-b font-semibold text-sm">Rekommendationer <span class="ml-1 text-xs bg-gray-100 px-1.5 rounded-full">4</span></div>
          <div class="px-4 pb-4 pt-3 space-y-3">
            ${['Prioritera sömn som episod-markör — sätt alarm om du sover under 6h tre nätter i rad.','Fortsätt med träning minst 3 dagar/vecka — din starkaste stabiliserande faktor.','Dela varningssignalerna med din psykiater vid nästa besök.','Använd 30-min timer och SORK aktivt när mani-score > 3.'].map(r => `<div class="flex items-start gap-2"><span class="text-green-500 mt-0.5">✓</span><p class="text-sm">${r}</p></div>`).join('')}
          </div>
        </div>
        <p class="text-xs text-gray-400 italic p-3 bg-gray-50 rounded-xl">⚕️ Denna analys är mönsterhittning, inte medicinsk rådgivning. Vid varningstecken — kontakta din psykiater eller psykiatrisk akutvård.</p>
      </div>`;
    },

    _analysisSection(title, items) {
      const cards = items.map(([t,d,dates]) => {
        const chips = dates.map(d => `<span class="text-xs bg-white border px-1.5 py-0.5 rounded">${d}</span>`).join('');
        return `<div class="bg-gray-50 rounded-lg p-3"><div class="font-medium text-sm">${t}</div><p class="text-sm text-gray-500 mt-1">${d}</p>${chips?`<div class="flex flex-wrap gap-1 mt-2">${chips}</div>`:''}</div>`;
      }).join('');
      return `<div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div class="px-4 py-3 border-b font-semibold text-sm">${title} <span class="ml-1 text-xs bg-gray-100 px-1.5 rounded-full">${items.length}</span></div>
        <div class="px-4 pb-4 pt-3 space-y-3">${cards}</div>
      </div>`;
    },

    settingsHTML() {
      return `
      <div class="sticky top-6 bg-white border-b px-4 py-3 z-10"><h1 class="font-bold text-lg">Inställningar</h1></div>
      <div class="px-4 py-4 space-y-4">
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div class="px-4 py-3 border-b font-semibold text-sm">CSV-import av historik</div>
          <div class="p-4">
            <div class="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
              <div class="text-4xl mb-2">📂</div>
              <p class="text-sm font-medium">Dra och släpp CSV-fil</p>
              <p class="text-xs text-gray-400 mt-1">Stöder ditt befintliga format med svenska månadsnamn</p>
            </div>
          </div>
        </div>
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div class="px-4 py-3 border-b font-semibold text-sm">Garmin Connect</div>
          <div class="p-4 space-y-3">
            <div class="flex items-center gap-3">
              <span class="text-3xl">⌚</span>
              <div><p class="text-sm font-medium">Ej ansluten</p><p class="text-xs text-gray-400">Sömn, HRV, stress, Body Battery</p></div>
            </div>
            <button class="w-full h-10 border border-gray-200 rounded-xl text-sm text-gray-600">Konfigurera Garmin</button>
          </div>
        </div>
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div class="px-4 py-3 border-b font-semibold text-sm">Exportera data</div>
          <div class="p-4 space-y-2">
            <p class="text-sm text-gray-500">Exporterar i exakt samma format som din ursprungsapp.</p>
            <button class="w-full h-10 border border-gray-200 rounded-xl text-sm flex items-center justify-center gap-2">📄 Exportera som CSV</button>
          </div>
        </div>
        <button class="w-full h-12 border border-red-200 text-red-500 rounded-xl text-sm flex items-center justify-center gap-2">🚪 Logga ut</button>
      </div>`;
    },
  };
}
