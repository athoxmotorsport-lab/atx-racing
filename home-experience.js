(() => {
  const body = document.body;
  if (!body.classList.contains('home-page')) return;

  const apiBase = 'https://twjpjzalyvbsdpbzhqln.supabase.co/functions/v1';
  const getLang = () => document.documentElement.lang === 'en' ? 'en' : 'fr';
  const textFor = (el, lang) => el?.dataset?.[lang] || el?.textContent?.trim() || '';
  const eventList = document.querySelector('[data-event-list]');
  const archiveList = document.querySelector('[data-archive-list]');
  let publicEvents = [];

  const syncAdminShortcut = () => {
    const topLink = document.querySelector('[data-admin-event]');
    if (!topLink) return;
    topLink.dataset.fr = 'Gérer les événements';
    topLink.dataset.en = 'Manage events';
    topLink.textContent = getLang() === 'en' ? 'Manage events' : 'Gérer les événements';

    const nav = document.querySelector('.side-links');
    let sideLink = nav?.querySelector('[data-admin-manage-link]');
    if (!sideLink && nav) {
      sideLink = document.createElement('a');
      sideLink.href = 'event-admin.html#event-manager';
      sideLink.dataset.adminManageLink = '';
      sideLink.dataset.fr = 'Gérer événements';
      sideLink.dataset.en = 'Manage events';
      const span = document.createElement('span');
      span.textContent = getLang() === 'en' ? 'Manage events' : 'Gérer événements';
      sideLink.append(span);
      nav.append(sideLink);
    }
    if (sideLink) {
      sideLink.hidden = topLink.hidden;
      const span = sideLink.querySelector('span');
      if (span) span.textContent = getLang() === 'en' ? 'Manage events' : 'Gérer événements';
    }
  };

  const localDateKey = value => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Brussels'
    }).formatToParts(date);
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value || '').join('-');
  };

  const eventKeyFromApi = item => {
    const date = localDateKey(item?.starts_at);
    const track = String(item?.circuit_name || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/-gp$/g, '');
    return `${date}|${track}`;
  };

  const matchingApiEvent = card => {
    const key = String(card?.dataset?.eventKey || '');
    const [date, trackRaw] = key.split('|');
    const track = String(trackRaw || '').replace(/-gp$/g, '');
    return publicEvents.find(item => {
      const apiKey = eventKeyFromApi(item);
      const [apiDate, apiTrack] = apiKey.split('|');
      return apiDate === date && apiTrack === track;
    }) || null;
  };

  const getEventStart = card => {
    if (!card) return null;
    const key = String(card.dataset.eventKey || '');
    const datePart = key.split('|')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;

    const apiEvent = matchingApiEvent(card);
    if (apiEvent?.starts_at) {
      const parsed = new Date(apiEvent.starts_at);
      if (Number.isFinite(parsed.getTime())) return parsed;
    }

    const dateText = `${card.querySelector('.event-date')?.dataset?.fr || ''} ${card.querySelector('.event-date')?.textContent || ''}`;
    const timeMatch = dateText.match(/(?:à\s*)?(\d{1,2})[:h](\d{2})/i);
    if (timeMatch) {
      const hh = String(timeMatch[1]).padStart(2, '0');
      const mm = timeMatch[2];
      return new Date(`${datePart}T${hh}:${mm}:00`);
    }
    return new Date(`${datePart}T23:59:59`);
  };

  const getRaceDuration = card => {
    const apiEvent = matchingApiEvent(card);
    const apiDuration = Number(apiEvent?.duration_minutes);
    if (Number.isFinite(apiDuration) && apiDuration > 0) return apiDuration;
    const metaText = [...(card?.querySelectorAll('.event-meta span') || [])].map(el => el.textContent).join(' ');
    const match = metaText.match(/(?:Course|race)\s*(\d+)\s*(?:min|minute)/i);
    return match ? Number(match[1]) : 60;
  };

  const isPastEvent = card => {
    const start = getEventStart(card);
    if (!start) return false;
    const duration = getRaceDuration(card);
    const end = new Date(start.getTime() + duration * 60000);
    return end.getTime() < Date.now();
  };

  const minutesBetween = (start, end) => {
    const toMinutes = value => {
      const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
      return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const a = toMinutes(start), b = toMinutes(end);
    return a !== null && b !== null && b > a ? b - a : null;
  };

  const qualifyingMinutes = item => {
    const schedule = Array.isArray(item?.event_schedule) ? item.event_schedule : [];
    for (const slot of schedule) {
      const label = `${slot?.key || ''} ${slot?.label_fr || slot?.labelFr || ''} ${slot?.label_en || slot?.labelEn || ''}`.toLowerCase();
      if (/qual|quali|qualification|\bq\b/.test(label)) {
        const duration = minutesBetween(slot.start, slot.end);
        if (duration) return duration;
      }
    }
    return null;
  };

  const updateDateFromApi = card => {
    const item = matchingApiEvent(card);
    if (!item?.starts_at) return;
    const dateEl = card.querySelector('.event-date');
    if (!dateEl) return;
    const date = new Date(item.starts_at);
    if (!Number.isFinite(date.getTime())) return;
    dateEl.dataset.fr = new Intl.DateTimeFormat('fr-BE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(date);
    dateEl.dataset.en = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(date);
    dateEl.textContent = getLang() === 'en' ? dateEl.dataset.en : dateEl.dataset.fr;
  };

  const standardizeCard = card => {
    if (!card) return;
    updateDateFromApi(card);
    const item = matchingApiEvent(card);
    const meta = card.querySelector('.event-meta');
    if (!meta) return;

    const oldText = [...meta.querySelectorAll('span')].map(el => el.textContent.trim()).join(' · ');
    const duration = Number(item?.duration_minutes) || Number(oldText.match(/(?:Course|race)\s*(\d+)/i)?.[1]) || 60;
    const maxDrivers = Number(item?.max_drivers) || Number(oldText.match(/(\d+)\s*(?:pilotes|drivers)/i)?.[1]) || null;
    const quali = qualifyingMinutes(item) || Number(oldText.match(/Qualif(?:ications?)?\s*(\d+)/i)?.[1]) || null;
    const pitKnown = typeof item?.mandatory_pit_stop === 'boolean';
    const pit = pitKnown ? item.mandatory_pit_stop : /arrêt obligatoire|mandatory pit/i.test(oldText);

    const values = [
      [ `Course ${duration} min`, `${duration}-minute race` ],
      quali ? [ `Qualifications ${quali} min`, `${quali}-minute qualifying` ] : null,
      maxDrivers ? [ `${maxDrivers} pilotes maximum`, `${maxDrivers} drivers maximum` ] : null,
      (pitKnown || pit) ? [ pit ? '1 arrêt obligatoire' : 'Aucun arrêt obligatoire', pit ? '1 mandatory pit stop' : 'No mandatory pit stop' ] : null,
    ].filter(Boolean);

    meta.replaceChildren(...values.map(([fr, en]) => {
      const span = document.createElement('span');
      span.dataset.fr = fr;
      span.dataset.en = en;
      span.textContent = getLang() === 'en' ? en : fr;
      return span;
    }));
  };

  const prunePastEvents = () => {
    if (!eventList) return;
    const cards = [...eventList.querySelectorAll('.event-card')];
    cards.forEach(card => {
      standardizeCard(card);
      card.hidden = isPastEvent(card);
    });

    let empty = eventList.querySelector('[data-upcoming-empty]');
    const anyUpcoming = cards.some(card => !card.hidden);
    if (!anyUpcoming) {
      if (!empty) {
        empty = document.createElement('p');
        empty.className = 'empty-state events-empty';
        empty.dataset.upcomingEmpty = '';
        eventList.append(empty);
      }
      empty.dataset.fr = 'Aucun événement à venir pour le moment. Le prochain rendez-vous sera annoncé ici automatiquement.';
      empty.dataset.en = 'No upcoming event for now. The next race will appear here automatically.';
      empty.textContent = getLang() === 'en' ? empty.dataset.en : empty.dataset.fr;
    } else if (empty) {
      empty.remove();
    }
  };

  const readCard = card => {
    if (!card || card.hidden || isPastEvent(card)) return null;
    const title = card.querySelector('h3')?.textContent?.trim() || 'ATX Racing';
    const dateEl = card.querySelector('.event-date');
    const pageLink = card.querySelector('.event-body .btn[href]')?.getAttribute('href') || '#events';
    const registerLink = card.querySelector('.event-image[href]')?.getAttribute('href') || pageLink;
    const meta = [...card.querySelectorAll('.event-meta span')].map(item => textFor(item, getLang())).filter(Boolean).slice(0, 4);
    return { title, dateEl, pageLink, registerLink, meta, date: getEventStart(card) };
  };

  const findNextEvent = () => {
    const cards = [...document.querySelectorAll('[data-event-list] .event-card')];
    return cards.map(readCard).filter(Boolean).sort((a, b) => a.date - b.date)[0] || null;
  };

  const renderNextEvent = () => {
    const box = document.querySelector('[data-home-next-event]');
    if (!box) return;
    const lang = getLang();
    const event = findNextEvent();
    const title = box.querySelector('[data-home-next-title]');
    const date = box.querySelector('[data-home-next-date]');
    const meta = box.querySelector('[data-home-next-meta]');
    const primary = box.querySelector('[data-home-next-primary]');
    const secondary = box.querySelector('[data-home-next-secondary]');

    if (event) {
      title.textContent = event.title;
      date.textContent = textFor(event.dateEl, lang);
      meta.textContent = event.meta.join(' · ');
      primary.href = event.pageLink;
      primary.textContent = lang === 'en' ? 'View event' : "Voir l'événement";
      secondary.href = event.registerLink;
      secondary.hidden = false;
      secondary.textContent = lang === 'en' ? 'Registration' : 'Inscriptions';
      box.dataset.state = 'event';
      return;
    }

    title.textContent = lang === 'en' ? 'Next event coming soon' : 'Prochain événement bientôt';
    date.textContent = lang === 'en' ? 'Calendar being prepared' : 'Calendrier en préparation';
    meta.textContent = lang === 'en'
      ? 'Follow ATX Racing on Discord and SimGrid for the next opening.'
      : 'Suivez ATX Racing sur Discord et SimGrid pour la prochaine ouverture.';
    primary.href = '#events';
    primary.textContent = lang === 'en' ? 'View calendar' : 'Voir le calendrier';
    secondary.href = 'https://discord.gg/dgyJJYTSsD';
    secondary.hidden = false;
    secondary.textContent = 'Discord';
    box.dataset.state = 'waiting';
  };

  const renderTicker = () => {
    const track = document.querySelector('[data-live-ticker-track]');
    if (!track) return;
    const lang = getLang();
    const next = findNextEvent();
    const messages = next
      ? [
          lang === 'en' ? `Next event · ${next.title}` : `Prochain événement · ${next.title}`,
          textFor(next.dateEl, lang),
          lang === 'en' ? 'Registration via SimGrid' : 'Inscriptions via SimGrid',
          lang === 'en' ? 'Official results · Performance · SAFE' : 'Résultats officiels · Performance · SAFE',
          'Assetto Corsa Competizione · GT3'
        ]
      : [
          lang === 'en' ? 'ATX Racing · Next event in preparation' : 'ATX Racing · Prochain événement en préparation',
          lang === 'en' ? 'Registration and calendar via SimGrid' : 'Inscriptions et calendrier via SimGrid',
          lang === 'en' ? 'News and race control on Discord' : 'Infos et direction de course sur Discord',
          lang === 'en' ? 'Official results · Performance · SAFE' : 'Résultats officiels · Performance · SAFE',
          'Assetto Corsa Competizione · GT3'
        ];

    const makeSet = () => messages.map(message => `<span class="live-ticker-item">${message}</span>`).join('');
    track.innerHTML = `${makeSet()}${makeSet()}`;
  };

  const refresh = () => {
    syncAdminShortcut();
    prunePastEvents();
    renderNextEvent();
    renderTicker();
  };

  const loadPublicEvents = () => fetch(`${apiBase}/public-event?ts=${Date.now()}`, { cache: 'no-store' })
    .then(response => response.ok ? response.json() : Promise.reject(new Error('calendar_load_failed')))
    .then(payload => {
      publicEvents = [...(payload.events || []), ...(payload.archives || [])];
      refresh();
    })
    .catch(() => refresh());

  window.addEventListener('DOMContentLoaded', loadPublicEvents, { once: true });
  window.addEventListener('load', () => setTimeout(loadPublicEvents, 120), { once: true });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-lang-switch], [data-language]')) setTimeout(refresh, 0);
  });

  const adminObserver = new MutationObserver(syncAdminShortcut);
  const utilityActions = document.querySelector('.utility-actions');
  if (utilityActions) adminObserver.observe(utilityActions, { attributes:true, childList:true, subtree:true, attributeFilter:['hidden'] });

  if (eventList) new MutationObserver(() => setTimeout(refresh, 0)).observe(eventList, { childList: true, subtree: true });
  if (archiveList) new MutationObserver(() => setTimeout(refresh, 0)).observe(archiveList, { childList: true, subtree: true });

  setInterval(() => {
    loadPublicEvents();
    syncAdminShortcut();
  }, 60000);
})();
