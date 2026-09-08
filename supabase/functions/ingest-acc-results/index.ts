import { adminClient } from "../_shared/auth.ts";

type DriverPayload = {
  pilote: { steamId?: string | null; pseudo?: string | null };
  position?: number | null;
  tours?: number;
  meilleurTourMs?: number | null;
  secteurs?: Array<number | null>;
  tempsTotalMs?: number | null;
  modeleVoiture?: number | null;
  nomVoiture?: string | null;
  numeroVoiture?: number | null;
  groupeVoiture?: string | null;
  statut?: string;
};

type ImportPayload = {
  nomFichier: string;
  empreinte: string;
  circuit: string;
  typeSession: string;
  indexSession?: number | null;
  dateSession?: string | null;
  modeTest?: boolean;
  pisteMouillee?: boolean;
  nomServeur?: string | null;
  cleCourse?: string | null;
  debutCourse?: string | null;
  resultats: DriverPayload[];
  tours?: Array<{
    steamId?: string | null;
    numeroTour: number;
    tempsMs?: number | null;
    valide?: boolean;
    secteurs?: Array<number | null>;
  }>;
  penalites?: Array<{
    steamId?: string | null;
    raison?: string | null;
    type?: string | null;
    valeur?: number | null;
    tourViolation?: number | null;
    tourAcquittee?: number | null;
    apresCourse?: boolean;
  }>;
};

const PROCESSOR_VERSION = "acc-v2";

type EventRow = {
  id: string;
  slug: string;
  title_fr: string;
  title_en: string;
  [key: string]: unknown;
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.details, record.hint, record.code]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => String(value).trim());
    if (parts.length) return [...new Set(parts)].join(" · ");
    try {
      const serialized = JSON.stringify(record);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Fall through to the generic message.
    }
  }
  return String(error || "Unknown import error");
};

