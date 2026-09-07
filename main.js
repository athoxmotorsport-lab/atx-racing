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
})();
