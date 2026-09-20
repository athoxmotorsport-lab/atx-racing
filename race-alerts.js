(() => {
  "use strict";
  const base = "https://twjpjzalyvbsdpbzhqln.supabase.co/functions/v1/public-event";
  const prefix = location.pathname.includes("/events/") ? "../" : "";
  const actions = document.querySelector(".utility-actions");
  if (!actions) return;
  const label = (fr, en) => document.documentElement.lang === "en" ? en : fr;
  const parts = value => {
    const fields = new Intl.DateTimeFormat("en-GB", {year:"numeric",month:"2-digit",day:"2-digit",timeZone:"Europe/Brussels"}).formatToParts(new Date(value));
    const part = type => fields.find(field => field.type === type)?.value || "";
    return [part("year"),part("month"),part("day")].join("-");
  };
  const startOf = event => Date.parse(event.starts_at || "");
  const eventKey = event => parts(startOf(event)) + ":" + event.slug;
  const detailsHref = event => prefix + "course.html?event=" + encodeURIComponent(event.slug);
  const timeLabel = event => new Intl.DateTimeFormat(
    document.documentElement.lang === "en" ? "en-GB" : "fr-BE",
    {timeZone:"Europe/Brussels",hour:"2-digit",minute:"2-digit"}
  ).format(new Date(startOf(event)));
  const name = event => (document.documentElement.lang === "en" ? event.title_en || event.title_fr : event.title_fr || event.title_en) || event.circuit_name || "ATX Racing";
  const read = (storage, key) => { try { return JSON.parse(storage.getItem(key) || "{}"); } catch { return {}; } };
  const SEEN = "atx-race-notifications-seen-v1";
  const DISMISSED = "atx-race-popup-seen-v1";
  const bell = document.createElement("button");
  bell.className = "atx-alert-bell";
  bell.type = "button";
  bell.setAttribute("aria-haspopup", "true");
  bell.setAttribute("aria-expanded", "false");
  bell.innerHTML = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg><span class="atx-alert-count" hidden></span>';
  const count = bell.querySelector(".atx-alert-count");
  const panel = document.createElement("section");
  panel.className = "atx-alert-panel";
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", label("Notifications des courses", "Race notifications"));
  actions.insertBefore(bell, actions.querySelector(".side-tools") || null);
  actions.append(panel);
  let today = [];
  let loaded = false;
  const unread = () => today.filter(event => !read(localStorage, SEEN)[eventKey(event)]).length;
  const renderCount = () => {
    const number = unread();
    count.hidden = number === 0;
    count.textContent = number > 9 ? "9+" : String(number);
    bell.setAttribute("aria-label", label("Notifications : " + number + " non lue(s)", "Notifications: " + number + " unread"));
  };
  const markSeen = () => {
    const seen = read(localStorage, SEEN);
    today.forEach(event => { seen[eventKey(event)] = true; });
    try { localStorage.setItem(SEEN, JSON.stringify(seen)); } catch { /* private mode */ }
    renderCount();
  };
  const renderPanel = () => {
    panel.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = label("Notifications", "Notifications");
    panel.append(heading);
    if (!loaded || !today.length) {
      const p = document.createElement("p");
      p.textContent = loaded ? label("Aucune course annoncée aujourd’hui.", "No race announced today.") : label("Chargement…", "Loading…");
      panel.append(p);
      return;
    }
    today.slice(0,20).forEach(event => {
      const link = document.createElement("a");
      link.href = detailsHref(event);
      link.className = "atx-alert-item";
      const title = document.createElement("strong");
      title.textContent = label("Course aujourd’hui · ", "Race today · ") + name(event);
      const meta = document.createElement("span");
      meta.textContent = (event.circuit_name || "ACC") + " · " + timeLabel(event) + label(" (heure belge)", " (Belgium time)");
      link.append(title,meta);
      panel.append(link);
    });
  };
  bell.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    bell.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) { markSeen(); renderPanel(); }
  });
  document.addEventListener("click", event => {
    if (!panel.hidden && !panel.contains(event.target) && !bell.contains(event.target)) {
      panel.hidden = true; bell.setAttribute("aria-expanded","false");
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) { panel.hidden = true; bell.setAttribute("aria-expanded","false"); bell.focus(); }
  });
  const popup = event => {
    if (read(sessionStorage, DISMISSED)[eventKey(event)]) return;
    const overlay = document.createElement("div");
    overlay.className = "atx-race-overlay";
    const dialog = document.createElement("section");
    dialog.className = "atx-race-popup";
    dialog.setAttribute("role","dialog");
    dialog.setAttribute("aria-modal","true");
    dialog.setAttribute("aria-labelledby","atx-race-popup-title");
    const close = document.createElement("button");
    close.className = "atx-race-close"; close.type = "button"; close.textContent = "×";
    close.setAttribute("aria-label", label("Fermer", "Close"));
    const caption = document.createElement("span");
    caption.className = "atx-race-caption";
    caption.textContent = label("ATX RACING · COURSE AUJOURD’HUI", "ATX RACING · RACE TODAY");
    const title = document.createElement("h2");
    title.id = "atx-race-popup-title"; title.textContent = name(event);
    const description = document.createElement("p");
    description.textContent = (event.circuit_name || "ACC") + " · " + timeLabel(event) + label(" (heure belge)", " (Belgium time)");
    const actions = document.createElement("div");
    actions.className = "atx-race-buttons";
    const detail = document.createElement("a");
    detail.href = detailsHref(event); detail.textContent = label("Voir la course", "View race");
    const later = document.createElement("button");
    later.type = "button"; later.textContent = label("Plus tard", "Later");
    actions.append(detail,later); dialog.append(close,caption,title,description,actions);
    overlay.append(dialog); document.body.append(overlay);
    const before = document.activeElement;
    const finish = () => {
      const dismissed = read(sessionStorage, DISMISSED);
      dismissed[eventKey(event)] = true;
      try { sessionStorage.setItem(DISMISSED, JSON.stringify(dismissed)); } catch { /* private mode */ }
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      if (before && before.isConnected && typeof before.focus === "function") before.focus();
    };
    const onKey = key => { if (key.key === "Escape") finish(); };
    close.addEventListener("click", finish);
    later.addEventListener("click", finish);
    detail.addEventListener("click", finish);
    overlay.addEventListener("click", click => { if (click.target === overlay) finish(); });
    document.addEventListener("keydown", onKey);
    close.focus();
  };
  const refresh = async () => {
    try {
      const response = await fetch(base, {cache:"no-store"});
      if (!response.ok) throw new Error("calendar_unavailable");
      const data = await response.json();
      const now = Date.now();
      const visible = [...(data.today || []),...(data.events || [])].filter(event => {
        const start = startOf(event);
        return event && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.slug || "")
          && event.status !== "cancelled" && event.status !== "draft" && event.simgrid_url
          && Number.isFinite(start) && parts(start) === parts(now)
          && now < start + (Math.max(60, Number(event.duration_minutes) || 60) + 120) * 60000;
      });
      today = [...new Map(visible.map(event => [event.slug,event])).values()].sort((a,b) => startOf(a) - startOf(b));
      loaded = true; renderCount();
      if (!panel.hidden) renderPanel();
      if (today.length) popup(today[0]);
    } catch {
      loaded = true;
      if (!panel.hidden) renderPanel();
    }
  };
  refresh();
  setInterval(refresh, 60000);
})();