const sha256 = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const safeSecretMatch = async (actual: string, expected: string): Promise<boolean> => {
  const [actualHash, expectedHash] = await Promise.all([sha256(actual), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
};

const circuitKey = (value: string): string => {
  const normalized = value
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "circuit_inconnu";
  const aliases: Record<string, string> = {
    nurburgring_gp: "nurburgring",
    spa_francorchamps: "spa",
    circuit_of_the_americas: "cota",
  };
  return aliases[normalized] ?? normalized;
};

const slugPart = (value: string): string => value
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const statusFromAcc = (value?: string): "classified" | "dnf" | "dns" | "dsq" => {
  if (value === "disqualifie") return "dsq";
  if (value === "non_classe") return "dns";
  return "classified";
};

const pointsForPosition = (position?: number | null): number => {
  const points = [100, 75, 50, 25, 20, 15, 10, 5];
  return position && position >= 1 ? points[position - 1] ?? 0 : 0;
};

const positiveOrNull = (value?: number | null): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
};

const performanceClass = (score: number): "alien" | "elite" | "pro" | "rookie" => {
  if (score <= 101.99) return "alien";
  if (score <= 103.99) return "elite";
  if (score <= 105.99) return "pro";
  return "rookie";
};

const safetyClass = (score: number): "bronze" | "silver" | "gold" => {
  if (score <= 33) return "bronze";
  if (score < 70) return "silver";
  return "gold";
};

const cleanStreak = (laps: Array<{ valide?: boolean }>): number => {
  let current = 0;
  let maximum = 0;
  for (const lap of laps) {
    current = lap.valide === false ? 0 : current + 1;
    maximum = Math.max(maximum, current);
  }
  return maximum;
};

const resolveDriver = async (steamId: string, displayName: string): Promise<string> => {
  const supabase = adminClient();
  const { data: identity, error: identityError } = await supabase.from("driver_identities")
    .select("driver_id").eq("steam_id64", steamId).maybeSingle();
  if (identityError) throw identityError;
  if (identity?.driver_id) {
    const { data: driver } = await supabase.from("drivers")
      .select("display_name").eq("id", identity.driver_id).single();
    if (driver?.display_name === "Steam Driver") {
      await supabase.from("drivers").update({ display_name: displayName }).eq("id", identity.driver_id);
    }
    return identity.driver_id;
  }

  const { data: driver, error: driverError } = await supabase.from("drivers")
    .insert({ display_name: displayName }).select("id").single();
  if (driverError) throw driverError;
  const { error: newIdentityError } = await supabase.from("driver_identities").insert({
    driver_id: driver.id,
    steam_id64: steamId,
  });
  if (newIdentityError) throw newIdentityError;
  await supabase.from("driver_roles").insert({ driver_id: driver.id, role: "driver" });
  return driver.id;
};

const resolveEvent = async (payload: ImportPayload): Promise<EventRow> => {
  const supabase = adminClient();
  const date = payload.dateSession && /^\d{4}-\d{2}-\d{2}$/.test(payload.dateSession)
    ? payload.dateSession
    : new Date().toISOString().slice(0, 10);
  const key = circuitKey(payload.circuit);
  const sourceEventKey = payload.cleCourse?.trim() ?? "";
  if (sourceEventKey && !/^[a-z0-9][a-z0-9_-]{7,119}$/.test(sourceEventKey)) {
    throw new Error("Invalid ACC race key");
  }
  if (sourceEventKey) {
    const { data: byKey, error: keyError } = await supabase.from("events").select("*")
      .eq("source_event_key", sourceEventKey).maybeSingle();
    if (keyError) throw keyError;
    if (byKey) return byKey as EventRow;
  }
  const nextDate = new Date(`${date}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const { data: sameDay, error } = await supabase.from("events").select("*")
    .eq("circuit_key", key)
    .gte("starts_at", `${date}T00:00:00Z`)
    .lt("starts_at", nextDate.toISOString())
    .order("starts_at", { ascending: true });
  if (error) throw error;
  const existing = sourceEventKey
    ? (sameDay ?? []).find((event) => !event.source_event_key && event.status !== "completed")
    : (sameDay ?? [])[0];
  if (existing) {
    const serverName = payload.nomServeur?.trim().slice(0, 160);
    const startsAt = payload.debutCourse && !Number.isNaN(Date.parse(payload.debutCourse))
      ? new Date(payload.debutCourse).toISOString()
      : existing.starts_at;
    if ((serverName && (
      existing.server_name !== serverName
      || existing.title_fr !== serverName
      || existing.title_en !== serverName
    )) || (sourceEventKey && existing.source_event_key !== sourceEventKey)) {
      const { data: updated, error: updateError } = await supabase.from("events").update({
        server_name: serverName,
        title_fr: serverName || existing.title_fr,
        title_en: serverName || existing.title_en,
        starts_at: startsAt,
        source_event_key: sourceEventKey || null,
      }).eq("id", existing.id).select("*").single();
      if (updateError) throw updateError;
      return updated as EventRow;
    }
    return existing as EventRow;
  }

  const serverName = payload.nomServeur?.trim().slice(0, 160);
  const baseTitle = serverName || `ATX Racing · ${payload.circuit}`;
  const slugSuffix = sourceEventKey ? slugPart(sourceEventKey).slice(-24) : payload.empreinte.slice(0, 8);
  const slug = `${date}-${slugPart(payload.circuit)}-${slugSuffix}`;
  const startsAt = payload.debutCourse && !Number.isNaN(Date.parse(payload.debutCourse))
    ? new Date(payload.debutCourse).toISOString()
    : `${date}T20:30:00+02:00`;
  const { data: created, error: createError } = await supabase.from("events").insert({
    slug,
    event_type: "special_event",
    status: payload.typeSession === "R" ? "completed" : "announced",
    title_fr: baseTitle,
    title_en: baseTitle,
    game: "Assetto Corsa Competizione",
    circuit_name: payload.circuit,
    circuit_key: key,
    starts_at: startsAt,
    timezone: "Europe/Brussels",
    duration_minutes: 60,
    max_drivers: 22,
    server_name: serverName || null,
    source_event_key: sourceEventKey || null,
    is_public: true,
    is_official: !payload.modeTest,
    published_at: new Date().toISOString(),
  }).select("*").single();
  if (createError) throw createError;
  return created as EventRow;
};

const ingest = async (payload: ImportPayload, rawJson: string) => {
  const supabase = adminClient();
  if (!payload || !Array.isArray(payload.resultats) || !payload.nomFichier) {
    throw new Error("Invalid normalized ACC payload");
  }
  if (!/^[a-f0-9]{64}$/.test(payload.empreinte) || await sha256(rawJson) !== payload.empreinte) {
    throw new Error("ACC payload checksum mismatch");
  }

  const { data: previous } = await supabase.from("ingestion_batches")
    .select("id, status, processor_version").eq("payload_checksum", payload.empreinte).maybeSingle();
  if (previous?.status === "processed" && previous.processor_version === PROCESSOR_VERSION) {
    return { duplicate: true, batch_id: previous.id };
  }

  let batchId = previous?.id as string | undefined;
  if (!batchId) {
    const { data: batch, error } = await supabase.from("ingestion_batches").insert({
      source: "atx-racing-collector",
      external_reference: payload.nomFichier,
      payload_checksum: payload.empreinte,
      processor_version: PROCESSOR_VERSION,
      status: "pending",
    }).select("id").single();
    if (error) throw error;
    batchId = batch.id;
  } else {
    await supabase.from("ingestion_batches").update({
      status: "pending",
      processor_version: PROCESSOR_VERSION,
      error_summary: null,
    }).eq("id", batchId);
  }

  try {
    const event = await resolveEvent(payload);
    const storagePath = `${payload.dateSession || "unknown-date"}/${payload.empreinte}-${slugPart(payload.nomFichier) || "result"}.json`;
    const { error: storageError } = await supabase.storage.from("acc-results").upload(
      storagePath,
      new Blob([rawJson], { type: "application/json" }),
      { contentType: "application/json", upsert: false },
    );
    if (storageError && !storageError.message.toLowerCase().includes("already exists")) throw storageError;

    const { data: session, error: sessionError } = await supabase.from("acc_sessions").upsert({
      event_id: event.id,
      payload_checksum: payload.empreinte,
      source_file: payload.nomFichier,
      session_type: ["FP", "Q", "R"].includes(payload.typeSession) ? payload.typeSession : "INCONNU",
      session_index: payload.indexSession ?? null,
      session_date: payload.dateSession ?? null,
      is_wet: Boolean(payload.pisteMouillee),
      server_name: payload.nomServeur ?? null,
      raw_storage_path: storagePath,
      published_at: new Date().toISOString(),
    }, { onConflict: "payload_checksum" }).select("id").single();
    if (sessionError) throw sessionError;

    const driverIds = new Map<string, string>();
    let rejected = 0;
    for (const result of payload.resultats) {
      const steamId = result.pilote?.steamId?.trim() ?? "";
      if (!/^\d{17}$/.test(steamId)) {
        rejected += 1;
        continue;
      }
      const displayName = (result.pilote.pseudo || "ACC Driver").trim().slice(0, 64);
      const driverId = await resolveDriver(steamId, displayName);
      driverIds.set(steamId, driverId);
      const values = {
        session_id: session.id,
        driver_id: driverId,
        position: result.position ?? null,
        laps_completed: result.tours ?? 0,
        best_lap_ms: positiveOrNull(result.meilleurTourMs),
        best_split_1_ms: result.secteurs?.[0] ?? null,
        best_split_2_ms: result.secteurs?.[1] ?? null,
        best_split_3_ms: result.secteurs?.[2] ?? null,
        total_time_ms: positiveOrNull(result.tempsTotalMs),
        car_model_id: result.modeleVoiture ?? null,
        car_model_name: result.nomVoiture ?? null,
        race_number: result.numeroVoiture ?? null,
        car_group: result.groupeVoiture ?? null,
        status: statusFromAcc(result.statut),
      };
      const { error } = await supabase.from("acc_session_results").upsert(values, {
        onConflict: "session_id,driver_id",
      });
      if (error) throw error;
    }

    const lapRows = (payload.tours ?? []).flatMap((lap) => {
      const driverId = lap.steamId ? driverIds.get(lap.steamId) : null;
      return driverId ? [{
        session_id: session.id,
        driver_id: driverId,
        lap_number: lap.numeroTour,
        lap_time_ms: lap.tempsMs ?? null,
        is_valid: lap.valide !== false,
        split_1_ms: lap.secteurs?.[0] ?? null,
        split_2_ms: lap.secteurs?.[1] ?? null,
        split_3_ms: lap.secteurs?.[2] ?? null,
      }] : [];
    });
    if (lapRows.length) {
      const { error } = await supabase.from("acc_laps").upsert(lapRows, {
        onConflict: "session_id,driver_id,lap_number",
      });
      if (error) throw error;
    }

    const penaltyRows = (payload.penalites ?? []).flatMap((penalty) => {
      const driverId = penalty.steamId ? driverIds.get(penalty.steamId) : null;
      return driverId ? [{
        session_id: session.id,
        driver_id: driverId,
        reason: penalty.raison ?? null,
        penalty_code: penalty.type ?? null,
        penalty_value: penalty.valeur ?? null,
        violation_lap: penalty.tourViolation ?? null,
        cleared_lap: penalty.tourAcquittee ?? null,
        is_post_race: Boolean(penalty.apresCourse),
      }] : [];
    });
    if (penaltyRows.length) {
      await supabase.from("acc_game_penalties").delete().eq("session_id", session.id);
      const { error } = await supabase.from("acc_game_penalties").insert(penaltyRows);
      if (error) throw error;
    }

    if (payload.typeSession === "R") {
      const { error: clearResultsError } = await supabase.from("results").delete().eq("event_id", event.id);
      if (clearResultsError) throw clearResultsError;
      const { error: clearSafetyError } = await supabase.from("safety_stats").delete().eq("event_id", event.id);
      if (clearSafetyError) throw clearSafetyError;

      const { data: qualifyingSession } = await supabase.from("acc_sessions").select("id")
        .eq("event_id", event.id).eq("session_type", "Q")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const qualifyingPositions = new Map<string, number>();
      if (qualifyingSession?.id) {
        const { data: qualifying } = await supabase.from("acc_session_results")
          .select("driver_id, position").eq("session_id", qualifyingSession.id);
        for (const row of qualifying ?? []) {
          if (typeof row.position === "number") qualifyingPositions.set(row.driver_id, row.position);
        }
      }

      for (const result of payload.resultats) {
        const steamId = result.pilote?.steamId ?? "";
        const driverId = driverIds.get(steamId);
        if (!driverId) continue;
        const classified = statusFromAcc(result.statut) === "classified";
        const { error } = await supabase.from("results").upsert({
          event_id: event.id,
          driver_id: driverId,
          status: statusFromAcc(result.statut),
          qualifying_position: qualifyingPositions.get(driverId) ?? null,
          start_position: qualifyingPositions.get(driverId) ?? null,
          finish_position: result.position ?? null,
          laps_completed: result.tours ?? 0,
          best_lap_ms: positiveOrNull(result.meilleurTourMs),
          total_time_ms: positiveOrNull(result.tempsTotalMs),
          points: classified ? pointsForPosition(result.position) : 0,
          imported_at: new Date().toISOString(),
          car_model_id: result.modeleVoiture ?? null,
          car_model_name: result.nomVoiture ?? null,
          race_number: result.numeroVoiture ?? null,
          best_split_1_ms: result.secteurs?.[0] ?? null,
          best_split_2_ms: result.secteurs?.[1] ?? null,
          best_split_3_ms: result.secteurs?.[2] ?? null,
        }, { onConflict: "event_id,driver_id" });
        if (error) throw error;

        const driverLaps = (payload.tours ?? []).filter((lap) => lap.steamId === steamId);
        const validLaps = driverLaps.filter((lap) => lap.valide !== false).length;
        const invalidLaps = driverLaps.length - validLaps;
        const driverPenalties = (payload.penalites ?? []).filter((penalty) => penalty.steamId === steamId);
        const cuts = driverPenalties.filter((penalty) => /cut/i.test(penalty.raison ?? "")).length;
        const { error: safetyError } = await supabase.from("safety_stats").upsert({
          event_id: event.id,
          driver_id: driverId,
          valid_laps: validLaps,
          invalid_laps: invalidLaps,
          cuts,
          game_penalties: driverPenalties.length,
          drive_throughs: driverPenalties.filter((penalty) => /drive.?through/i.test(penalty.type ?? "")).length,
          stop_and_go_penalties: driverPenalties.filter((penalty) => /stop.?and.?go/i.test(penalty.type ?? "")).length,
          clean_lap_streak: cleanStreak(driverLaps),
        }, { onConflict: "event_id,driver_id" });
        if (safetyError) throw safetyError;
      }

      const timedResults = payload.resultats.filter((result) => result.meilleurTourMs && result.pilote?.steamId);
      const reference = Math.min(...timedResults.map((result) => Number(result.meilleurTourMs)));
      if (Number.isFinite(reference)) {
        for (const result of timedResults) {
          const driverId = driverIds.get(result.pilote.steamId ?? "");
          if (!driverId) continue;
          const score = Number(((Number(result.meilleurTourMs) / reference) * 100).toFixed(3));
          const driverLaps = (payload.tours ?? []).filter((lap) => lap.steamId === result.pilote.steamId);
          const valid = driverLaps.filter((lap) => lap.valide !== false).length;
          const safeScore = driverLaps.length ? Number(((valid / driverLaps.length) * 100).toFixed(3)) : 0;
          const rating = {
            driver_id: driverId,
            performance_class: performanceClass(score),
            performance_score: score,
            safety_class: safetyClass(safeScore),
            safety_score: safeScore,
            algorithm_version: "acc-v1",
            calculated_at: new Date().toISOString(),
          };
          const { error } = await supabase.from("driver_ratings").upsert({
            ...rating,
            circuit_key: circuitKey(payload.circuit),
          }, { onConflict: "driver_id,circuit_key" });
          if (error) throw error;
          await supabase.from("driver_ratings").upsert({ ...rating, circuit_key: "overall" }, {
            onConflict: "driver_id,circuit_key",
          });
        }
      }

      await supabase.from("events").update({
        status: "completed",
        is_public: true,
        published_at: new Date().toISOString(),
      }).eq("id", event.id);
    }

    await supabase.from("ingestion_batches").update({
      status: "processed",
      imported_events: 1,
      imported_results: driverIds.size,
      rejected_records: rejected,
      processed_at: new Date().toISOString(),
    }).eq("id", batchId);

    return {
      duplicate: false,
      batch_id: batchId,
      event_slug: event.slug,
      event_title: event.title_fr,
      session_type: payload.typeSession,
      imported_drivers: driverIds.size,
      rejected_drivers: rejected,
    };
  } catch (error) {
    await supabase.from("ingestion_batches").update({
      status: "failed",
      error_summary: errorMessage(error).slice(0, 500),
      processed_at: new Date().toISOString(),
    }).eq("id", batchId);
    throw error;
  }
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const expectedSecret = Deno.env.get("ATX_INGESTION_SECRET") ?? "";
  const providedSecret = request.headers.get("x-atx-ingestion-secret") ?? "";
  if (!expectedSecret || !await safeSecretMatch(providedSecret, expectedSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const body = await request.json();
    if (typeof body.rawJson !== "string" || body.rawJson.length > 15_000_000) {
      return json({ error: "invalid_raw_json" }, 400);
    }
    return json(await ingest(body.importation, body.rawJson));
  } catch (error) {
    const detail = errorMessage(error).slice(0, 500);
    console.error("ACC ingestion failed", detail);
    return json({
      error: "ingestion_failed",
      detail,
    }, 500);
  }
});
