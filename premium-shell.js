(() => {
  const path = location.pathname;
  const nested = /\/events\//.test(path);
  const prefix = nested ? '../' : '';
  const lang = () => document.documentElement.lang === 'en' ? 'en' : 'fr';
  const apiBase = 'https://twjpjzalyvbsdpbzhqln.supabase.co/functions/v1';

  const currentPage = () => path.split('/').pop() || 'index.html';
  const currentSection = () => String(location.hash || '').toLowerCase();
  const isActive = href => {
    const page = currentPage();
    const [targetPage, targetHash = ''] = href.split('#');
    if (page === '' || page === 'index.html') {
      if (targetPage !== 'index.html') return false;
      const hash = currentSection();
      if (targetHash === 'events') return hash === '#events';
      if (targetHash === 'archives') return hash === '#archives';
      return !hash || (hash !== '#events' && hash !== '#archives');
    }
    return targetPage === page;
  };

  const nav = document.querySelector('.side-links');
  const links = [
    ['index.html','Accueil','Home'],
    ['index.html#events','Calendrier','Calendar'],
    ['reglement.html','Règlement','Rules'],
    ['classement.html','Classement','Ranking'],
    ['gtworld.html','GT World S1','GT World S1'],
    ['index.html#archives','Archives','Archives'],
  ];

  const syncActiveNav = () => {
    if (!nav) return;
    [...nav.querySelectorAll('a')].forEach((a, index) => {
      const href = links[index]?.[0] || '';
      a.classList.toggle('active', isActive(href));
    });
  };

  if (nav) {
    nav.replaceChildren(...links.map(([href,fr,en]) => {
      const a = document.createElement('a');
      a.href = `${prefix}${href}`;
      if (isActive(href)) a.classList.add('active');
      const span = document.createElement('span');
      span.dataset.fr = fr;
      span.dataset.en = en;
      span.textContent = lang() === 'en' ? en : fr;
      a.append(span);
      return a;
    }));
    window.addEventListener('hashchange', syncActiveNav);
  }

  const footer = document.querySelector('.site-footer');
  if (footer) {
    footer.innerHTML = `<div class="wrap"><div class="premium-footer-grid"><div><a class="brand" href="${prefix}index.html">ATX <span>Racing</span></a><p class="premium-footer-copy" data-fr="Compétition ACC, événements, classements et progression pilote — une identité ATX Motorsport." data-en="ACC competition, events, standings and driver progression — an ATX Motorsport identity.">Compétition ACC, événements, classements et progression pilote — une identité ATX Motorsport.</p></div><nav class="premium-footer-links" aria-label="Footer"><a href="${prefix}index.html">Accueil</a><a href="${prefix}index.html#events">Calendrier</a><a href="${prefix}reglement.html">Règlement</a><a href="${prefix}classement.html">Classement</a><a href="${prefix}gtworld.html">GT World S1</a><a href="${prefix}index.html#archives">Archives</a><a href="https://www.thesimgrid.com/communities/atxracing" target="_blank" rel="noopener">SimGrid</a><a href="https://discord.gg/dgyJJYTSsD" target="_blank" rel="noopener">Discord</a><a href="${prefix}confidentialite.html">Confidentialité</a></nav></div><div class="premium-footer-legal"><span>© 2026 ATX Racing · ATX Motorsport</span><a href="mailto:athoxmotorsport@gmail.com">athoxmotorsport@gmail.com</a></div></div>`;
  }

  const main = document.querySelector('main');
  let ticker = main?.querySelector('.live-ticker');
  if (main && !ticker) {
    ticker = document.createElement('div');
    ticker.className = 'live-ticker premium-global-ticker';
    ticker.setAttribute('aria-label','Informations ATX Racing');
    ticker.innerHTML = '<div class="live-ticker-track" data-premium-ticker-track></div>';
    main.prepend(ticker);
  }
  const track = ticker?.querySelector('.live-ticker-track');

  const localDate = value => new Intl.DateTimeFormat(lang()==='en'?'en-GB':'fr-BE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Brussels'}).format(new Date(value));
  const renderTicker = events => {
    if (!track) return;
    const now = Date.now();
    const next = (events || []).filter(e => new Date(e.starts_at).getTime() >= now).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at))[0];
    const messages = next ? [
      lang()==='en'?`Next event · ${next.title || next.circuit_name || 'ATX Racing'}`:`Prochain événement · ${next.title || next.circuit_name || 'ATX Racing'}`,
      localDate(next.starts_at),
      lang()==='en'?'Registration via SimGrid':'Inscriptions via SimGrid',
      lang()==='en'?'Official results · Performance · SAFE':'Résultats officiels · Performance · SAFE',
      'Assetto Corsa Competizione · GT3'
    ] : [
      lang()==='en'?'ATX Racing · Next event in preparation':'ATX Racing · Prochain événement en préparation',
      lang()==='en'?'Calendar and registration via SimGrid':'Calendrier et inscriptions via SimGrid',
      lang()==='en'?'Official results · Performance · SAFE':'Résultats officiels · Performance · SAFE',
      'Assetto Corsa Competizione · GT3'
    ];
    const set = () => messages.map(m=>`<span class="live-ticker-item">${m}</span>`).join('');
    track.innerHTML = `${set()}${set()}`;
  };
  if (track) fetch(`${apiBase}/public-event`,{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(p=>renderTicker(p.events||[])).catch(()=>renderTicker([]));

  const circuitHeading = document.querySelector('[data-ranking-panel="circuit"] .ranking-panel-head h2');
  if (circuitHeading) circuitHeading.innerHTML = '<span class="premium-red">CLASSEMENT</span><br>MEILLEURS TOURS <span class="premium-outline">PAR CIRCUIT</span>';

  document.addEventListener('click', event => {
    if (event.target.closest('[data-language],[data-lang-switch]')) setTimeout(() => {
      document.querySelectorAll('[data-fr][data-en]').forEach(el => { el.textContent = el.dataset[lang()] || el.textContent; });
      if (track) fetch(`${apiBase}/public-event`,{cache:'no-store'}).then(r=>r.ok?r.json():{}).then(p=>renderTicker(p.events||[])).catch(()=>{});
    },0);
  });
})();
