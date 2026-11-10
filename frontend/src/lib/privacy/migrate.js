import { privacyAPI } from '../api';
import { sealTxn, sealRule } from './vault';
import { sealFields } from './fields';

// Bumped when more fields become encrypted: accounts on an older version run the catch-up once more
export const MIGRATION_V = 2;

/** Encrypts this account's existing readable data, table by table, a page at a time. onProgress(done) */
export async function migrateAll(onProgress = () => {}) {
  let done = 0;
  const { data: t } = await privacyAPI.tables();
  for (const table of t.order) {
    const spec = t.spec[table];
    for (let guard = 0; guard < 200; guard++) {
      const { data } = await privacyAPI.plain(table);
      const rows = data.rows || [];
      if (!rows.length) break;
      const sealed = await Promise.all(rows.map(r => (table === 'rules' ? sealRule(r) : table === 'transactions' ? sealTxn(r)
        : sealFields(r, { text: spec.text, ref: spec.ref, date: spec.date, sig: spec.signals ? spec.text[0] : null }))));
      const { data: res } = await privacyAPI.encrypted(table, sealed);
      done += res.done || 0;
      onProgress(done);
      if (!res.done) break;          // nothing could be saved: stop rather than loop
    }
  }
  await privacyAPI.migrated(MIGRATION_V);
  return done;
}
