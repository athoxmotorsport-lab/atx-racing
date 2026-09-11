(() => {
  const apiBase = 'https://twjpjzalyvbsdpbzhqln.supabase.co/functions/v1';
  const root = document.querySelector('[data-alltime-leaderboard]');
  if (!root) return;

  const formatLap = value => {
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '';
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    const remainder = Math.floor(milliseconds % 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`;
  };

  const normalise = value => String(value || '').trim().replace(/\s+/g, ' ');

  const sessionItem = (type, lap) => {
    const value = formatLap(lap);
    if (!value) return null;
    const span = document.createElement('span');
    span.className = 'session-lap-item';
    const label = document.createElement('strong');
    label.className = 'session-lap-prefix';
    label.dataset.session = type;
    label.textContent = type;
    span.append(label, document.createTextNode(` ${value}`));
    return span;
  };

  const setSessionLine = (element, laps) => {
    if (!element) return;
    const fp = laps?.FP ?? null;
    const q = laps?.Q ?? null;
    const r = laps?.R ?? null;
    const signature = `${fp || ''}|${q || ''}|${r || ''}`;
    if (element.dataset.sessionLapSignature === signature) return;
    const items = [sessionItem('FP', fp), sessionItem('Q', q), sessionItem('R', r)].filter(Boolean);
    element.replaceChildren(...items);
    element.classList.add('session-lap-line');
    element.dataset.sessionLapSignature = signature;
  };

  const setReference = (element, type, lap, driver) => {
    if (!element || !lap) return;
    const value = formatLap(lap);
    if (!value) return;
    const signature = `${type || ''}|${lap}|${driver || ''}`;
    if (element.dataset.sessionLapSignature === signature) return;
    const item = sessionItem(type || '', lap);
    if (!item) {
      element.textContent = `${value}${driver ? ` · ${driver}` : ''}`;
    } else {
      element.replaceChildren(item, document.createTextNode(driver ? ` · ${driver}` : ''));
    }
    element.dataset.sessionLapSignature = signature;
  };

  const getSessionLaps = entry => entry?.session_laps || {
    FP: entry?.session_type === 'FP' ? entry.best_lap_ms : null,
    Q: entry?.session_type === 'Q' ? entry.best_lap_ms : null,
    R: entry?.session_type === 'R' ? entry.best_lap_ms : null,
  };

  let payload = null;
  let decorating = false;
  const decorate = () => {
    if (!payload || decorating) return;
    decorating = true;
    try {
      const title = document.querySelector('[data-circuit-ranking-title]');
      const circuit = (payload.circuits || []).find(item => normalise(item.circuit_name) === normalise(title?.textContent));
      if (circuit) {
        const reference = document.querySelector('[data-circuit-reference]');
        setReference(reference, circuit.reference_session_type, circuit.reference_lap_ms, circuit.reference_driver);

        document.querySelectorAll('[data-circuit-ranking-body] tr').forEach(row => {
          const name = normalise(row.querySelector('th')?.textContent);
          const entry = (circuit.drivers || []).find(driver => normalise(driver.display_name) === name);
          const lapCell = row.children[2];
          if (entry && lapCell) setSessionLine(lapCell, getSessionLaps(entry));
        });
      }

      document.querySelectorAll('[data-ranking-circuits] .ranking-circuit-card').forEach((card, index) => {
        const circuitData = payload.circuits?.[index];
        const small = card.querySelector('small');
        if (!small || !circuitData?.reference_lap_ms) return;
        setReference(small, circuitData.reference_session_type, circuitData.reference_lap_ms, circuitData.reference_driver);
      });

      const select = document.querySelector('[data-driver-ranking-select]');
      const driverId = select?.value;
      document.querySelectorAll('[data-driver-circuit-grid] .driver-circuit-card').forEach((card, index) => {
        const circuitData = payload.circuits?.[index];
        const entry = (circuitData?.drivers || []).find(driver => driver.driver_id === driverId);
        const lap = card.querySelector('b');
        if (entry && lap) setSessionLine(lap, getSessionLaps(entry));
      });
    } finally {
      decorating = false;
    }
  };

  fetch(`${apiBase}/public-leaderboard`)
    .then(response => response.ok ? response.json() : Promise.reject(new Error('leaderboard_load_failed')))
    .then(data => {
      payload = data;
      decorate();
      const observer = new MutationObserver(decorate);
      observer.observe(root, { childList: true, subtree: true, characterData: true });
      document.querySelector('[data-driver-ranking-select]')?.addEventListener('change', () => queueMicrotask(decorate));
      document.querySelector('[data-ranking-circuits]')?.addEventListener('click', () => queueMicrotask(decorate));
    })
    .catch(() => {});
})();