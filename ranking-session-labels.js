(() => {
  const apiBase = 'https://twjpjzalyvbsdpbzhqln.supabase.co/functions/v1';
  const root = document.querySelector('[data-alltime-leaderboard]');
  if (!root) return;

  const formatLap = value => {
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '—';
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    const remainder = Math.floor(milliseconds % 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`;
  };

  const normalise = value => String(value || '').trim().replace(/\s+/g, ' ');
  const badge = type => {
    const strong = document.createElement('strong');
    strong.className = 'session-lap-prefix';
    strong.dataset.session = type || '—';
    strong.textContent = type || '—';
    return strong;
  };
  const setLap = (element, type, lap) => {
    if (!element || !lap) return;
    const sessionType = type || '—';
    const signature = `${sessionType}|${lap}`;
    if (element.dataset.sessionLapSignature === signature) return;
    element.replaceChildren(badge(sessionType), document.createTextNode(` : ${formatLap(lap)}`));
    element.dataset.sessionLapSignature = signature;
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
        if (reference && circuit.reference_lap_ms) {
          const signature = `${circuit.reference_session_type || '—'}|${circuit.reference_lap_ms}|${circuit.reference_driver || ''}`;
          if (reference.dataset.sessionLapSignature !== signature) {
            reference.replaceChildren(
              badge(circuit.reference_session_type || '—'),
              document.createTextNode(` : ${formatLap(circuit.reference_lap_ms)} · ${circuit.reference_driver || '—'}`),
            );
            reference.dataset.sessionLapSignature = signature;
          }
        }

        document.querySelectorAll('[data-circuit-ranking-body] tr').forEach(row => {
          const name = normalise(row.querySelector('th')?.textContent);
          const entry = (circuit.drivers || []).find(driver => normalise(driver.display_name) === name);
          const lapCell = row.children[2];
          if (entry?.best_lap_ms && lapCell) setLap(lapCell, entry.session_type, entry.best_lap_ms);
        });
      }

      document.querySelectorAll('[data-ranking-circuits] .ranking-circuit-card').forEach((card, index) => {
        const circuitData = payload.circuits?.[index];
        const small = card.querySelector('small');
        if (!small || !circuitData?.reference_lap_ms) return;
        const signature = `${circuitData.reference_session_type || '—'}|${circuitData.reference_lap_ms}|${circuitData.reference_driver || ''}`;
        if (small.dataset.sessionLapSignature === signature) return;
        small.replaceChildren(
          badge(circuitData.reference_session_type || '—'),
          document.createTextNode(` : ${formatLap(circuitData.reference_lap_ms)} · ${circuitData.reference_driver || '—'}`),
        );
        small.dataset.sessionLapSignature = signature;
      });

      const select = document.querySelector('[data-driver-ranking-select]');
      const driverId = select?.value;
      document.querySelectorAll('[data-driver-circuit-grid] .driver-circuit-card').forEach((card, index) => {
        const circuitData = payload.circuits?.[index];
        const entry = (circuitData?.drivers || []).find(driver => driver.driver_id === driverId);
        const lap = card.querySelector('b');
        if (entry?.best_lap_ms && lap) setLap(lap, entry.session_type, entry.best_lap_ms);
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