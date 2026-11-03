import { emptyState, validateState } from './model.js';

export const samePayload = (a, b) => JSON.stringify(validateState(a)) === JSON.stringify(validateState(b));
export const sameIdentity = (a, b) => Boolean(a && b && a.projectUrl === b.projectUrl && a.userId === b.userId);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const MISSING = Symbol('missing');
const isBlank = payload => samePayload(payload, emptyState());

/** Three-way merge. Missing months are deletions only when a shared base exists. */
export function mergeArchives(baseInput, localInput, remoteInput, preference = null) {
  const local = validateState(localInput), remote = validateState(remoteInput);
  const base = baseInput ? validateState(baseInput) : null;
  if (!base && isBlank(local)) return { payload: remote, conflicts: [] };
  if (!base && isBlank(remote)) return { payload: local, conflicts: [] };
  const conflicts = [];
  function pick(path, baseline, left, right) {
    if (same(left, right)) return left;
    if (baseline !== MISSING) {
      if (same(left, baseline)) return right;
      if (same(right, baseline)) return left;
    }
    conflicts.push({ path, local: left === MISSING ? null : left, remote: right === MISSING ? null : right });
    return preference === 'remote' ? right : left;
  }
  let settings = {};
  if ([base, local, remote].some(archive => archive && (archive.settings.targetCents === null || archive.settings.goalChosen === true))) settings = pick('settings', base ? base.settings : MISSING, local.settings, remote.settings);
  else for (const field of ['targetCents', 'deadline']) settings[field] = pick(`settings.${field}`, base ? base.settings[field] : MISSING, local.settings[field], remote.settings[field]);
  const maps = [base?.entries || [], local.entries, remote.entries].map(entries => new Map(entries.map(entry => [entry.month, entry])));
  const months = [...new Set([...maps[0].keys(), ...maps[1].keys(), ...maps[2].keys()])].sort();
  const entries = [];
  for (const month of months) {
    const baseline = maps[0].get(month), left = maps[1].get(month), right = maps[2].get(month);
    if (same(left, right)) { if (left) entries.push(left); continue; }
    if (base && same(left, baseline)) { if (right) entries.push(right); continue; }
    if (base && same(right, baseline)) { if (left) entries.push(left); continue; }
    if (!base && !left) { entries.push(right); continue; }
    if (!base && !right) { entries.push(left); continue; }
    if (!left || !right) {
      const selected = pick(`entries.${month}`, baseline ?? MISSING, left ?? MISSING, right ?? MISSING);
      if (selected !== MISSING) entries.push(selected);
      continue;
    }
    const entry = { month };
    for (const field of ['balanceCents', 'note']) entry[field] = pick(`entries.${month}.${field}`, baseline ? baseline[field] : MISSING, left[field], right[field]);
    entries.push(entry);
  }
  return { payload: validateState({ schemaVersion: 2, settings, entries }), conflicts };
}
export function conflictFingerprint(local, remote, version) {
  return JSON.stringify([validateState(local), validateState(remote), version]);
}
