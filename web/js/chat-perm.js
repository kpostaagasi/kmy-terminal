// Sohbetin giden izin kipi. /plan ve seçici buradan geçer; send başka yerden kip uydurmaz.
let mode = 'default';
const MODES = { default: 'default', acceptedits: 'acceptEdits', plan: 'plan', bypasspermissions: 'bypassPermissions' };

export function chatPermMode() { return mode; }

export function selectChatPerm(choice) {
  const key = String(choice || '').trim().toLowerCase().replace(/^\//, '');
  if (MODES[key]) mode = MODES[key];
  return mode;
}
