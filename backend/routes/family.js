/**
 * Kanalyst — Family Module
 *
 * Routes:
 *   GET    /api/family/status          my family + pending invites
 *   POST   /api/family/invite          invite by email
 *   POST   /api/family/invites/:id/accept
 *   POST   /api/family/invites/:id/reject
 *   DELETE /api/family/members/:userId  remove from family
 *   GET    /api/family/combined/portfolio  merged holdings from all members
 *   GET    /api/family/combined/income     merged income from all members
 *   GET    /api/family/combined/expenses   merged expenses from all members
 *   GET    /api/family/combined/goals      merged goals from all members
 *   GET    /api/family/combined/mf         merged MF holdings from all members
 */

const router      = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const supabase    = require('../services/supabase');

// ── Helper: get all user IDs in my family (including myself) ──────
async function getFamilyUserIds(userId) {
  // Find my group(s)
  const { data: membership } = await supabase
    .from('family_members')
    .select('group_id')
    .eq('user_id', userId);

  if (!membership || membership.length === 0) return [userId];

  const groupIds = membership.map(m => m.group_id);

  const { data: members } = await supabase
    .from('family_members')
    .select('user_id')
    .in('group_id', groupIds);

  const ids = [...new Set((members || []).map(m => m.user_id))];
  return ids.length > 0 ? ids : [userId];
}

// ── Helper: get user display names ───────────────────────────────
async function getUserNames(userIds) {
  const { data: users } = await supabase
    .from('users')
    .select('id, name, email')
    .in('id', userIds);
  const map = {};
  (users || []).forEach(u => { map[u.id] = { name: u.name, email: u.email }; });
  return map;
}

// ── GET /api/family/status ────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  const userId = req.user.id;

  // My groups
  const { data: myMemberships } = await supabase
    .from('family_members')
    .select('group_id, role, joined_at')
    .eq('user_id', userId);

  let group = null;
  let members = [];

  if (myMemberships && myMemberships.length > 0) {
    const groupId = myMemberships[0].group_id;

    const { data: g } = await supabase
      .from('family_groups')
      .select('*')
      .eq('id', groupId)
      .single();
    group = g;

    const { data: allMembers } = await supabase
      .from('family_members')
      .select('user_id, role, joined_at')
      .eq('group_id', groupId);

    if (allMembers && allMembers.length > 0) {
      const nameMap = await getUserNames(allMembers.map(m => m.user_id));
      members = allMembers.map(m => ({
        ...m,
        ...nameMap[m.user_id],
        isMe: m.user_id === userId,
      }));
    }
  }

  // Pending invites I received
  const { data: myInvites } = await supabase
    .from('family_invites')
    .select('id, group_id, invited_by, status, created_at')
    .eq('invited_user_id', userId)
    .eq('status', 'pending');

  // Enrich invites with inviter names
  const enrichedInvites = await Promise.all((myInvites || []).map(async inv => {
    const nameMap = await getUserNames([inv.invited_by]);
    const { data: g } = await supabase
      .from('family_groups').select('name').eq('id', inv.group_id).single();
    return { ...inv, inviterName: nameMap[inv.invited_by]?.name, groupName: g?.name };
  }));

  // Sent invites
  const { data: sentInvites } = await supabase
    .from('family_invites')
    .select('id, invited_email, status, created_at')
    .eq('invited_by', userId);

  res.json({
    inFamily: members.length > 0,
    group,
    members,
    pendingInvites: enrichedInvites || [],
    sentInvites:    sentInvites    || [],
  });
});

// ── POST /api/family/invite ───────────────────────────────────────
router.post('/invite', requireAuth, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const userId = req.user.id;

  // Find or create my family group
  let groupId;
  const { data: existing } = await supabase
    .from('family_members').select('group_id').eq('user_id', userId).single();

  if (existing) {
    groupId = existing.group_id;
  } else {
    // Create new group and add myself as admin
    const { data: newGroup } = await supabase
      .from('family_groups').insert({ created_by: userId, name: 'My Family' }).select().single();
    groupId = newGroup.id;
    await supabase.from('family_members').insert({ group_id: groupId, user_id: userId, role: 'admin' });
  }

  // Find target user by email
  const { data: targetUser } = await supabase
    .from('users').select('id, name').eq('email', email).maybeSingle();

  if (!targetUser) return res.status(404).json({ error: 'No Kanalyst account found with that email' });
  if (targetUser.id === userId) return res.status(400).json({ error: 'Cannot invite yourself' });

  // Check if already in family
  const { data: alreadyMember } = await supabase
    .from('family_members').select('id').eq('group_id', groupId).eq('user_id', targetUser.id).maybeSingle();
  if (alreadyMember) return res.status(409).json({ error: 'This person is already in your family' });

  // Check pending invite already sent
  const { data: existingInvite } = await supabase
    .from('family_invites').select('id, status')
    .eq('group_id', groupId).eq('invited_email', email).eq('status', 'pending').maybeSingle();
  if (existingInvite) return res.status(409).json({ error: 'Invite already sent to this email' });

  // Create invite
  const { data: invite } = await supabase.from('family_invites').insert({
    group_id:       groupId,
    invited_by:     userId,
    invited_email:  email,
    invited_user_id: targetUser.id,
    status:         'pending',
  }).select().single();

  res.status(201).json({ invite, message: `Invite sent to ${targetUser.name}` });
});

