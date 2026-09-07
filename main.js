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
      button.textContent = language === 'fr' ? 'EN' : 'FR';
      button.setAttribute('aria-label', language === 'fr' ? 'Afficher le site en anglais' : 'Show the website in French');
    }
  }

  button?.addEventListener('click', () => applyLanguage(language === 'fr' ? 'en' : 'fr'));
  applyLanguage(language);
})();
