(() => {
  const body = document.body;
  if (!body.classList.contains('home-page')) return;

  const getEventDate = card => {
    const key = String(card?.dataset?.eventKey || '');
    const datePart = key.split('|')[0];
    const date = new Date(`${datePart}T23:59:59`);
    return Number.isFinite(date.getTime()) ? date : null;
  };

  const getLang = () => document.documentElement.lang === 'en' ? 'en' : 'fr';
  const textFor = (el, lang) => el?.dataset?.[lang] || el?.textContent?.trim() || '';

  const readCard = card => {
    if (!card) return null;
    const title = card.querySelector('h3')?.textContent?.trim() || 'ATX Racing';
    const dateEl = card.querySelector('.event-date');
    const pageLink = card.querySelector('.event-body .btn[href]')?.getAttribute('href') || '#events';
    const registerLink = card.querySelector('.event-image[href]')?.getAttribute('href') || pageLink;
    const meta = [...card.querySelectorAll('.event-meta span')].map(item => item.textContent.trim()).filter(Boolean).slice(0, 3);
    return { title, dateEl, pageLink, registerLink, meta, date: getEventDate(card) };
  };

  const findNextEvent = () => {
    const now = new Date();
    const cards = [...document.querySelectorAll('[data-event-list] .event-card')];
    return cards
      .map(readCard)
      .filter(Boolean)
      .filter(event => event.date && event.date >= now)
      .sort((a, b) => a.date - b.date)[0] || null;
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
    renderNextEvent();
    renderTicker();
  };

  window.addEventListener('DOMContentLoaded', refresh, { once: true });
  window.addEventListener('load', refresh, { once: true });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-lang-switch]')) setTimeout(refresh, 0);
  });

  const eventList = document.querySelector('[data-event-list]');
  if (eventList) new MutationObserver(refresh).observe(eventList, { childList: true, subtree: true });
})();