// ── POST /api/family/invites/:id/accept ──────────────────────────
router.post('/invites/:id/accept', requireAuth, async (req, res) => {
  const userId = req.user.id;

  const { data: invite } = await supabase
    .from('family_invites').select('*')
    .eq('id', req.params.id).eq('invited_user_id', userId).eq('status', 'pending').single();

  if (!invite) return res.status(404).json({ error: 'Invite not found' });

  // Add user to family group
  await supabase.from('family_members').upsert({
    group_id: invite.group_id,
    user_id:  userId,
    role:     'member',
  }, { onConflict: 'group_id,user_id' });

  // Update invite status
  await supabase.from('family_invites').update({
    status: 'accepted', responded_at: new Date().toISOString()
  }).eq('id', req.params.id);

  res.json({ success: true, message: 'You have joined the family!' });
});

// ── POST /api/family/invites/:id/reject ──────────────────────────
router.post('/invites/:id/reject', requireAuth, async (req, res) => {
  const userId = req.user.id;

  await supabase.from('family_invites').update({
    status: 'rejected', responded_at: new Date().toISOString()
  }).eq('id', req.params.id).eq('invited_user_id', userId);

  res.json({ success: true });
});

// ── DELETE /api/family/members/:userId ───────────────────────────
router.delete('/members/:memberId', requireAuth, async (req, res) => {
  const userId = req.user.id;

  // Find my group
  const { data: myGroup } = await supabase
    .from('family_members').select('group_id, role').eq('user_id', userId).single();

  if (!myGroup) return res.status(404).json({ error: 'Not in a family' });

  // Only admin can remove others; anyone can remove themselves
  if (req.params.memberId !== userId && myGroup.role !== 'admin') {
    return res.status(403).json({ error: 'Only admin can remove members' });
  }

  await supabase.from('family_members')
    .delete().eq('group_id', myGroup.group_id).eq('user_id', req.params.memberId);

  // If admin leaves and others remain, promote first member
  if (req.params.memberId === userId && myGroup.role === 'admin') {
    const { data: remaining } = await supabase
      .from('family_members').select('user_id').eq('group_id', myGroup.group_id).limit(1);
    if (remaining && remaining.length > 0) {
      await supabase.from('family_members')
        .update({ role: 'admin' }).eq('group_id', myGroup.group_id).eq('user_id', remaining[0].user_id);
    }
  }

  res.json({ success: true });
});

// ── GET /api/family/combined/portfolio ────────────────────────────
router.get('/combined/portfolio', requireAuth, async (req, res) => {
  const familyIds = await getFamilyUserIds(req.user.id);
  const nameMap   = await getUserNames(familyIds);

  const allHoldings = [];
  let combinedSummary = { totalValue: 0, totalInvested: 0, totalPnL: 0 };

  for (const uid of familyIds) {
    const { data } = await supabase.from('holdings')
      .select('*').eq('user_id', uid);
    (data || []).forEach(h => {
      const marketValue = (h.quantity || 0) * (h.last_price || h.avg_cost || 0);
      const invested    = (h.quantity || 0) * (h.avg_cost || 0);
      const pnl         = marketValue - invested;
      allHoldings.push({
        ...h,
        marketValue, invested, pnl,
        pnlPct:  invested > 0 ? (pnl / invested) * 100 : 0,
        ltp:     h.last_price || h.avg_cost || 0,
        _member: nameMap[uid]?.name || 'Unknown',
        _userId: uid,
        _isMe:   uid === req.user.id,
      });
      combinedSummary.totalValue    += marketValue;
      combinedSummary.totalInvested += invested;
      combinedSummary.totalPnL      += pnl;
    });
  }

  combinedSummary.totalPnLPct = combinedSummary.totalInvested > 0
    ? (combinedSummary.totalPnL / combinedSummary.totalInvested) * 100 : 0;

  res.json({ holdings: allHoldings, summary: combinedSummary, members: Object.values(nameMap) });
});

