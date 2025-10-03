// util petite aide
const $ = (sel) => document.querySelector(sel);
const fmt = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(n||0));

let tiktokRows = [];
let igRows = [];
let isPro = false;

// 1) Paywall via GitHub Sponsors (MVP) ---------------------------------------
async function checkSponsor(username){
  try{
    const resp = await fetch('data/sponsors.json', {cache:'no-cache'});
    if(!resp.ok) throw new Error('Pas de sponsors.json (workflow)');
    const list = await resp.json();
    const ok = list.some(x => (x.login||'').toLowerCase() === username.toLowerCase());
    isPro = ok;
    $('#sponsor-status').textContent = ok ? '✅ Pro débloqué' : '❌ Non trouvé';
    document.querySelectorAll('.pro-locked').forEach(el=>{
      el.style.opacity = ok?1:.65;
      el.style.filter = ok?'none':'saturate(.6)';
    });
    if(ok){
      loadTrends();
      renderOptimizer();
    }
  }catch(e){
    $('#sponsor-status').textContent = '⚠️ '+e.message;
  }
}

$('#check-sponsor').addEventListener('click', ()=>{
  const u = $('#gh-username').value.trim();
  if(u) checkSponsor(u);
});

// 2) Import CSV ---------------------------------------------------------------
function parseFile(file, cb){
  const ext = file.name.split('.').pop().toLowerCase();
  if(ext === 'json'){
    const r = new FileReader();
    r.onload = () => cb(JSON.parse(r.result));
    r.readAsText(file);
  } else {
    Papa.parse(file, { header:true, dynamicTyping:true, complete: (res)=> cb(res.data) });
  }
}

$('#tiktok-file').addEventListener('change', (e)=>{
  const f = e.target.files[0]; if(!f) return;
  parseFile(f, rows=>{ tiktokRows = normalizeTikTok(rows); refresh(); });
});
$('#ig-file').addEventListener('change', (e)=>{
  const f = e.target.files[0]; if(!f) return;
  parseFile(f, rows=>{ igRows = normalizeInstagram(rows); refresh(); });
});

// 3) Normalisation données ----------------------------------------------------
function normalizeTikTok(rows){
  return rows.map(r=>({
    date: new Date(r.date || r.Date || r.time || r["Date"] || Date.now()),
    views: Number(r.views || r.Play || r.Views || r["Video views"] || 0),
    likes: Number(r.likes || r.Likes || r["Likes"] || 0),
    comments: Number(r.comments || r.Comments || r["Comments"] || 0),
    shares: Number(r.shares || r.Shares || r["Shares"] || 0),
    followers: Number(r.followers || r.Followers || r["Followers"] || 0),
    posts: 1
  })).filter(x=>!isNaN(x.views));
}

function normalizeInstagram(rows){
  return rows.map(r=>({
    date: new Date(r.date || r.Date || r.time || r["Date"] || Date.now()),
    views: Number(r.impressions || r.Impressions || r["Impressions"] || r.views || 0),
    likes: Number(r.likes || r.Likes || r["Likes"] || 0),
    comments: Number(r.comments || r.Comments || r["Comments"] || 0),
    saves: Number(r.saves || r.Saved || r["Saves"] || 0),
    followers: Number(r.followers || r.Followers || r["Followers"] || 0),
    posts: 1
  })).filter(x=>!isNaN(x.views));
}

// 4) KPIs + Graphs ------------------------------------------------------------
let chViews, chEng, chGrowth;

