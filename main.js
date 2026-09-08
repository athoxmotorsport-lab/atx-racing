(() => {
  const button = document.querySelector('[data-lang-switch]');
  const saved = localStorage.getItem('atx-language');
  let language = saved === 'en' ? 'en' : 'fr';

  function applyLanguage(next) {
    language = next;
    document.documentElement.lang = language;
    localStorage.setItem('atx-language', language);
    document.querySelectorAll('[data-fr][data-en]').forEach(element => {
      element.textContent = element.dataset[language];
    });
    document.querySelectorAll('[data-lang-panel]').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.langPanel === language);
    });
    if (button) {
      const prefix = document.querySelector('script[src^="../"]') ? '../' : '';
      button.innerHTML = language === 'fr' ? `<img src="${prefix}assets/ui/flag-en.svg" alt="English">` : `<img src="${prefix}assets/ui/flag-fr.svg" alt="Français">`;
      button.setAttribute('aria-label', language === 'fr' ? 'Afficher le site en anglais' : 'Show the website in French');
      button.title = language === 'fr' ? 'English' : 'Français';
    }
  }

  button?.addEventListener('click', () => applyLanguage(language === 'fr' ? 'en' : 'fr'));
  applyLanguage(language);

  const localLinks = [...document.querySelectorAll('.side-links a[href^="#"]')];
  const observedSections = localLinks.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  if (observedSections.length) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        localLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`));
      });
    }, { rootMargin: '-28% 0px -62% 0px' });
    observedSections.forEach(section => observer.observe(section));
  }

  const apiBase = 'https://twjpjzalyvbsdpbzhqln.supabase.co/functions/v1';
  const formatLap = value => {
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '—';
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    const remainder = Math.floor(milliseconds % 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`;
  };

  const eventView = document.querySelector('[data-public-event]');
  if (eventView) {
    const eventStatus = eventView.querySelector('[data-event-status]');
    const renderPublicEvent = payload => {
      const event = payload.event || {};
      const title = eventView.querySelector('[data-event-title]');
      title.dataset.fr = event.title_fr || event.title_en || 'Résultat ATX Racing';
      title.dataset.en = event.title_en || event.title_fr || 'ATX Racing result';
      eventView.querySelector('[data-event-circuit]').textContent = event.circuit_name || '—';
      const date = eventView.querySelector('[data-event-date]');
      if (event.starts_at) {
        date.dataset.fr = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(new Date(event.starts_at));
        date.dataset.en = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(new Date(event.starts_at));
      } else {
        date.dataset.fr = '—';
        date.dataset.en = '—';
      }
      const body = eventView.querySelector('[data-event-results]');
      body.replaceChildren();
      (payload.results || []).forEach(result => {
        const row = document.createElement('tr');
        const driver = Array.isArray(result.driver) ? result.driver[0] : result.driver;
        const values = [
          result.finish_position ? `P${result.finish_position}` : String(result.status || '—').toUpperCase(),
          driver?.display_name || 'ACC Driver',
          result.car_model_name || '—',
          String(result.laps_completed ?? 0),
          formatLap(result.best_lap_ms),
          Number(result.points || 0).toLocaleString(language === 'fr' ? 'fr-BE' : 'en-GB'),
        ];
        values.forEach((value, index) => {
          const cell = document.createElement(index === 1 ? 'th' : 'td');
          if (index === 1) cell.scope = 'row';
          cell.textContent = value;
          row.append(cell);
        });
        body.append(row);
      });
      eventStatus.hidden = true;
      applyLanguage(language);
    };
    const slug = new URLSearchParams(location.search).get('event') || eventView.dataset.publicEvent;
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '')) {
      fetch(`${apiBase}/public-event?slug=${encodeURIComponent(slug)}`)
        .then(response => response.ok ? response.json() : Promise.reject(new Error('event_load_failed')))
        .then(renderPublicEvent)
        .catch(() => {
          eventStatus.dataset.fr = 'Le classement officiel n’est pas encore disponible.';
          eventStatus.dataset.en = 'The official standings are not available yet.';
          applyLanguage(language);
        });
    } else {
      eventStatus.dataset.fr = 'Événement introuvable.';
      eventStatus.dataset.en = 'Event not found.';
      applyLanguage(language);
    }
  }

  const profile = document.querySelector('[data-driver-profile]');
  if (!profile) return;

  const sessionKey = 'atx-racing-session';
  const status = document.querySelector('[data-auth-status]');
  const loginActions = document.querySelector('[data-login-actions]');
  const sessionActions = document.querySelector('[data-session-actions]');
  const logoutButton = document.querySelector('[data-logout]');

  const setStatus = (fr, en, kind = '') => {
    if (!status) return;
    status.dataset.fr = fr;
    status.dataset.en = en;
    status.dataset.state = kind;
    status.textContent = language === 'fr' ? fr : en;
  };

  const resetProfile = () => {
    const name = profile.querySelector('[data-profile-name]');
    name.dataset.fr = 'Votre profil';
    name.dataset.en = 'Your profile';
    name.textContent = language === 'fr' ? name.dataset.fr : name.dataset.en;
    profile.querySelector('[data-profile-id]').textContent = 'Steam ID · ATX Driver ID';
    profile.querySelector('[data-profile-rank]').textContent = '—';
    profile.querySelector('[data-profile-races]').textContent = '0';
    profile.querySelector('[data-profile-podiums]').textContent = '0';
    profile.querySelector('[data-profile-points]').textContent = '0';
    profile.dataset.tier = 'unranked';
    const avatar = profile.querySelector('[data-profile-avatar]');
    avatar.replaceChildren(document.createTextNode('ATX'));
    for (const badge of profile.querySelectorAll('[data-tier]')) badge.dataset.tier = 'unranked';
    const performance = profile.querySelector('[data-performance-badge]');
    performance.dataset.fr = 'Performance · non classé';
    performance.dataset.en = 'Performance · unranked';
    const safe = profile.querySelector('[data-safe-badge]');
    safe.dataset.fr = 'SAFE · non classé';
    safe.dataset.en = 'SAFE · unranked';
    applyLanguage(language);
  };

  const renderResults = results => {
    const container = document.querySelector('[data-profile-results]');
    if (!container || !Array.isArray(results) || !results.length) return;
    container.replaceChildren();
    results.forEach(result => {
      const event = Array.isArray(result.event) ? (result.event[0] || {}) : (result.event || {});
      const row = document.createElement('a');
      row.className = 'profile-result-row';
      row.href = `course.html?event=${encodeURIComponent(event.slug || '')}`;
      const top = document.createElement('div');
      top.className = 'profile-result-top';
      const date = document.createElement('span');
      const eventDate = event.starts_at ? new Date(event.starts_at) : null;
      date.dataset.fr = eventDate
        ? new Intl.DateTimeFormat('fr-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(eventDate)
        : 'Date inconnue';
      date.dataset.en = eventDate
        ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(eventDate)
        : 'Unknown date';
      const circuit = document.createElement('b');
      circuit.textContent = event.circuit_name || 'ACC';
      top.append(date, circuit);
      const title = document.createElement('strong');
      title.dataset.fr = event.title_fr || event.title_en || 'Événement ATX Racing';
      title.dataset.en = event.title_en || event.title_fr || 'ATX Racing event';
      const position = result.finish_position ? `P${result.finish_position}` : String(result.status || '—').toUpperCase();
      const pointsFr = Number(result.points || 0).toLocaleString('fr-BE');
      const pointsEn = Number(result.points || 0).toLocaleString('en-GB');
      const metrics = document.createElement('div');
      metrics.className = 'profile-result-metrics';
      const addMetric = (fr, en, valueFr, valueEn = valueFr) => {
        const metric = document.createElement('div');
        const label = document.createElement('small');
        label.dataset.fr = fr;
        label.dataset.en = en;
        const value = document.createElement('span');
        value.dataset.fr = valueFr;
        value.dataset.en = valueEn;
        metric.append(label, value);
        metrics.append(metric);
      };
      addMetric('Position', 'Position', position);
      addMetric('Points', 'Points', pointsFr, pointsEn);
      addMetric('Tours', 'Laps', String(result.laps_completed || 0));
      addMetric('Meilleur tour', 'Best lap', formatLap(result.best_lap_ms));
      const action = document.createElement('em');
      action.dataset.fr = 'Voir le classement complet →';
      action.dataset.en = 'View full standings →';
      row.append(top, title, metrics, action);
      container.append(row);
    });
  };

  const renderProfile = payload => {
    const driver = payload.driver;
    const ratings = Array.isArray(driver.ratings) ? driver.ratings : [];
    const rating = ratings.find(item => item.circuit_key === 'overall') || ratings[0] || null;
    const stats = driver.stats || { races: 0, podiums: 0, points: 0 };
    const name = profile.querySelector('[data-profile-name]');
    delete name.dataset.fr;
    delete name.dataset.en;
    name.textContent = driver.display_name;
    profile.querySelector('[data-profile-id]').textContent = `ATX Driver · ${driver.id.slice(0, 8).toUpperCase()}`;
    profile.querySelector('[data-profile-rank]').textContent = rating?.performance_class?.toUpperCase() || '—';
    profile.querySelector('[data-profile-races]').textContent = String(stats.races || 0);
    profile.querySelector('[data-profile-podiums]').textContent = String(stats.podiums || 0);
    profile.querySelector('[data-profile-points]').textContent = Number(stats.points || 0).toLocaleString(language === 'fr' ? 'fr-BE' : 'en-GB');

    const avatar = profile.querySelector('[data-profile-avatar]');
    avatar.replaceChildren();
    if (driver.avatar_url) {
      const image = document.createElement('img');
      image.src = driver.avatar_url;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      avatar.append(image);
    } else {
      avatar.textContent = driver.display_name.slice(0, 2).toUpperCase();
    }

    const performance = profile.querySelector('[data-performance-badge]');
    const performanceTier = rating?.performance_class || 'unranked';
    profile.dataset.tier = performanceTier;
    performance.dataset.tier = performanceTier;
    performance.dataset.fr = rating ? `Performance · ${performanceTier}` : 'Performance · non classé';
    performance.dataset.en = rating ? `Performance · ${performanceTier}` : 'Performance · unranked';
    const safe = profile.querySelector('[data-safe-badge]');
    const safeTier = rating?.safety_class || 'unranked';
    safe.dataset.tier = safeTier;
    safe.dataset.fr = rating ? `SAFE · ${safeTier}` : 'SAFE · non classé';
    safe.dataset.en = rating ? `SAFE · ${safeTier}` : 'SAFE · unranked';
    loginActions.hidden = true;
    sessionActions.hidden = false;
    profile.setAttribute('aria-busy', 'false');
    renderResults(driver.results);
    applyLanguage(language);
  };

  const requestSession = async (options = {}) => {
    const response = await fetch(`${apiBase}/auth-session`, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'session_error');
    return payload;
  };

  const loadProfile = async token => {
    profile.setAttribute('aria-busy', 'true');
    const payload = await requestSession({ headers: { Authorization: `Bearer ${token}` } });
    renderProfile(payload);
  };

  const initialiseProfile = async () => {
    const fragment = new URLSearchParams(location.hash.slice(1));
    const exchangeCode = fragment.get('steam_code');
    const query = new URLSearchParams(location.search);

    if (exchangeCode) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
      setStatus('Connexion Steam en cours…', 'Completing Steam sign-in…', 'loading');
      profile.setAttribute('aria-busy', 'true');
      try {
        const payload = await requestSession({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: exchangeCode }),
        });
        sessionStorage.setItem(sessionKey, payload.access_token);
        renderProfile(payload);
        setStatus('Connexion réussie. Votre profil est actif.', 'Signed in. Your profile is active.', 'success');
        return;
      } catch {
        sessionStorage.removeItem(sessionKey);
        resetProfile();
        setStatus('Le lien Steam a expiré ou n’est pas valide. Veuillez recommencer.', 'The Steam link has expired or is invalid. Please try again.', 'error');
        return;
      }
    }

    if (query.get('steam') === 'error') {
      query.delete('steam');
      query.delete('reason');
      const cleanQuery = query.toString();
      history.replaceState(null, '', `${location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`);
      setStatus('La connexion Steam a échoué. Veuillez recommencer.', 'Steam sign-in failed. Please try again.', 'error');
    }

    const token = sessionStorage.getItem(sessionKey);
    if (!token) return;
    setStatus('Chargement de votre profil…', 'Loading your profile…', 'loading');
    try {
      await loadProfile(token);
      setStatus('Vous êtes connecté avec Steam.', 'You are signed in with Steam.', 'success');
    } catch {
      sessionStorage.removeItem(sessionKey);
      resetProfile();
      setStatus('Votre session a expiré. Reconnectez-vous avec Steam.', 'Your session has expired. Sign in with Steam again.', 'error');
    }
  };

  logoutButton?.addEventListener('click', async () => {
    const token = sessionStorage.getItem(sessionKey);
    logoutButton.disabled = true;
    try {
      if (token) {
        await fetch(`${apiBase}/auth-logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } finally {
      sessionStorage.removeItem(sessionKey);
      logoutButton.disabled = false;
      loginActions.hidden = false;
      sessionActions.hidden = true;
      resetProfile();
      setStatus('Vous êtes déconnecté.', 'You are signed out.', 'success');
    }
  });

  initialiseProfile();
})();
