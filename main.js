(() => {
  const assetPrefix = document.querySelector('script[src^="../"]') ? '../' : '';
  const sideActions = document.querySelector('.side-actions');
  if (sideActions) {
    const utility = document.createElement('header');
    utility.className = 'utility-bar';
    utility.innerHTML = '<span class="utility-context">ATX Racing · ACC Event Platform</span>';
    sideActions.classList.add('utility-actions');
    const tools = sideActions.querySelector('.side-tools');
    if (tools) {
      tools.innerHTML = `<div class="language-options" aria-label="Language"><button class="language-option" type="button" data-language="fr" aria-label="Français"><img src="${assetPrefix}assets/ui/flag-fr.svg" alt="Français"></button><button class="language-option" type="button" data-language="en" aria-label="English"><img src="${assetPrefix}assets/ui/flag-en.svg" alt="English"></button></div>`;
    }
    const adminLink = document.createElement('a');
    adminLink.className = 'admin-event-link';
    adminLink.href = `${assetPrefix}event-admin.html`;
    adminLink.hidden = true;
    adminLink.dataset.adminEvent = '';
    adminLink.dataset.fr = 'Ajouter un événement';
    adminLink.dataset.en = 'Add an event';
    sideActions.prepend(adminLink);
    utility.append(sideActions);
    document.body.insertBefore(utility, document.querySelector('main'));
  }

  const languageButtons = [...document.querySelectorAll('[data-language]')];
  const legacyButton = document.querySelector('[data-lang-switch]');
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
    languageButtons.forEach(item => item.setAttribute('aria-pressed', String(item.dataset.language === language)));
    if (legacyButton) legacyButton.setAttribute('aria-label', language === 'fr' ? 'Afficher le site en anglais' : 'Show the website in French');
  }

  languageButtons.forEach(item => item.addEventListener('click', () => applyLanguage(item.dataset.language === 'en' ? 'en' : 'fr')));
  legacyButton?.addEventListener('click', () => applyLanguage(language === 'fr' ? 'en' : 'fr'));
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
  const sessionKey = 'atx-racing-session';
  const requestSession = async (options = {}) => {
    const response = await fetch(`${apiBase}/auth-session`, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'session_error');
    return payload;
  };

  const revealAdminTools = driver => {
    const isAdmin = Array.isArray(driver?.roles) && driver.roles.includes('admin');
    document.querySelectorAll('[data-admin-event]').forEach(link => { link.hidden = !isAdmin; });
    return isAdmin;
  };

  const checkAdminSession = async () => {
    const token = sessionStorage.getItem(sessionKey);
    if (!token) return null;
    try {
      const payload = await requestSession({ headers: { Authorization: `Bearer ${token}` } });
      revealAdminTools(payload.driver);
      return payload;
    } catch {
      sessionStorage.removeItem(sessionKey);
      return null;
    }
  };
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
      const publicTitle = `Daily Race · ${event.circuit_name || 'ACC'}`;
      title.dataset.fr = publicTitle;
      title.dataset.en = publicTitle;
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

  const eventList = document.querySelector('[data-event-list]');
  if (eventList) {
    const eventKey = (startsAt, circuit) => {
      const instant = new Date(startsAt);
      const parts = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Brussels',
      }).formatToParts(instant);
      const date = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value || '').join('-');
      const track = String(circuit || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      return `${date}|${track}`;
    };
    fetch(`${apiBase}/public-event`)
      .then(response => response.ok ? response.json() : Promise.reject(new Error('calendar_load_failed')))
      .then(payload => {
        const existingKeys = new Set([...eventList.querySelectorAll('[data-event-key]')].map(card => card.dataset.eventKey));
        (payload.events || []).slice().sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).forEach(item => {
          const key = eventKey(item.starts_at, item.circuit_name);
          if (!item.simgrid_url || !item.image_url || existingKeys.has(key)) return;
          existingKeys.add(key);
          const eventDate = new Date(item.starts_at);
          const card = document.createElement('article');
          card.className = 'event-card';
          card.dataset.eventKey = key;
          const imageLink = document.createElement('a');
          imageLink.className = 'event-image';
          imageLink.href = item.simgrid_url;
          imageLink.target = '_blank';
          imageLink.rel = 'noopener';
          const image = document.createElement('img');
          image.src = item.image_url.startsWith('/') ? item.image_url.slice(1) : item.image_url;
          image.alt = item.title_fr || item.title_en || 'ATX Racing event';
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.dataset.fr = eventDate > new Date() ? 'À venir' : 'Terminé';
          badge.dataset.en = eventDate > new Date() ? 'Upcoming' : 'Completed';
          imageLink.append(image, badge);
          const body = document.createElement('div');
          body.className = 'event-body';
          const date = document.createElement('div');
          date.className = 'event-date';
          date.dataset.fr = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(eventDate);
          date.dataset.en = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(eventDate);
          const title = document.createElement('h3');
          title.dataset.fr = item.title_fr;
          title.dataset.en = item.title_en;
          const meta = document.createElement('div');
          meta.className = 'event-meta';
          const duration = document.createElement('span');
          duration.dataset.fr = `Course ${item.duration_minutes} min`;
          duration.dataset.en = `${item.duration_minutes}-minute race`;
          const drivers = document.createElement('span');
          drivers.dataset.fr = `${item.max_drivers} pilotes maximum`;
          drivers.dataset.en = `${item.max_drivers} drivers maximum`;
          meta.append(duration, drivers);
          const result = document.createElement('a');
          result.className = 'btn small primary';
          result.href = `course.html?event=${encodeURIComponent(item.slug)}`;
          result.dataset.fr = 'Voir la course';
          result.dataset.en = 'View race';
          body.append(date, title, meta, result);
          card.append(imageLink, body);
          eventList.append(card);
        });
        applyLanguage(language);
      })
      .catch(() => { /* Static event cards remain available as a safe fallback. */ });
  }

  const leaderboard = document.querySelector('[data-alltime-leaderboard]');
  if (leaderboard) {
    const leaderboardStatus = document.querySelector('[data-leaderboard-status]');
    const leaderboardBody = document.querySelector('[data-leaderboard-body]');
    const tierProgress = (tier, score) => {
      if (!Number.isFinite(score)) return 0;
      if (tier === 'alien') return 100;
      if (tier === 'elite') return Math.max(0, Math.min(100, (106 - score) / 4.01 * 100));
      if (tier === 'pro') return Math.max(0, Math.min(100, (109 - score) / 3.01 * 100));
      return Math.max(0, Math.min(100, (115 - Math.min(score, 115)) / 6.01 * 100));
    };
    const nextTier = tier => ({
      rookie: ['Pro · 108.99%', 'Pro · 108.99%'],
      pro: ['Elite · 105.99%', 'Elite · 105.99%'],
      elite: ['Alien · 101.99%', 'Alien · 101.99%'],
      alien: ['Niveau maximal', 'Top level'],
    }[tier] || ['Premiers chronos requis', 'First lap times required']);
    fetch(`${apiBase}/public-leaderboard`)
      .then(response => response.ok ? response.json() : Promise.reject(new Error('leaderboard_load_failed')))
      .then(payload => {
        leaderboardBody.replaceChildren();
        (payload.drivers || []).forEach(driver => {
          const row = document.createElement('tr');
          const rank = document.createElement('td');
          rank.className = 'leaderboard-rank';
          rank.textContent = String(driver.rank);
          const identity = document.createElement('th');
          identity.scope = 'row';
          const identityBox = document.createElement('div');
          identityBox.className = 'leaderboard-driver';
          const avatar = document.createElement('span');
          avatar.className = 'leaderboard-avatar';
          if (driver.avatar_url) {
            const image = document.createElement('img');
            image.src = driver.avatar_url;
            image.alt = '';
            image.referrerPolicy = 'no-referrer';
            avatar.append(image);
          } else avatar.textContent = String(driver.display_name || 'AT').slice(0, 2).toUpperCase();
          const driverName = document.createElement('strong');
          driverName.textContent = driver.display_name || 'ACC Driver';
          identityBox.append(avatar, driverName);
          identity.append(identityBox);
          const numericCell = value => {
            const cell = document.createElement('td');
            cell.textContent = Number(value || 0).toLocaleString(language === 'fr' ? 'fr-BE' : 'en-GB', { maximumFractionDigits: 1 });
            return cell;
          };
          const pace = document.createElement('td');
          const tier = String(driver.performance_class || 'unranked');
          const tierLine = document.createElement('div');
          tierLine.className = 'pace-heading';
          const tierBadge = document.createElement('span');
          tierBadge.className = 'tier-pill';
          tierBadge.dataset.tier = tier;
          tierBadge.textContent = tier.toUpperCase();
          const score = document.createElement('strong');
          score.textContent = Number.isFinite(driver.performance_score) ? `${Number(driver.performance_score).toFixed(2)}%` : '—';
          const trend = document.createElement('span');
          trend.className = 'pace-trend';
          const trendValue = Number(driver.progression);
          if (Number.isFinite(trendValue) && Math.abs(trendValue) >= 0.005) {
            trend.dataset.direction = trendValue > 0 ? 'up' : 'down';
            trend.textContent = `${trendValue > 0 ? '↑' : '↓'} ${Math.abs(trendValue).toFixed(2)}%`;
          } else trend.textContent = '—';
          tierLine.append(tierBadge, score, trend);
          const rail = document.createElement('div');
          rail.className = 'pace-progress';
          rail.setAttribute('role', 'progressbar');
          const progress = tierProgress(tier, Number(driver.performance_score));
          rail.setAttribute('aria-valuenow', String(Math.round(progress)));
          rail.setAttribute('aria-valuemin', '0');
          rail.setAttribute('aria-valuemax', '100');
          const fill = document.createElement('i');
          fill.style.width = `${progress}%`;
          rail.append(fill);
          const target = document.createElement('small');
          const targetText = nextTier(tier);
          target.dataset.fr = `Prochain objectif : ${targetText[0]}`;
          target.dataset.en = `Next target: ${targetText[1]}`;
          pace.append(tierLine, rail, target);
          const safe = document.createElement('td');
          const safeBadge = document.createElement('span');
          safeBadge.className = 'tier-pill';
          safeBadge.dataset.tier = driver.safety_class || 'unranked';
          safeBadge.textContent = String(driver.safety_class || '—').toUpperCase();
          safe.append(safeBadge);
          row.append(rank, identity, numericCell(driver.points), numericCell(driver.races), numericCell(driver.wins), numericCell(driver.podiums), pace, safe);
          leaderboardBody.append(row);
        });
        leaderboard.hidden = false;
        leaderboardStatus.hidden = true;
        applyLanguage(language);
      })
      .catch(() => {
        leaderboardStatus.dataset.fr = 'Le classement est momentanément indisponible.';
        leaderboardStatus.dataset.en = 'The ranking is temporarily unavailable.';
        applyLanguage(language);
      });
  }

  const profile = document.querySelector('[data-driver-profile]');
  const adminForm = document.querySelector('[data-event-form]');
  if (adminForm) {
    const formStatus = document.querySelector('[data-form-status]');
    const setFormStatus = (fr, en, state = '') => {
      formStatus.dataset.fr = fr;
      formStatus.dataset.en = en;
      formStatus.dataset.state = state;
      formStatus.textContent = language === 'fr' ? fr : en;
    };
    checkAdminSession().then(payload => {
      if (!payload || !revealAdminTools(payload.driver)) {
        adminForm.hidden = true;
        setFormStatus('Accès réservé à l’administrateur ATX Racing.', 'Access is restricted to the ATX Racing administrator.', 'error');
      } else {
        adminForm.hidden = false;
        setFormStatus('Votre session administrateur est active.', 'Your administrator session is active.', 'success');
      }
    });
    adminForm.addEventListener('submit', async event => {
      event.preventDefault();
      const token = sessionStorage.getItem(sessionKey);
      const submit = adminForm.querySelector('[type="submit"]');
      submit.disabled = true;
      setFormStatus('Publication de l’événement…', 'Publishing the event…', 'loading');
      try {
        const data = new FormData(adminForm);
        const image = data.get('image');
        let imageData = null;
        if (image instanceof File && image.size) {
          if (image.size > 5 * 1024 * 1024) throw new Error('image_too_large');
          imageData = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(image);
          });
        }
        const body = {
          titleFr: data.get('titleFr'), titleEn: data.get('titleEn'), circuit: data.get('circuit'),
          startsAt: data.get('startsAt'), durationMinutes: Number(data.get('durationMinutes')),
          maxDrivers: Number(data.get('maxDrivers')), eventType: data.get('eventType'),
          simgridUrl: data.get('simgridUrl'), imageData, imageType: image instanceof File ? image.type : null,
        };
        const response = await fetch(`${apiBase}/manage-events`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'publish_failed');
        adminForm.reset();
        setFormStatus('Événement publié. Il apparaîtra automatiquement dans le calendrier.', 'Event published. It will appear automatically in the calendar.', 'success');
      } catch (error) {
        const tooLarge = error instanceof Error && error.message === 'image_too_large';
        setFormStatus(tooLarge ? 'L’image dépasse 5 Mo.' : 'La publication a échoué. Vérifiez les champs et votre session.', tooLarge ? 'The image is larger than 5 MB.' : 'Publishing failed. Check the fields and your session.', 'error');
      } finally { submit.disabled = false; }
    });
  } else {
    checkAdminSession();
  }

  if (!profile) return;

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

  const cleanEventTitle = (value, event, fallback) => {
    const stripped = String(value || '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\bjoin\b.*$/i, '')
      .replace(/\s*\|\s*$/g, '')
      .trim();
    if (!stripped || /^(atx\s?motorsport|atx\s?racing)(\s*\||$)/i.test(stripped)) {
      return `Daily Race · ${event.circuit_name || 'ACC'}`;
    }
    return stripped.slice(0, 96) || fallback;
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
      title.dataset.fr = cleanEventTitle(event.title_fr || event.title_en, event, 'Événement ATX Racing');
      title.dataset.en = cleanEventTitle(event.title_en || event.title_fr, event, 'ATX Racing event');
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

  const circuits = [
    ['barcelona','Barcelona'],['brands_hatch','Brands Hatch'],['cota','Circuit of the Americas'],['donington','Donington Park'],['hungaroring','Hungaroring'],
    ['imola','Imola'],['indianapolis','Indianapolis'],['kyalami','Kyalami'],['laguna_seca','Laguna Seca'],['misano','Misano'],
    ['monza','Monza'],['mount_panorama','Mount Panorama'],['nurburgring','Nürburgring GP'],['nurburgring_24h','Nürburgring 24h'],['oulton_park','Oulton Park'],
    ['paul_ricard','Paul Ricard'],['red_bull_ring','Red Bull Ring'],['silverstone','Silverstone'],['snetterton','Snetterton'],['spa','Spa-Francorchamps'],
    ['suzuka','Suzuka'],['valencia','Valencia'],['watkins_glen','Watkins Glen'],['zandvoort','Zandvoort'],['zolder','Zolder'],
  ];

  const renderCircuits = data => {
    const grid = document.querySelector('[data-circuit-grid]');
    const dialog = document.querySelector('[data-circuit-dialog]');
    if (!grid || !dialog) return;
    const byKey = new Map((Array.isArray(data) ? data : []).map(item => [item.circuit_key, item]));
    grid.replaceChildren();
    circuits.forEach(([key, name]) => {
      const item = byKey.get(key) || {};
      const button = document.createElement('button');
      button.className = 'circuit-card';
      button.type = 'button';
      const mark = name.split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase();
      button.innerHTML = `<span class="circuit-mark">${mark}</span><strong>${name}</strong><small>${item.personal_best_lap_ms ? formatLap(item.personal_best_lap_ms) : '—'}</small>`;
      button.addEventListener('click', () => {
        dialog.querySelector('[data-dialog-circuit]').textContent = name;
        dialog.querySelector('[data-dialog-reference]').textContent = formatLap(item.alien_best_lap_ms);
        dialog.querySelector('[data-dialog-personal]').textContent = formatLap(item.personal_best_lap_ms);
        dialog.querySelector('[data-dialog-pace]').textContent = item.pace_percent ? `${Number(item.pace_percent).toFixed(2)}%` : '—';
        dialog.querySelector('[data-dialog-performance]').textContent = String(item.performance_class || '—').toUpperCase();
        dialog.querySelector('[data-dialog-safe]').textContent = String(item.safety_class || '—').toUpperCase();
        dialog.showModal();
      });
      grid.append(button);
    });
  };

  document.querySelector('[data-dialog-close]')?.addEventListener('click', () => document.querySelector('[data-circuit-dialog]')?.close());
  renderCircuits([]);

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
    renderCircuits(driver.circuits);
    revealAdminTools(driver);
    applyLanguage(language);
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
