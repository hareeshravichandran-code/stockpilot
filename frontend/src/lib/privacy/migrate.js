import { privacyAPI } from '../api';
import { sealTxn, sealRule } from './vault';

/** Encrypts this account's existing readable data, a page at a time. onProgress(done) */
export async function migrateAll(onProgress = () => {}) {
  let done = 0;
  for (const table of ['transactions', 'rules']) {
    for (let guard = 0; guard < 200; guard++) {
      const { data } = await privacyAPI.plain(table);
      const rows = data.rows || [];
      if (!rows.length) break;
      const sealed = await Promise.all(rows.map(r => (table === 'rules' ? sealRule(r) : sealTxn(r))));
      const { data: res } = await privacyAPI.encrypted(table, sealed);
      done += res.done || 0;
      onProgress(done);
      if (!res.done) break;          // nothing could be saved: stop rather than loop
    }
  }
  await privacyAPI.migrated();
  return done;
}
