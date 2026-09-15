(() => {
  const panel = document.querySelector('[data-ranking-panel="driver"]');
  const select = document.querySelector('[data-driver-ranking-select]');
  const grid = document.querySelector('[data-driver-circuit-grid]');
  if (!panel || !select || !grid) return;

  const api = 'https://twjpjzalyvbsdpbzhqln.supabase.co/functions/v1/public-leaderboard';
  let payload = null;

  const fmt = value => {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    return `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2,'0')}.${String(Math.floor(ms % 1000)).padStart(3,'0')}`;
  };
  const fmtDate = value => value ? new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-GB' : 'fr-BE', { day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date(value)) : '—';
  const driverResult = (circuit, id) => (circuit?.drivers || []).find(item => item.driver_id === id);
  const timedCircuits = id => (payload?.circuits || []).map(c => ({ circuit:c, result:driverResult(c,id) })).filter(x => Number(x.result?.best_lap_ms) > 0);

  function ensureLayout() {
    let shell = panel.querySelector('.driver-premium-shell');
    if (shell) return shell;
    shell = document.createElement('div');
    shell.className = 'driver-premium-shell';
    shell.innerHTML = `
      <section class="driver-premium-hero">
        <div class="driver-premium-kicker">ATX // DRIVER PERFORMANCE</div>
        <div class="driver-premium-title"><span>PAR</span> <strong>PILOTE</strong></div>
        <p data-fr="Sélectionnez un pilote pour parcourir ses meilleurs chronos sur l’ensemble des circuits." data-en="Select a driver to explore their best lap times across every circuit.">Sélectionnez un pilote pour parcourir ses meilleurs chronos sur l’ensemble des circuits.</p>
      </section>
      <section class="driver-premium-control"><div class="driver-premium-select-slot"></div><div class="driver-premium-identity" data-driver-premium-identity></div></section>
      <section class="driver-premium-stats" data-driver-premium-stats></section>
      <section class="driver-premium-circuits" data-driver-premium-circuits></section>`;
    const head = panel.querySelector('.ranking-panel-head');
    if (head) head.hidden = true;
    grid.hidden = true;
    panel.prepend(shell);
    shell.querySelector('.driver-premium-select-slot').append(select.closest('label') || select);
    return shell;
  }

  function render() {
    if (!payload || !select.value) return;
    const shell = ensureLayout();
    const driver = (payload.drivers || []).find(d => d.driver_id === select.value);
    if (!driver) return;
    const timed = timedCircuits(driver.driver_id);
    const allResults = timed.map(x => x.result);
    const best = allResults.reduce((a,b) => !a || Number(b.best_lap_ms) < Number(a.best_lap_ms) ? b : a, null);
    const latest = allResults.reduce((a,b) => !a || Date.parse(b.achieved_at || 0) > Date.parse(a.achieved_at || 0) ? b : a, null);
    const identity = shell.querySelector('[data-driver-premium-identity]');
    identity.replaceChildren();
    const avatar = document.createElement('span'); avatar.className = 'driver-premium-avatar';
    if (driver.avatar_url) { const img=document.createElement('img'); img.src=driver.avatar_url; img.alt=''; img.referrerPolicy='no-referrer'; avatar.append(img); }
    else avatar.textContent = String(driver.display_name || 'AT').slice(0,2).toUpperCase();
    const info=document.createElement('div'); info.innerHTML=`<strong></strong><small></small>`; info.querySelector('strong').textContent=driver.display_name || 'ACC Driver'; info.querySelector('small').textContent=driver.team_name || 'ATX Racing Driver';
    const badge=document.createElement('span'); badge.className='driver-premium-tier'; badge.dataset.tier=driver.performance_class || 'unranked'; badge.textContent=String(driver.performance_class || 'UNRANKED').toUpperCase();
    identity.append(avatar,info,badge);

    const stats=shell.querySelector('[data-driver-premium-stats]');
    stats.innerHTML=`<article><small>Circuits</small><strong>${timed.length}</strong></article><article><small>${document.documentElement.lang==='en'?'Best lap':'Meilleur tour'}</small><strong>${fmt(best?.best_lap_ms)}</strong></article><article><small>Performance</small><strong>${Number.isFinite(Number(driver.performance_score)) ? Number(driver.performance_score).toFixed(2)+'%' : '—'}</strong></article><article><small>${document.documentElement.lang==='en'?'Last session':'Dernière session'}</small><strong>${fmtDate(latest?.achieved_at)}</strong></article>`;

    const out=shell.querySelector('[data-driver-premium-circuits]'); out.replaceChildren();
    (payload.circuits || []).forEach((circuit,index) => {
      const result=driverResult(circuit,driver.driver_id);
      const card=document.createElement('article');
      card.className=`driver-premium-circuit-card ${result?.best_lap_ms?'has-time':'no-time'}`;
      const source=document.querySelectorAll('[data-ranking-circuits] .circuit-visual-card')[index];
      const sourceImg=source?.querySelector('.circuit-card-media img');
      const country=source?.querySelector('.circuit-card-country')?.textContent || 'ACC';
      if (source) ['--flag-a','--flag-b','--flag-c'].forEach(v => card.style.setProperty(v, source.style.getPropertyValue(v)));
      const media=document.createElement('div'); media.className='driver-premium-circuit-media';
      const img=document.createElement('img'); img.src=sourceImg?.src || 'atx-racing-background.webp'; img.alt=`Circuit ${circuit.circuit_name}`; img.loading='lazy'; media.append(img);
      const code=document.createElement('span'); code.textContent=country; media.append(code);
      const body=document.createElement('div'); body.className='driver-premium-circuit-body';
      const name=document.createElement('strong'); name.textContent=circuit.circuit_name;
      const lap=document.createElement('b'); lap.textContent=result?.best_lap_ms ? fmt(result.best_lap_ms) : (document.documentElement.lang==='en'?'No lap time':'Aucun chrono');
      const meta=document.createElement('small');
      if (result?.best_lap_ms) meta.textContent=`${String(result.session_type || '—').toUpperCase()} · ${result.pace_percent ? Number(result.pace_percent).toFixed(2)+'%' : '—'} · ${String(result.performance_class || '').toUpperCase()}`;
      else meta.textContent=document.documentElement.lang==='en'?'Circuit to complete':'Circuit à compléter';
      body.append(name,lap,meta); card.append(media,body); out.append(card);
    });
  }

  fetch(api,{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{
    payload=data; ensureLayout();
    const wait=()=>{ if(select.options.length){ render(); } else setTimeout(wait,80); }; wait();
    select.addEventListener('change',render);
    new MutationObserver(() => { if (!panel.hidden) render(); }).observe(panel,{attributes:true,attributeFilter:['hidden']});
  }).catch(()=>{});
})();