function refresh(){
  const all = [...tiktokRows, ...igRows].sort((a,b)=>a.date-b.date);
  if(!all.length){
    $('#kpi-views').textContent = '—';
    $('#kpi-engagement').textContent = '—';
    $('#kpi-growth').textContent = '—';
    $('#kpi-postfreq').textContent = '—';
    [chViews, chEng, chGrowth].forEach(ch=>ch&&ch.destroy());
    return;
  }

  const totalViews = all.reduce((s,x)=>s+(x.views||0),0);
  const totalLikes = all.reduce((s,x)=>s+(x.likes||0),0);
  const totalComments = all.reduce((s,x)=>s+(x.comments||0),0);
  const totalSaves = all.reduce((s,x)=>s+(x.saves||0),0);
  const totalInteractions = totalLikes+totalComments+totalSaves;
  const engagement = totalViews? (totalInteractions/totalViews)*100 : 0;

  const firstFollowers = all.find(x=>x.followers)?.followers || 0;
  const lastFollowers = [...all].reverse().find(x=>x.followers)?.followers || firstFollowers;
  const growth = lastFollowers - firstFollowers;

  const days = Math.max(1, (all.at(-1).date - all[0].date)/(1000*60*60*24));
  const posts = all.reduce((s,x)=>s+(x.posts||0),0);
  const perWeek = (posts / days) * 7;

  $('#kpi-views').textContent = fmt(totalViews);
  $('#kpi-engagement').textContent = (engagement||0).toFixed(2) + '%';
  $('#kpi-growth').textContent = (growth>=0?'+':'') + fmt(growth);
  $('#kpi-postfreq').textContent = perWeek.toFixed(2);

  const byDay = {};
  for(const r of all){
    const k = new Date(r.date); k.setHours(0,0,0,0);
    const key = k.toISOString().slice(0,10);
    byDay[key] = byDay[key] || {views:0, inter:0, followers:r.followers||0};
    byDay[key].views += r.views||0;
    byDay[key].inter += (r.likes||0)+(r.comments||0)+(r.saves||0);
    byDay[key].followers = r.followers||byDay[key].followers;
  }
  const labels = Object.keys(byDay).sort();
  const seriesViews = labels.map(d=>byDay[d].views);
  const seriesEng = labels.map(d=>{
    const v = byDay[d].views; const i = byDay[d].inter; return v? (i/v)*100 : 0;
  });
  const seriesFollowers = labels.map(d=>byDay[d].followers||0);

  const makeChart = (id, label, data) => new Chart($(id), {
    type:'line', data:{ labels, datasets:[{ label, data, tension:.3 }] },
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:true }}}
  });

  chViews && chViews.destroy();
  chEng && chEng.destroy();
  chGrowth && chGrowth.destroy();
  chViews = makeChart('#chart-views','Vues / jour', seriesViews);
  chEng = makeChart('#chart-engagement','Engagement % / jour', seriesEng);
  chGrowth = makeChart('#chart-growth','Followers (snapshot)', seriesFollowers);
}

// 5) Optimizer Pro ------------------------------------------------------------
function renderOptimizer(){
  if(!isPro) return;
  const html = `
    <div class="optimizer">
      <h3>Plan d'action (auto-généré)</h3>
      <ul>
        <li>📅 <b>Fréquence</b> : cible ${suggestFreq()} posts/sem selon votre volume actuel.</li>
        <li>⏰ <b>Horaires</b> : publiez quand vos pics de vues quotidiennes sont au dessus de la médiane (voir courbe « Vues / jour »).</li>
        <li>🎬 <b>Formats</b> : testez 2 formats sur 2 semaines (A/B) : <i>hook 3s</i> vs <i>hook 1s</i>, sous-titres auto vs stylés.</li>
        <li>🏷️ <b>Hashtags</b> : 1 principal + 2 niche + 1 localisation. Réduire le nombre si l'engagement baisse.</li>
        <li>🔁 <b>Remix / Duet</b> : recyclez vos 10% tops en version accélérée ×1.25 + nouveau hook.</li>
        <li>🎯 <b>CTA</b> : posez 1 question par post pour booster commentaires (+10–20% visés).</li>
      </ul>
    </div>`;
  $('#optimizer-content').innerHTML = html;
}

function suggestFreq(){
  const all = [...tiktokRows, ...igRows];
  if(!all.length) return 3;
  const days = Math.max(1, (all.at(-1).date - all[0].date)/(1000*60*60*24));
  const posts = all.reduce((s,x)=>s+(x.posts||0),0);
  const current = (posts / days) * 7;
  if(current < 2) return 3;
  if(current < 5) return Math.round(current+1);
  return 6;
}

// 6) Tendances (Pro) via JSON -------------------------------------------------
async function loadTrends(){
  try{
    const resp = await fetch('data/trends.json', {cache:'no-cache'});
    if(!resp.ok) return;
    const items = await resp.json();
    const el = $('#trends-list');
    el.innerHTML = items.slice(0,9).map(t=>`<div class="trend"><b>${t.title}</b><p class="muted">${t.source||''}</p><a href="${t.url}" target="_blank">Voir</a></div>`).join('');
  }catch(e){/* silencieux */}
}
