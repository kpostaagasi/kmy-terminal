// @ts-check
// Yolo (bypassPermissions) süre sınırı: sunucu tarafında zorunlu.
// Süresi dolmuş ya da hiç süre verilmemiş bypass isteği güvenli moda ('default') düşürülür.
export const YOLO_DEFAULT_MS = 30 * 60 * 1000; // varsayılan 30 dakika
export const YOLO_MAX_MS = 8 * 3600 * 1000; // en fazla 8 saat

/** @param {{permissionMode?: string, yoloUntil?: number}} settings */
export function yoloActive(settings, now = Date.now()) {
  return settings?.permissionMode === 'bypassPermissions' && Number(settings.yoloUntil) > now;
}

/** İstenen modu, ayarlardaki süreye göre etkin moda çevirir. @param {string|undefined} requested */
export function effectiveMode(requested, settings, now = Date.now()) {
  if (requested !== 'bypassPermissions') return requested;
  return yoloActive(settings, now) ? requested : 'default';
}

/** PUT /settings yamasını normalleştirir: bypass açılırken süre zorunlu ve üst sınırlı. */
export function normalizeYoloPatch(patch, now = Date.now()) {
  if (!patch || typeof patch !== 'object') return patch;
  const out = { ...patch };
  if (out.permissionMode === 'bypassPermissions') {
    const u = Number(out.yoloUntil);
    out.yoloUntil = !u || u <= now ? now + YOLO_DEFAULT_MS : Math.min(u, now + YOLO_MAX_MS);
  } else if ('permissionMode' in out) out.yoloUntil = 0;
  return out;
}
