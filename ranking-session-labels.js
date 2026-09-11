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
    if (!value || !type) return null;
    const span = document.createElement('span');
    span.className = 'session-lap-item';
    const label = document.createElement('strong');
    label.className = 'session-lap-prefix';
    label.dataset.session = type;
    label.textContent = type;
    span.append(label, document.createTextNode(` ${value}`));
    return span;
  };

  const collectSessionLaps = entry => {
    const source = entry?.session_laps || {};
    const laps = {
      FP: Number(source.FP) > 0 ? Number(source.FP) : null,
      Q: Number(source.Q) > 0 ? Number(source.Q) : null,
      R: Number(source.R) > 0 ? Number(source.R) : null,
    };
    if (!laps.FP && !laps.Q && !laps.R && entry?.best_lap_ms && entry?.session_type) {
      const type = String(entry.session_type).toUpperCase();
      if (type === 'FP' || type === 'Q' || type === 'R') laps[type] = Number(entry.best_lap_ms);
    }
    return laps;
  };

  const setSessionLine = (element, entry) => {
    if (!element || !entry) return;
    const laps = collectSessionLaps(entry);
    const items = [sessionItem('FP', laps.FP), sessionItem('Q', laps.Q), sessionItem('R', laps.R)].filter(Boolean);
    if (!items.length) return;
    const signature = `${laps.FP || ''}|${laps.Q || ''}|${laps.R || ''}`;
    if (element.dataset.sessionLapSignature === signature) return;
    const line = document.createElement('span');
    line.className = 'session-lap-line';
    line.append(...items);
    element.replaceChildren(line);
    element.dataset.sessionLapSignature = signature;
  };

  const setReference = (element, type, lap, driver) => {
    if (!element || !lap || !type) return;
    const item = sessionItem(type, lap);
    if (!item) return;
    const signature = `${type}|${lap}|${driver || ''}`;
    if (element.dataset.sessionLapSignature === signature) return;
    const line = document.createElement('span');
    line.className = 'session-lap-line';
    line.append(item);
    if (driver) line.append(document.createTextNode(` · ${driver}`));
    element.replaceChildren(line);
    element.dataset.sessionLapSignature = signature;
  };

  const timedDriverIds = () => {
    const ids = new Set();
    (payload?.circuits || []).forEach(circuit => {
      (circuit.drivers || []).forEach(driver => {
        if (Number(driver.best_lap_ms) > 0) ids.add(driver.driver_id);
      });
    });
    return ids;
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
        setReference(
          document.querySelector('[data-circuit-reference]'),
          circuit.reference_session_type,
          circuit.reference_lap_ms,
          circuit.reference_driver,
        );

        document.querySelectorAll('[data-circuit-ranking-body] tr').forEach(row => {
          const name = normalise(row.querySelector('th')?.textContent);
          const entry = (circuit.drivers || []).find(driver => normalise(driver.display_name) === name);
          if (!entry?.best_lap_ms) {
            row.remove();
            return;
          }
          const lapCell = row.children[2];
          if (lapCell) setSessionLine(lapCell, entry);
        });
      }

      document.querySelectorAll('[data-ranking-circuits] .ranking-circuit-card').forEach((card, index) => {
        const circuitData = payload.circuits?.[index];
        const small = card.querySelector('small');
        if (!small || !circuitData?.reference_lap_ms) return;
        setReference(small, circuitData.reference_session_type, circuitData.reference_lap_ms, circuitData.reference_driver);
      });

      const select = document.querySelector('[data-driver-ranking-select]');
      if (select) {
        const validIds = timedDriverIds();
        [...select.options].forEach(option => {
          if (!validIds.has(option.value)) option.remove();
        });
      }
      const driverId = select?.value;
      document.querySelectorAll('[data-driver-circuit-grid] .driver-circuit-card').forEach((card, index) => {
        const circuitData = payload.circuits?.[index];
        const entry = (circuitData?.drivers || []).find(driver => driver.driver_id === driverId);
        const lap = card.querySelector('b');
        if (entry?.best_lap_ms && lap) setSessionLine(lap, entry);
      });
    } finally {
      decorating = false;
    }
  };

  fetch(`${apiBase}/public-leaderboard`, { cache: 'no-store' })
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