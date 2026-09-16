(() => {
  const form = document.querySelector('[data-profile-form]');
  const profile = document.querySelector('[data-driver-profile]');
  if (!form || !profile) return;

  const base = 'https://twjpjzalyvbsdpbzhqln.supabase.co/functions/v1';
  const sessionKey = 'atx-racing-session';
  const queryDriverId = new URLSearchParams(location.search).get('driver') || '';
  const validDriverId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isPublicProfile = validDriverId.test(queryDriverId);
  const flag = code => code ? String.fromCodePoint(...String(code).toUpperCase().split('').map(c => 127397 + c.charCodeAt())) : '';
  const countryTop = profile.querySelector('[data-profile-country]');
  const carTop = profile.querySelector('[data-profile-car-number]');
  const countryDetail = document.querySelector('[data-profile-country-detail]');
  const carDetail = document.querySelector('[data-profile-car-detail]');

  const ensureFields = () => {
    if (!form.elements.displayName) {
      const label = document.createElement('label');
      label.innerHTML = '<span>Nom / pseudo public</span><input name="displayName" maxlength="64" autocomplete="nickname"><small class="profile-field-help">Par défaut : pseudo Steam. Votre choix personnalisé reste prioritaire.</small>';
      form.insertBefore(label, form.firstElementChild?.nextSibling || form.firstElementChild);
    }
    if (!form.elements.avatarFile) {
      const label = document.createElement('label');
      label.className = 'profile-avatar-field';
      label.innerHTML = '<span>Photo de profil personnalisée</span><input name="avatarFile" type="file" accept="image/jpeg,image/png,image/webp"><small class="profile-field-help">JPG, PNG ou WebP · 2 Mo maximum. Sans photo personnalisée, votre avatar Steam reste utilisé.</small>';
      form.elements.displayName.closest('label').after(label);
    }
  };
  ensureFields();

  const setAvatar = (container, avatarUrl, displayName) => {
    if (!container) return;
    container.replaceChildren();
    if (avatarUrl) {
      const image = document.createElement('img');
      image.src = avatarUrl;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      container.append(image);
    } else {
      container.textContent = String(displayName || 'AT').slice(0, 2).toUpperCase();
    }
  };

  const syncVisibleIdentity = driver => {
    const displayName = driver.display_name || 'ATX Driver';
    const name = profile.querySelector('[data-profile-name]');
    if (name) {
      delete name.dataset.fr;
      delete name.dataset.en;
      name.textContent = displayName;
    }
    setAvatar(profile.querySelector('[data-profile-avatar]'), driver.avatar_url, displayName);
    const header = document.querySelector('[data-header-profile]');
    if (header) {
      setAvatar(header.querySelector('span'), driver.avatar_url, displayName);
      const headerName = header.querySelector('strong');
      if (headerName) headerName.textContent = displayName;
    }
  };

  const paint = (driver = {}, meta = {}, owner = false) => {
    const country = String(driver.country_code || meta.country_code || '').trim().toUpperCase();
    const car = String(driver.car_number || meta.car_number || '').trim().toUpperCase();
    if (countryTop) {
      countryTop.hidden = !country;
      countryTop.textContent = country ? `${flag(country)} ${country}` : '';
    }
    if (carTop) {
      carTop.hidden = !car;
      carTop.textContent = car ? `#${car}` : '';
    }
    if (countryDetail) {
      countryDetail.textContent = country ? `${flag(country)} ${country}` : '';
      const row = countryDetail.closest('p'); if (row) row.hidden = !country;
    }
    if (carDetail) {
      carDetail.textContent = car ? `#${car}` : '';
      const row = carDetail.closest('p'); if (row) row.hidden = !car;
    }
    if (owner) {
      if (form.elements.countryCode) form.elements.countryCode.value = country;
      if (form.elements.carNumber) form.elements.carNumber.value = car;
      if (form.elements.displayName) form.elements.displayName.value = driver.display_name || '';
      syncVisibleIdentity(driver);
    }
  };

  const fmtLap = value => {
    const ms = Number(value); if (!Number.isFinite(ms) || ms <= 0) return '—';
    return `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2,'0')}.${String(Math.floor(ms % 1000)).padStart(3,'0')}`;
  };
  const fmtSector = value => {
    const ms = Number(value); if (!Number.isFinite(ms) || ms <= 0) return '—';
    return `${Math.floor(ms / 1000)}.${String(Math.floor(ms % 1000)).padStart(3,'0')}`;
  };
  const circuitLabel = key => ({
    barcelona:'Barcelona',brands_hatch:'Brands Hatch',cota:'Circuit of the Americas',donington:'Donington Park',hungaroring:'Hungaroring',imola:'Imola',indianapolis:'Indianapolis',kyalami:'Kyalami',laguna_seca:'Laguna Seca',misano:'Misano',monza:'Monza',mount_panorama:'Mount Panorama',nurburgring:'Nürburgring GP',nurburgring_24h:'Nürburgring 24h',oulton_park:'Oulton Park',paul_ricard:'Paul Ricard',red_bull_ring:'Red Bull Ring',silverstone:'Silverstone',snetterton:'Snetterton',spa:'Spa-Francorchamps',suzuka:'Suzuka',valencia:'Valencia',watkins_glen:'Watkins Glen',zandvoort:'Zandvoort',zolder:'Zolder'
  }[key] || String(key || '').replaceAll('_',' '));

  const renderTiming = async driverId => {
    const section = document.querySelector('[data-profile-best-laps-section]');
    const grid = document.querySelector('[data-profile-best-laps]');
    if (!section || !grid || !driverId) return;
    try {
      const response = await fetch(`${base}/public-driver-sectors`, { cache: 'no-store' });
      if (!response.ok) throw new Error('timing_unavailable');
      const data = await response.json();
      const rows = (data.sectors || []).filter(row => row.driver_id === driverId && Number(row.best_lap_ms) > 0)
        .sort((a,b) => circuitLabel(a.circuit_key).localeCompare(circuitLabel(b.circuit_key), 'fr'));
      grid.replaceChildren();
      rows.forEach(row => {
        const card = document.createElement('article');
        card.className = 'profile-pb-card';
        const title = document.createElement('div'); title.className = 'profile-pb-head';
        const circuit = document.createElement('strong'); circuit.textContent = circuitLabel(row.circuit_key);
        const session = document.createElement('span'); session.textContent = row.best_lap_session_type || 'ACC';
        title.append(circuit, session);
        const lap = document.createElement('b'); lap.className = 'profile-pb-lap'; lap.textContent = fmtLap(row.best_lap_ms);
        const sectors = document.createElement('div'); sectors.className = 'profile-pb-sectors';
        [['S1',row.best_sector_1_ms],['S2',row.best_sector_2_ms],['S3',row.best_sector_3_ms]].forEach(([label,value]) => {
          const item = document.createElement('span'); item.innerHTML = `<small>${label}</small><strong>${fmtSector(value)}</strong>`; sectors.append(item);
        });
        card.append(title, lap, sectors); grid.append(card);
      });
      section.hidden = rows.length === 0;
    } catch { section.hidden = true; }
  };

  const loadIdentities = async () => {
    try {
      const response = await fetch(`${base}/public-driver-identities`, { cache: 'no-store' });
      return response.ok ? (await response.json()).drivers || [] : [];
    } catch { return []; }
  };

  const load = async () => {
    const identities = await loadIdentities();
    if (isPublicProfile) {
      const meta = identities.find(x => x.driver_id === queryDriverId) || {};
      let driver = meta;
      try {
        const response = await fetch(`${base}/public-driver?driver=${encodeURIComponent(queryDriverId)}`, { cache: 'no-store' });
        if (response.ok) driver = (await response.json()).driver || meta;
      } catch {}
      paint(driver, meta, false);
      await renderTiming(queryDriverId);
      return;
    }

    const token = sessionStorage.getItem(sessionKey);
    if (!token) return;
    try {
      const response = await fetch(`${base}/auth-session`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) return;
      const auth = await response.json();
      const meta = identities.find(x => x.driver_id === auth.driver.id) || {};
      paint(auth.driver, meta, true);
      await renderTiming(auth.driver.id);
    } catch {}
  };

  form.addEventListener('submit', async () => {
    const token = sessionStorage.getItem(sessionKey), file = form.elements.avatarFile?.files?.[0];
    if (!token) return;
    const status = form.querySelector('[data-profile-form-status]');
    if (file && file.size) {
      if (file.size > 2 * 1024 * 1024) { if (status) status.textContent = 'La photo dépasse 2 Mo.'; return; }
      if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { if (status) status.textContent = 'Format photo non accepté.'; return; }
      try {
        const image = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(file); });
        const response = await fetch(`${base}/upload-driver-avatar`, { method:'POST', headers:{ Authorization:`Bearer ${token}`,'Content-Type':'application/json' }, body:JSON.stringify({image}) });
        if (!response.ok) throw new Error('upload_failed');
        const out = await response.json();
        if (out.avatar_url) syncVisibleIdentity({ display_name: form.elements.displayName?.value || 'ATX Driver', avatar_url: out.avatar_url });
      } catch { if (status) status.textContent = 'La photo n’a pas pu être enregistrée.'; }
    }
    setTimeout(load, 650);
  });

  load();
})();
