(() => {
  const path = location.pathname;
  const nested = /\/events\//.test(path);
  const prefix = nested ? '../' : '';
  const lang = () => document.documentElement.lang === 'en' ? 'en' : 'fr';
  const apiBase = 'https://twjpjzalyvbsdpbzhqln.supabase.co/functions/v1';
  const page = path.split('/').pop() || 'index.html';

  const pageClass = (() => {
    if (page === 'index.html' || page === '') return 'premium-page-home';
    if (page === 'classement.html') return 'premium-page-ranking';
    if (page === 'reglement.html') return 'premium-page-rules';
    if (page === 'gtworld.html') return 'premium-page-gtworld';
    if (page === 'daily-race.html') return 'premium-page-daily';
    if (page === 'open-lobby.html') return 'premium-page-open-lobby';
    if (page === 'calendrier.html') return 'premium-page-calendar';
    if (page === 'archives.html') return 'premium-page-archives';
    if (page === 'profil-pilote.html') return 'premium-page-profile';
    if (page === 'course.html' || nested) return 'premium-page-course';
    if (page === 'event-admin.html') return 'premium-page-admin';
    if (page === 'confidentialite.html') return 'premium-page-privacy';
    return 'premium-page-generic';
  })();
  document.body.classList.add('premium-site', pageClass);

  const isActive = href => {
    const [targetLocation, targetHash = ''] = href.split('#');
    const targetPage = targetLocation.split('?')[0];
    const currentHash = location.hash.replace('#', '') || 'points';
    if (targetPage === 'index.html') return page === '' || page === 'index.html';
    if (targetPage === 'classement.html' && targetHash) return page === targetPage && currentHash === targetHash;
    return page === targetPage;
  };

  const nav = document.querySelector('.side-links');
  let navLinks = [];
  let courseToggle = null;
  let rankingToggle = null;
  if (nav) {
    const makeLink = ([href,fr,en]) => {
      const a = document.createElement('a');
      a.href = `${prefix}${href}`;
      a.dataset.premiumHref = href;
      const span = document.createElement('span');
      span.dataset.fr = fr;
      span.dataset.en = en;
      span.textContent = lang() === 'en' ? en : fr;
      a.append(span);
      return a;
    };
    const home = makeLink(['index.html','Accueil','Home']);
    const courseGroup = document.createElement('div');
    courseGroup.className = 'side-nav-group';
    courseToggle = document.createElement('button');
    courseToggle.type = 'button';
    courseToggle.className = 'side-nav-group-toggle';
    courseToggle.setAttribute('aria-expanded','false');
    courseToggle.innerHTML = '<span data-fr="Courses" data-en="Racing">Courses</span><i aria-hidden="true">⌄</i>';
    const courseSubmenu = document.createElement('div');
    courseSubmenu.className = 'side-submenu';
    courseSubmenu.append(
      makeLink(['gtworld.html','World GT','World GT']),
      makeLink(['daily-race.html','Daily Race','Daily Race']),
      makeLink(['open-lobby.html','Open Lobby','Open Lobby'])
    );
    courseGroup.append(courseToggle, courseSubmenu);

    const rankingPinned = page === 'classement.html' && matchMedia('(min-width:821px)').matches;
    const rankingGroup = document.createElement('div');
    rankingGroup.className = `side-nav-group side-ranking-group${rankingPinned ? ' open persistent-open' : ''}`;
    rankingToggle = document.createElement('button');
    rankingToggle.type = 'button';
    rankingToggle.className = 'side-nav-group-toggle';
    rankingToggle.setAttribute('aria-expanded', String(rankingPinned));
    rankingToggle.innerHTML = '<span data-fr="Classements" data-en="Standings">Classements</span><i aria-hidden="true">⌄</i>';
    const rankingSubmenu = document.createElement('div');
    rankingSubmenu.className = 'side-submenu ranking-submenu';
    const rankingLinks = [
      makeLink(['classement.html?type=DR#points','Classement points','Points standings']),
      makeLink(['classement.html#circuit','Par circuit','By circuit']),
      makeLink(['classement.html#driver','Par pilotes','By driver']),
      makeLink(['classement.html#team','Par équipe','By team']),
    ];
    ['points','circuit','driver','team'].forEach((section, index) => { rankingLinks[index].dataset.rankingSection = section; });
    rankingSubmenu.append(...rankingLinks);
    rankingGroup.append(rankingToggle, rankingSubmenu);

    nav.replaceChildren(
      home,
      courseGroup,
      makeLink(['calendrier.html','Calendrier','Calendar']),
      rankingGroup,
      makeLink(['archives.html','Archives','Archives']),
      makeLink(['reglement.html','Règlement','Rules'])
    );
    navLinks = [...nav.querySelectorAll('a[data-premium-href]')];
    courseToggle.addEventListener('click', () => {
      const open = !courseGroup.classList.contains('open');
      courseGroup.classList.toggle('open', open);
      courseToggle.setAttribute('aria-expanded', String(open));
    });
    rankingToggle.addEventListener('click', () => {
      if (rankingGroup.classList.contains('persistent-open')) return;
      const open = !rankingGroup.classList.contains('open');
      rankingGroup.classList.toggle('open', open);
      rankingToggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', event => {
      if (!courseGroup.contains(event.target)) {
        courseGroup.classList.remove('open');
        courseToggle.setAttribute('aria-expanded','false');
      }
      if (!rankingGroup.contains(event.target) && !rankingGroup.classList.contains('persistent-open')) {
        rankingGroup.classList.remove('open');
        rankingToggle.setAttribute('aria-expanded','false');
      }
    });
  }

  const syncNavActive = () => {
    navLinks.forEach(link => link.classList.toggle('active', isActive(link.dataset.premiumHref || '')));
    const courseActive = ['gtworld.html','daily-race.html','open-lobby.html'].includes(page);
    courseToggle?.classList.toggle('active', courseActive);
    rankingToggle?.classList.toggle('active', page === 'classement.html');
  };
  syncNavActive();
  window.addEventListener('hashchange', syncNavActive);

  const footer = document.querySelector('.site-footer');
  if (footer) {
    footer.innerHTML = `<div class="wrap"><div class="premium-footer-grid"><div><a class="brand" href="${prefix}index.html">ATX <span>Racing</span></a><p class="premium-footer-copy" data-fr="Compétition ACC, événements, classements et progression pilote — une identité ATX Motorsport." data-en="ACC competition, events, standings and driver progression — an ATX Motorsport identity.">Compétition ACC, événements, classements et progression pilote — une identité ATX Motorsport.</p></div><nav class="premium-footer-links" aria-label="Footer"><a href="${prefix}index.html">Accueil</a><a href="${prefix}gtworld.html">World GT</a><a href="${prefix}daily-race.html">Daily Race</a><a href="${prefix}open-lobby.html">Open Lobby</a><a href="${prefix}calendrier.html">Calendrier</a><a href="${prefix}classement.html">Classements</a><a href="${prefix}archives.html">Archives</a><a href="${prefix}reglement.html">Règlement</a><a href="https://www.thesimgrid.com/communities/atxracing" target="_blank" rel="noopener">SimGrid</a><a href="https://discord.gg/dgyJJYTSsD" target="_blank" rel="noopener">Discord</a><a href="${prefix}confidentialite.html">Confidentialité</a></nav></div><div class="premium-footer-legal"><span>© 2026 ATX Racing · ATX Motorsport</span><a href="mailto:athoxmotorsport@gmail.com">athoxmotorsport@gmail.com</a></div></div>`;
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
      lang()==='en'?`Next event · ${next.title || next.title_fr || next.circuit_name || 'ATX Racing'}`:`Prochain événement · ${next.title || next.title_fr || next.circuit_name || 'ATX Racing'}`,
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

  const decorateSectionHeadings = () => {
    document.querySelectorAll('main section .wrap').forEach(wrap => {
      const label = wrap.querySelector(':scope > .section-label');
      const heading = wrap.querySelector(':scope > h1, :scope > h2');
      if (label && heading) wrap.classList.add('premium-section-heading');
    });
  };
  decorateSectionHeadings();

  const fixRedBullRingImage = () => {
    document.querySelectorAll('.circuit-visual-card').forEach(card => {
      const name = card.querySelector('.circuit-card-name')?.textContent?.trim().toLowerCase() || '';
      if (!name.includes('red bull ring')) return;
      const img = card.querySelector('.circuit-card-media img');
      if (!img) return;
      const replacement = 'https://gdm-universal-media.b-cdn.net/racinggames/77340ace8cf3f6e652f0d196344d7d7a304b9083-3840x2160.jpg?height=840&width=1600';
      if (img.src !== replacement) img.src = replacement;
      img.alt = 'Red Bull Ring dans Assetto Corsa Competizione';
    });
  };
  fixRedBullRingImage();
  if (page === 'classement.html') {
    const rankingRoot = document.querySelector('[data-alltime-leaderboard]') || document.body;
    new MutationObserver(() => fixRedBullRingImage()).observe(rankingRoot,{childList:true,subtree:true});
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-language],[data-lang-switch]')) setTimeout(() => {
      document.querySelectorAll('[data-fr][data-en]').forEach(el => { el.textContent = el.dataset[lang()] || el.textContent; });
      if (track) fetch(`${apiBase}/public-event`,{cache:'no-store'}).then(r=>r.ok?r.json():{}).then(p=>renderTicker(p.events||[])).catch(()=>{});
    },0);
  });
})();
