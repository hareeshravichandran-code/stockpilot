/**
 * StockPilot Sync Logger
 * Every email parse attempt — success or failure — gets logged here.
 * 
 * Two outputs:
 *   1. Railway console  (structured JSON, visible in Railway dashboard)
 *   2. Supabase         (sync_sessions + sync_logs tables, visible in Admin panel)
 */

const supabase = require('./supabase');

class SyncLogger {
  constructor(userId) {
    this.userId    = userId;
    this.sessionId = null;
    this.counts    = { scanned: 0, parsed: 0, failed: 0, holdings: 0 };
    this.startedAt = new Date();
  }

  // ── Start a new sync session ──────────────────────────────────────
  async startSession() {
    try {
      const { data, error } = await supabase
        .from('sync_sessions')
        .insert({
          user_id:    this.userId,
          started_at: this.startedAt.toISOString(),
          status:     'running'
        })
        .select('id')
        .single();

      if (error) throw error;
      this.sessionId = data.id;
      this._console('SESSION_START', `Session ${this.sessionId} started`);
    } catch (e) {
      // Don't crash the sync if logging fails
      this._console('SESSION_START_ERROR', e.message);
      this.sessionId = null;
    }
    return this.sessionId;
  }

  // ── Log a successful email parse ──────────────────────────────────
  async logSuccess(opts = {}) {
    this.counts.scanned++;
    this.counts.parsed++;
    if (opts.itemsFound) this.counts.holdings += opts.itemsFound;

    const entry = {
      phase:              opts.phase        || 'cas',
      status:             'success',
      email_id:           opts.emailId      || null,
      email_subject:      opts.subject      || null,
      email_from:         opts.from         || null,
      email_date:         opts.date         || null,
      has_pdf:            opts.hasPdf       || false,
      pdf_filename:       opts.pdfFilename  || null,
      pdf_password_tried: opts.passwordTried|| null,
      pdf_unlocked:       opts.pdfUnlocked  || false,
      items_found:        opts.itemsFound   || 0,
      parsed_data:        opts.parsedData   ? JSON.stringify(opts.parsedData.slice(0, 3)) : null,
      raw_text_snippet:   opts.rawText      ? opts.rawText.slice(0, 500) : null,
    };

    this._console('PARSE_SUCCESS', `[${opts.phase}] ${opts.subject} → ${opts.itemsFound || 0} items`, entry);
    await this._writeLog(entry);
  }

  // ── Log a failed email parse ──────────────────────────────────────
  async logFailure(opts = {}) {
    this.counts.scanned++;
    this.counts.failed++;

    const entry = {
      phase:              opts.phase        || 'cas',
      status:             opts.status       || 'failed',
      email_id:           opts.emailId      || null,
      email_subject:      opts.subject      || null,
      email_from:         opts.from         || null,
      email_date:         opts.date         || null,
      has_pdf:            opts.hasPdf       || false,
      pdf_filename:       opts.pdfFilename  || null,
      pdf_password_tried: opts.passwordTried|| null,
      pdf_unlocked:       opts.pdfUnlocked  !== undefined ? opts.pdfUnlocked : null,
      items_found:        0,
      error_type:         opts.errorType    || 'PARSE_FAILED',
      error_message:      opts.errorMessage || 'Unknown error',
      error_stack:        opts.errorStack   || null,
      raw_text_snippet:   opts.rawText      ? opts.rawText.slice(0, 500) : null,
    };

    // Always log failures prominently to Railway
    this._console('PARSE_FAILURE', `[${opts.phase}] ${opts.subject} → ${opts.errorType}: ${opts.errorMessage}`, entry, 'error');
    await this._writeLog(entry);
  }

  // ── Log skipped email (no relevant content) ───────────────────────
  async logSkipped(opts = {}) {
    this.counts.scanned++;

    const entry = {
      phase:         opts.phase   || 'cas',
      status:        'skipped',
      email_id:      opts.emailId || null,
      email_subject: opts.subject || null,
      email_from:    opts.from    || null,
      email_date:    opts.date    || null,
      error_type:    opts.reason  || 'NO_CONTENT',
      error_message: opts.detail  || 'Email skipped — no relevant content found',
    };

    this._console('PARSE_SKIPPED', `[${opts.phase}] ${opts.subject} → ${opts.reason}`, entry);
    await this._writeLog(entry);
  }

  // ── Finish the session ────────────────────────────────────────────
  async finishSession(summary = {}) {
    const finalSummary = { ...summary, counts: this.counts };

    this._console('SESSION_END', `Session complete — scanned:${this.counts.scanned} parsed:${this.counts.parsed} failed:${this.counts.failed} holdings:${this.counts.holdings}`);

    if (!this.sessionId) return;

    try {
      await supabase.from('sync_sessions').update({
        finished_at:    new Date().toISOString(),
        status:         this.counts.failed > 0 && this.counts.parsed === 0 ? 'failed' : 'completed',
        emails_scanned: this.counts.scanned,
        emails_parsed:  this.counts.parsed,
        emails_failed:  this.counts.failed,
        holdings_found: this.counts.holdings,
        summary:        finalSummary,
      }).eq('id', this.sessionId);
    } catch (e) {
      this._console('SESSION_END_ERROR', e.message, null, 'error');
    }
  }

  // ── Mark session as crashed ───────────────────────────────────────
  async failSession(error) {
    this._console('SESSION_CRASHED', error.message, { stack: error.stack }, 'error');
    if (!this.sessionId) return;

    try {
      await supabase.from('sync_sessions').update({
        finished_at:   new Date().toISOString(),
        status:        'failed',
        error_message: error.message,
      }).eq('id', this.sessionId);
    } catch (e) {
      this._console('SESSION_FAIL_ERROR', e.message, null, 'error');
    }
  }

  // ── Internal: write a single log row to Supabase ─────────────────
  async _writeLog(entry) {
    if (!this.sessionId) return;
    try {
      await supabase.from('sync_logs').insert({
        ...entry,
        session_id: this.sessionId,
        user_id:    this.userId,
        logged_at:  new Date().toISOString(),
      });
    } catch (e) {
      this._console('LOG_WRITE_ERROR', e.message, null, 'error');
    }
  }

  // ── Internal: structured Railway console output ───────────────────
  _console(event, message, data = null, level = 'info') {
    const log = {
      ts:        new Date().toISOString(),
      event,
      message,
      sessionId: this.sessionId,
      userId:    this.userId,
      ...(data ? { data } : {}),
    };

    if (level === 'error') {
      console.error(JSON.stringify(log));
    } else {
      console.log(JSON.stringify(log));
    }
  }
}

module.exports = SyncLogger;