// ── GET /api/family/combined/mf ───────────────────────────────────
router.get('/combined/mf', requireAuth, async (req, res) => {
  const familyIds = await getFamilyUserIds(req.user.id);
  const nameMap   = await getUserNames(familyIds);
  const allMF = [];

  for (const uid of familyIds) {
    const { data } = await supabase.from('mf_holdings')
      .select('*').eq('user_id', uid);
    (data || []).forEach(h => {
      allMF.push({
        ...h,
        _member: nameMap[uid]?.name || 'Unknown',
        _userId: uid,
        _isMe:   uid === req.user.id,
      });
    });
  }

  const totalValue = allMF.reduce((s, h) => s + parseFloat(h.current_value || 0), 0);
  res.json({ holdings: allMF, totalValue });
});

// ── GET /api/family/combined/income ───────────────────────────────
router.get('/combined/income', requireAuth, async (req, res) => {
  const familyIds = await getFamilyUserIds(req.user.id);
  const nameMap   = await getUserNames(familyIds);
  const allEntries = [];

  for (const uid of familyIds) {
    const { data } = await supabase.from('income_entries')
      .select('*').eq('user_id', uid).order('credited_on', { ascending: false });
    (data || []).forEach(e => {
      allEntries.push({
        ...e,
        _member: nameMap[uid]?.name || 'Unknown',
        _userId: uid,
        _isMe:   uid === req.user.id,
      });
    });
  }

  allEntries.sort((a, b) => b.credited_on.localeCompare(a.credited_on));

  const now = new Date();
  const fyStart = new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1);
  const fyEntries = allEntries.filter(e => new Date(e.credited_on) >= fyStart);
  const thisMonth = allEntries.filter(e => {
    const d = new Date(e.credited_on);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  res.json({
    entries: allEntries,
    summary: {
      currentFYTotal:  fyEntries.reduce((s, e) => s + parseFloat(e.amount), 0),
      thisMonthTotal:  thisMonth.reduce((s, e) => s + parseFloat(e.amount), 0),
      entryCount:      allEntries.length,
    }
  });
});

// ── GET /api/family/combined/expenses ─────────────────────────────
router.get('/combined/expenses', requireAuth, async (req, res) => {
  const familyIds = await getFamilyUserIds(req.user.id);
  const nameMap   = await getUserNames(familyIds);
  const allEntries = [];

  for (const uid of familyIds) {
    const { data } = await supabase.from('expense_entries')
      .select('*').eq('user_id', uid).order('expense_date', { ascending: false });
    (data || []).forEach(e => {
      allEntries.push({
        ...e,
        _member: nameMap[uid]?.name || 'Unknown',
        _userId: uid,
        _isMe:   uid === req.user.id,
      });
    });
  }

  allEntries.sort((a, b) => b.expense_date.localeCompare(a.expense_date));

  const now = new Date();
  const fyStart = new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1);
  const fyEntries = allEntries.filter(e => new Date(e.expense_date) >= fyStart);
  const thisMonth = allEntries.filter(e => {
    const d = new Date(e.expense_date);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  const byCategory = {};
  fyEntries.forEach(e => { byCategory[e.category||'Others'] = (byCategory[e.category||'Others']||0) + e.amount; });

  res.json({
    entries: allEntries,
    summary: {
      currentFYTotal:  fyEntries.reduce((s, e) => s + parseFloat(e.amount), 0),
      thisMonthTotal:  thisMonth.reduce((s, e) => s + parseFloat(e.amount), 0),
      entryCount:      allEntries.length,
      byCategory,
      uncategorized:   allEntries.filter(e => !e.category).length,
    }
  });
});

// ── GET /api/family/combined/goals ────────────────────────────────
router.get('/combined/goals', requireAuth, async (req, res) => {
  const familyIds = await getFamilyUserIds(req.user.id);
  const nameMap   = await getUserNames(familyIds);
  const allGoals = [];

  for (const uid of familyIds) {
    const { data } = await supabase.from('goals')
      .select('*, goal_assets(*)').eq('user_id', uid);
    (data || []).forEach(g => {
      const progress = g.target_value > 0
        ? Math.min(100, (parseFloat(g.current_value||0) / parseFloat(g.target_value)) * 100) : 0;
      allGoals.push({
        ...g,
        progress,
        asset_count: (g.goal_assets||[]).length,
        _member: nameMap[uid]?.name || 'Unknown',
        _userId: uid,
        _isMe:   uid === req.user.id,
      });
    });
  }

  const summary = {
    total:      allGoals.length,
    new:        allGoals.filter(g => g.status==='new').length,
    inprogress: allGoals.filter(g => g.status==='inprogress').length,
    completed:  allGoals.filter(g => g.status==='completed').length,
    totalTargetValue:  allGoals.reduce((s,g) => s + parseFloat(g.target_value||0), 0),
    totalCurrentValue: allGoals.reduce((s,g) => s + parseFloat(g.current_value||0), 0),
  };

  res.json({ goals: allGoals, summary });
});

module.exports = router;

// ═══════════════════════════════════════════════════════════════════
// ANDROID APP ENDPOINTS — used by Kanalyst Android client
// These use a simpler bilateral invite model (inviter ↔ invitee)
// stored in family_connections table, not the group model above.
// ═══════════════════════════════════════════════════════════════════

// ── Helper: ensure family_connections table exists ────────────────
// We use a simple bilateral table: user_id + partner_id + status
// instead of the group model, matching the Android app's data model.

// ── GET /api/family/members ───────────────────────────────────────
// Returns all connections for the current user (both directions)
router.get('/members', requireAuth, async (req, res) => {
  const uid = req.user.id;
  try {
    // Find connections where I'm the initiator or the partner
    const { data: asInitiator } = await supabase
      .from('family_connections')
      .select('id, partner_id, status, created_at')
      .eq('user_id', uid);

    const { data: asPartner } = await supabase
      .from('family_connections')
      .select('id, user_id, status, created_at')
      .eq('partner_id', uid);

    const allConnections = [];

    // Enrich: get names for partner IDs
    const partnerIds = [
      ...(asInitiator || []).map(c => c.partner_id),
      ...(asPartner   || []).map(c => c.user_id),
    ].filter(Boolean);

    let nameMap = {};
    if (partnerIds.length > 0) {
      const { data: users } = await supabase
        .from('users').select('id, name, email').in('id', partnerIds);
      (users || []).forEach(u => { nameMap[u.id] = u; });
    }

    (asInitiator || []).forEach(c => {
      const partner = nameMap[c.partner_id] || {};
      allConnections.push({
        id:             c.id,
        familyUserId:   c.partner_id,
        familyUserEmail: partner.email || '',
        familyUserName: partner.name  || partner.email || 'Unknown',
        status:         c.status,
        canViewExpenses: true,
      });
    });

    (asPartner || []).forEach(c => {
      const user = nameMap[c.user_id] || {};
      allConnections.push({
        id:             c.id,
        familyUserId:   c.user_id,
        familyUserEmail: user.email || '',
        familyUserName: user.name  || user.email || 'Unknown',
        status:         c.status,
        canViewExpenses: true,
      });
    });

    res.json(allConnections);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/family/invite (Android) ────────────────────────────
// Body: { email: string }
// Returns a FamilyMemberDto
router.post('/invite', requireAuth, async (req, res) => {
  // Only handle the Android JSON invite — the form-based web invite
  // is handled by /invite above if body has no email field.
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  const uid = req.user.id;
  try {
    const { data: partner } = await supabase
      .from('users').select('id, name, email').eq('email', email.toLowerCase().trim()).maybeSingle();

    if (!partner) return res.status(404).json({ error: 'No Kanalyst account found with that email' });
    if (partner.id === uid) return res.status(400).json({ error: 'Cannot invite yourself' });

    // Check existing connection
    const { data: existing } = await supabase
      .from('family_connections')
      .select('id, status')
      .or(`and(user_id.eq.${uid},partner_id.eq.${partner.id}),and(user_id.eq.${partner.id},partner_id.eq.${uid})`)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: existing.status === 'ACCEPTED'
          ? 'Already connected'
          : 'Invite already sent'
      });
    }

    const { data: conn, error } = await supabase
      .from('family_connections')
      .insert({
        user_id:    uid,
        partner_id: partner.id,
        status:     'PENDING',
        created_at: new Date().toISOString(),
      })
      .select().single();

    if (error) throw error;

    res.status(201).json({
      id:             conn.id,
      familyUserId:   partner.id,
      familyUserEmail: partner.email,
      familyUserName: partner.name,
      status:         'PENDING',
      canViewExpenses: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/family/members/:userId (Android) ─────────────────
router.delete('/members/:partnerId', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { partnerId } = req.params;
  try {
    await supabase
      .from('family_connections')
      .delete()
      .or(`and(user_id.eq.${uid},partner_id.eq.${partnerId}),and(user_id.eq.${partnerId},partner_id.eq.${uid})`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/family/transactions/:partnerId ───────────────────────
// Returns partner's expense_transactions for a given month
// Query param: ?month=YYYYMM  e.g. ?month=202605
router.get('/transactions/:partnerId', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { partnerId } = req.params;
  const monthParam = req.query.month; // e.g. 202605

  try {
    // Verify connection exists and is ACCEPTED
    const { data: conn } = await supabase
      .from('family_connections')
      .select('id, status')
      .or(`and(user_id.eq.${uid},partner_id.eq.${partnerId}),and(user_id.eq.${partnerId},partner_id.eq.${uid})`)
      .eq('status', 'ACCEPTED')
      .maybeSingle();

    if (!conn) return res.status(403).json({ error: 'Not connected with this user' });

    let query = supabase
      .from('expense_transactions')
      .select('*')
      .eq('user_id', partnerId)
      .eq('is_deleted', false)
      .order('transaction_date', { ascending: false });

    // Filter by month if provided
    if (monthParam && monthParam.length === 6) {
      const year  = parseInt(monthParam.slice(0, 4));
      const month = parseInt(monthParam.slice(4, 6));
      const from  = new Date(year, month - 1, 1).toISOString().split('T')[0];
      const to    = new Date(year, month, 0).toISOString().split('T')[0];
      query = query.gte('transaction_date', from).lte('transaction_date', to);
    }

    const { data: txns, error } = await query.limit(200);
    if (error) throw error;

    // Map to Android TransactionDto format
    const transactions = (txns || []).map(t => ({
      id:          t.id,
      amount:      parseFloat(t.amount),
      type:        t.transaction_type === 'CREDIT' ? 'CREDIT' : 'DEBIT',
      merchant:    t.merchant_name || t.description,
      description: t.description,
      note:        t.notes,
      dateTime:    new Date(t.transaction_date + 'T' + (t.transaction_time || '00:00:00')).getTime(),
      source:      t.source || 'SMS',
      bankName:    t.bank_name,
      accountLast4: t.account_last4,
      referenceNo: t.reference_number,
      category:    t.category,
    }));

    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/family/master-sync ─────────────────────────────────
// Pull partner's SMS rules and custom fields into caller's account
// Body: { partnerUserId, syncRules, syncFields, syncSheets, syncCategories }
router.post('/master-sync', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { partnerUserId, syncRules = true, syncFields = true } = req.body;

  if (!partnerUserId) return res.status(400).json({ error: 'partnerUserId required' });

  try {
    // Verify connection
    const { data: conn } = await supabase
      .from('family_connections')
      .select('id')
      .or(`and(user_id.eq.${uid},partner_id.eq.${partnerUserId}),and(user_id.eq.${partnerUserId},partner_id.eq.${uid})`)
      .maybeSingle();

    if (!conn) return res.status(403).json({ error: 'Not connected with this user' });

    let smsRules   = [];
    let customFields = [];

    if (syncRules) {
      const { data: rules } = await supabase
        .from('sms_rules')
        .select('*')
        .eq('user_id', partnerUserId)
        .eq('is_active', true);
      smsRules = (rules || []).map(r => ({
        id:              r.id,
        merchantPattern: r.sender_pattern || r.merchant_pattern || '',
        categoryId:      r.category_id,
        matchCount:      r.match_count || 1,
        userConfirmed:   true,
        isIgnored:       r.is_ignored || false,
      }));
    }

    if (syncFields) {
      const { data: fields } = await supabase
        .from('custom_fields')
        .select('*')
        .eq('user_id', partnerUserId)
        .eq('is_deleted', false);
      customFields = (fields || []).map(f => ({
        id:           f.id,
        userId:       f.user_id,
        name:         f.name,
        fieldType:    f.field_type,
        options:      f.options || [],
        autoFillRules: f.auto_fill_rules || {},
        isRequired:   f.is_required || false,
        displayOrder: f.display_order || 0,
        isDeleted:    false,
      }));
    }

    res.json({
      smsRules,
      customFields,
      message: `Synced ${smsRules.length} rules, ${customFields.length} fields`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/family/connections/accept ──────────────────────────
// Accept a pending connection request
router.post('/connections/accept', requireAuth, async (req, res) => {
  const uid = req.user.id;
  const { fromUserId } = req.body;
  if (!fromUserId) return res.status(400).json({ error: 'fromUserId required' });
  try {
    await supabase
      .from('family_connections')
      .update({ status: 'ACCEPTED', updated_at: new Date().toISOString() })
      .eq('user_id', fromUserId).eq('partner_id', uid).eq('status', 'PENDING');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
