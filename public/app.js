'use strict';

const $ = (selector) => document.querySelector(selector);
const state = {
  sessionNonce: null,
  graphAvailable: false,
  modelConfigured: false,
  entities: [],
  report: null,
  draft: null,
  pendingReview: null,
};

function makeElement(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = String(text);
  return element;
}

function setNotice(element, text, tone = '') {
  element.textContent = text;
  if (tone) element.dataset.tone = tone;
  else delete element.dataset.tone;
}

function emptyRow(text) {
  return makeElement('p', 'empty-row', text);
}

async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (method === 'POST') {
    if (!state.sessionNonce) throw new Error('Local session nonce is not available. Reload the page.');
    headers.set('Content-Type', 'application/json');
    headers.set('X-Session-Nonce', state.sessionNonce);
  }
  const response = await fetch(path, {
    ...options,
    method,
    headers,
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
  });
  const nonce = response.headers.get('X-Session-Nonce');
  if (nonce) state.sessionNonce = nonce;
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Local service returned an unreadable response.'); }
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Request failed.');
    error.code = data?.error?.code || 'request_failed';
    error.status = response.status;
    throw error;
  }
  return data;
}

async function loadHealth() {
  const health = await api('/api/health');
  state.graphAvailable = health.graph === 'available';
  state.modelConfigured = health.model === 'configured';
  const status = $('#connection-status');
  const message = state.graphAvailable
    ? (state.modelConfigured ? 'Graph and model ready' : 'Graph ready · model access missing')
    : 'Graph unavailable';
  status.textContent = message;
  status.dataset.state = state.graphAvailable ? 'available' : 'unavailable';
  $('#ask-button').disabled = !state.graphAvailable || !state.modelConfigured;
  if (!state.graphAvailable) {
    setNotice($('#request-state'), 'Graph unavailable. No answer or save can be produced.', 'error');
  } else if (!state.modelConfigured) {
    setNotice($('#request-state'), 'Graph is ready. Configure model access to draft a question; no model call has been made.', 'error');
  } else {
    setNotice($('#request-state'), 'Local graph ready. Ask a question to inspect evidence.', 'success');
  }
}

async function loadEntities() {
  const select = $('#service-select');
  try {
    const result = await api('/api/entities');
    state.entities = Array.isArray(result.entities) ? result.entities : [];
    select.replaceChildren();
    const placeholder = makeElement('option', '', state.entities.length ? 'Choose a service' : 'No service records');
    placeholder.value = '';
    select.append(placeholder);
    for (const entity of state.entities) {
      const option = makeElement('option', '', entity.name);
      option.value = entity.id;
      select.append(option);
    }
    select.disabled = state.entities.length === 0;
    if (state.entities.length) $('#ask-button').disabled = !state.modelConfigured;
    if (result.truncated) setNotice($('#request-state'), 'Service list is capped at 500 entries. Choose within the displayed inventory.', 'error');
  } catch (error) {
    select.replaceChildren(makeElement('option', '', 'Graph inventory unavailable'));
    select.disabled = true;
    $('#ask-button').disabled = true;
    setNotice($('#request-state'), error.message, 'error');
  }
}

function entityName(id) {
  return state.entities.find((entity) => entity.id === id)?.name || id;
}

function renderReport(report, draft, draftError = null) {
  state.report = report;
  state.draft = draft;
  $('#report-empty').hidden = true;
  $('#report-content').hidden = false;
  const status = $('#report-status');
  status.textContent = report.status;
  status.dataset.state = report.status;
  $('#report-intent').textContent = report.intent;
  $('#draft-state').textContent = draftError ? 'DRAFT UNAVAILABLE' : (draft ? 'VALIDATED FACTS' : 'NO DRAFT');

  const completeness = report.completeness || {};
  const coverage = $('#coverage-list');
  coverage.replaceChildren();
  for (const [label, key] of [
    ['Traversal', 'traversal'], ['Paths', 'paths'], ['Lineage', 'lineage'], ['Source coverage', 'sourceCoverage'],
  ]) {
    const cell = makeElement('div', 'coverage-cell');
    cell.append(makeElement('span', '', label));
    cell.append(makeElement('strong', '', completeness[key] ? 'Complete' : 'Incomplete'));
    coverage.append(cell);
  }
  const limits = report.limits || {};
  const limitParts = [`Depth ${limits.depth ?? 'unknown'}`, `Path cap ${limits.pathCap ?? 'unknown'}`];
  if (limits.overflow) limitParts.push('path display capped');
  if (Array.isArray(limits.frontierIds) && limits.frontierIds.length) limitParts.push(`${limits.frontierIds.length} unexpanded frontier nodes`);
  $('#report-limit').textContent = `${limitParts.join(' · ')}. ${report.status !== 'complete' || (report.gaps || []).length
    ? 'Coverage has unresolved gaps; do not infer that a service is safe to remove.'
    : 'No unmodeled system can be ruled out by this synthetic graph.'}`;

  const factList = $('#draft-facts');
  factList.replaceChildren();
  const facts = draft?.facts || [];
  if (draftError) factList.append(emptyRow(draftError.message));
  else if (!facts.length) factList.append(emptyRow('No authoritative facts selected for this question.'));
  for (const fact of facts) {
    const card = makeElement('article', 'evidence-card');
    card.append(makeElement('strong', '', fact.predicate));
    card.append(makeElement('p', '', `${entityName(fact.subjectId)} → ${entityName(fact.objectId)}`));
    card.append(makeElement('p', '', `Fact ${fact.id} · ${fact.edgeIds.join(', ')}`));
    factList.append(card);
  }

  const actions = $('#draft-actions');
  actions.replaceChildren();
  const proposals = draft?.actions || [];
  if (proposals.length) actions.append(makeElement('p', 'mono-label', 'PROPOSED REVIEW ACTIONS'));
  for (const action of proposals) {
    const card = makeElement('article', 'action-card');
    card.append(makeElement('p', '', `${action.type} · ${entityName(action.entityId)}`));
    card.append(makeElement('p', '', `Bound to ${action.factIds.join(', ')}`));
    actions.append(card);
  }

  const pathList = $('#path-list');
  pathList.replaceChildren();
  const paths = Array.isArray(report.paths) ? report.paths : [];
  $('#path-count').textContent = `${paths.length} displayed`;
  if (!paths.length) pathList.append(emptyRow('No evidence paths returned.'));
  for (const path of paths) {
    const card = makeElement('div', 'path-card');
    const text = path.nodeIds.map((id) => entityName(id)).join('  →  ');
    card.textContent = `${text || 'No nodes'}${path.edgeIds?.length ? `   ·   ${path.edgeIds.join(' / ')}` : ''}`;
    pathList.append(card);
  }

  const decisions = $('#decision-list');
  decisions.replaceChildren();
  const decisionItems = (report.decisions || []).flatMap((group) => (group.decisions || []).map((decision) => ({ ...decision, decisionKey: group.decisionKey, lineageStatus: group.status })));
  if (!decisionItems.length) decisions.append(emptyRow('No accepted decision history in this report.'));
  for (const decision of decisionItems) {
    const card = makeElement('article', 'decision-card');
    card.dataset.state = decision.state;
    card.append(makeElement('strong', '', `${decision.state.toUpperCase()} · ${decision.id}`));
    card.append(makeElement('p', '', `Scope ${decision.decisionKey} · lineage ${decision.lineageStatus}`));
    card.append(makeElement('p', '', decision.rationale));
    decisions.append(card);
  }

  const sources = $('#source-list');
  sources.replaceChildren();
  const sourceItems = Array.isArray(report.sources) ? report.sources : [];
  $('#source-count').textContent = `${sourceItems.length} anchors`;
  if (!sourceItems.length) sources.append(emptyRow('No citable source anchors returned.'));
  sourceItems.forEach((source) => {
    const card = makeElement('article', 'source-card');
    card.append(makeElement('strong', '', `${source.sourceId} · ${source.revisionIdentity}`));
    card.append(makeElement('p', '', `${source.revisionId} · anchor ${source.anchor}`));
    card.append(makeElement('p', '', source.excerpt));
    const verify = makeElement('button', '', 'Re-verify immutable source');
    verify.type = 'button';
    verify.addEventListener('click', () => verifySource(report.requestId, source));
    card.append(verify);
    sources.append(card);
  });

  const gaps = $('#gap-list');
  gaps.replaceChildren();
  if (!(report.gaps || []).length) gaps.append(emptyRow('No gaps reported.'));
  for (const gap of report.gaps || []) {
    const card = makeElement('article', 'gap-card');
    card.append(makeElement('strong', '', gap.code));
    if (gap.entityId) card.append(makeElement('p', '', `Entity ${gap.entityId}`));
    if (gap.edgeId) card.append(makeElement('p', '', `Edge ${gap.edgeId}`));
    gaps.append(card);
  }

  renderCitations(sourceItems);
  const reviewForm = $('#review-form');
  reviewForm.hidden = sourceItems.length === 0;
  $('#prepare-review').disabled = true;
  $('#pending-review').hidden = true;
  state.pendingReview = null;
  setNotice($('#review-state'), sourceItems.length ? 'Choose the source anchors you reviewed before preparing a decision.' : 'This report has no source anchors to cite.', sourceItems.length ? '' : 'error');
}

function renderCitations(sources) {
  const container = $('#citation-options');
  container.replaceChildren();
  sources.forEach((source, index) => {
    const label = makeElement('label', 'citation-option');
    const checkbox = makeElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'citation';
    checkbox.value = String(index);
    checkbox.addEventListener('change', updatePrepareButton);
    const description = makeElement('span', '', `${source.sourceId} · ${source.revisionIdentity} · ${source.anchor} · ${source.excerpt}`);
    label.append(checkbox, description);
    container.append(label);
  });
}

function updatePrepareButton() {
  $('#prepare-review').disabled = !document.querySelector('input[name="citation"]:checked');
}

async function verifySource(requestId, source) {
  const detail = $('#source-detail');
  detail.hidden = false;
  detail.textContent = 'Verifying immutable source…';
  const query = new URLSearchParams({ requestId, revisionId: source.revisionId, anchor: source.anchor });
  try {
    const result = await api(`/api/source?${query.toString()}`);
    detail.textContent = `${result.source.sourceId} · ${result.source.revisionIdentity}\n${result.source.contentDigest}\n${result.source.excerpt}`;
  } catch (error) {
    detail.textContent = `Source verification failed: ${error.message}`;
  }
}

function renderPendingReview(review) {
  const summary = $('#pending-summary');
  summary.replaceChildren();
  for (const [label, value] of [
    ['Decision', review.text], ['Rationale', review.rationale], ['Scope', `${review.subjectId} · ${review.decisionKey}`],
    ['Reviewer', review.reviewerId], ['Predecessor', review.expectedPredecessorId || 'No prior decision'],
    ['Cited anchors', review.citations.map((citation) => `${citation.revisionId} · ${citation.anchor}`).join('\n')],
    ['Intent digest', review.digest],
  ]) {
    const row = makeElement('div', 'pending-row');
    row.append(makeElement('span', '', label));
    row.append(makeElement('p', '', value));
    summary.append(row);
  }
  $('#participant-confirmed').checked = false;
  $('#confirm-review').disabled = true;
  $('#pending-review').hidden = false;
  $('#review-form').hidden = true;
  setNotice($('#review-state'), 'Review prepared. No graph writes have happened.', 'success');
}

function saveReviewReference(review) {
  try { sessionStorage.setItem('release-memory-review-ref', JSON.stringify({ requestId: review.requestId, digest: review.digest })); }
  catch { /* Read-only status remains available during this page session. */ }
}

function clearReviewReference() {
  try { sessionStorage.removeItem('release-memory-review-ref'); } catch { /* Storage may be disabled. */ }
}

function showSavedReview(message, tone = 'success') {
  const saved = $('#saved-review');
  saved.replaceChildren();
  saved.append(makeElement('span', 'eyebrow', 'REVIEW STATUS'));
  saved.append(makeElement('p', '', message));
  saved.hidden = false;
  setNotice($('#review-state'), message, tone);
}

async function reconcileSavedReview() {
  let reference;
  try { reference = JSON.parse(sessionStorage.getItem('release-memory-review-ref') || 'null'); }
  catch { clearReviewReference(); return; }
  if (!reference || typeof reference.requestId !== 'string' || typeof reference.digest !== 'string') return;
  const section = $('#reconciliation');
  section.hidden = false;
  $('#reconciliation-state').textContent = 'Checking persisted review receipt without writing or calling a model.';
  const query = new URLSearchParams({ requestId: reference.requestId, digest: reference.digest });
  try {
    const result = await api(`/api/reviews/status?${query.toString()}`);
    const status = result.status;
    if (status.state === 'committed') {
      showSavedReview(`Decision ${status.decisionId} is ${status.classification}.`);
      clearReviewReference();
    } else if (status.state === 'pending') {
      $('#reconciliation-state').textContent = 'A server-side review is pending. This page cannot restore its confirmation; inspect and prepare a fresh review before any save.';
    } else if (status.state === 'absent') {
      $('#reconciliation-state').textContent = 'No persisted receipt exists. The prior review may have expired; inspect evidence and prepare a new review.';
      clearReviewReference();
    } else if (status.state === 'unavailable') {
      $('#reconciliation-state').textContent = 'Graph unavailable. Review outcome remains unknown; no retry was sent.';
    } else {
      $('#reconciliation-state').textContent = `Review status: ${status.state}. No write was attempted.`;
    }
  } catch (error) {
    $('#reconciliation-state').textContent = `Review status could not be resolved: ${error.message}. No retry was sent.`;
  }
}

$('#question-input').addEventListener('input', (event) => {
  const count = Array.from(event.currentTarget.value).length;
  $('#question-count').textContent = `${count} / 500`;
});

$('#question-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const targetId = $('#service-select').value;
  const question = $('#question-input').value;
  $('#ask-button').disabled = true;
  $('#review-form').hidden = true;
  $('#pending-review').hidden = true;
  $('#saved-review').hidden = true;
  setNotice($('#request-state'), 'Selecting a supported read intent and inspecting graph evidence…');
  setNotice($('#review-state'), 'Review requires a fresh evidence report.');
  try {
    const result = await api('/api/question', { method: 'POST', body: JSON.stringify({ targetId, question }) });
    if (result.report) {
      renderReport(result.report, result.draft || null, result.error || null);
      setNotice($('#request-state'), result.error ? `Evidence retrieved. ${result.error.message}` : 'Evidence retrieved from the local graph.', result.error ? 'error' : 'success');
    } else {
      throw Object.assign(new Error(result.error?.message || 'Question could not be answered.'), { code: result.error?.code || 'request_failed' });
    }
  } catch (error) {
    setNotice($('#request-state'), error.message, 'error');
    if (error.code === 'invalid_nonce') {
      setNotice($('#request-state'), 'Local session changed. Reload and inspect again before preparing a review.', 'error');
    }
  } finally {
    $('#ask-button').disabled = !state.graphAvailable || !state.modelConfigured || state.entities.length === 0;
  }
});

$('#review-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.report) return;
  const selected = [...document.querySelectorAll('input[name="citation"]:checked')]
    .map((input) => state.report.sources[Number(input.value)])
    .filter(Boolean)
    .map(({ revisionId, anchor, contentDigest }) => ({ revisionId, anchor, contentDigest }));
  if (!selected.length) {
    setNotice($('#review-state'), 'Select at least one source anchor you reviewed.', 'error');
    return;
  }
  $('#prepare-review').disabled = true;
  setNotice($('#review-state'), 'Checking current lineage and preparing exact review intent…');
  const body = {
    subjectId: state.report.targetId,
    decisionKey: $('#decision-key').value,
    text: $('#review-text').value,
    rationale: $('#review-rationale').value,
    reviewerId: $('#reviewer-id').value,
    citations: selected,
  };
  try {
    const result = await api('/api/reviews', { method: 'POST', body: JSON.stringify(body) });
    state.pendingReview = result.review;
    saveReviewReference(result.review);
    renderPendingReview(result.review);
  } catch (error) {
    setNotice($('#review-state'), error.message, 'error');
    $('#prepare-review').disabled = !document.querySelector('input[name="citation"]:checked');
  }
});

$('#participant-confirmed').addEventListener('change', (event) => {
  $('#confirm-review').disabled = !event.currentTarget.checked || !state.pendingReview;
});

$('#confirm-review').addEventListener('click', async () => {
  const review = state.pendingReview;
  if (!review || !$('#participant-confirmed').checked) return;
  $('#confirm-review').disabled = true;
  setNotice($('#review-state'), 'Saving the exact reviewed decision…');
  try {
    const result = await api('/api/reviews/confirm', {
      method: 'POST',
      body: JSON.stringify({
        requestId: review.requestId,
        expectedDigest: review.digest,
        confirmationNonce: review.confirmationNonce,
        participantConfirmed: true,
      }),
    });
    state.pendingReview = null;
    $('#pending-review').hidden = true;
    $('#review-form').hidden = false;
    clearReviewReference();
    showSavedReview(`Decision ${result.decisionId} saved as ${result.classification}.`);
  } catch (error) {
    if (error.code === 'uncertain_write') {
      setNotice($('#review-state'), 'Save acknowledgment is uncertain. Checking the persisted receipt without retrying.', 'error');
      await reconcileSavedReview();
    } else {
      setNotice($('#review-state'), error.message, 'error');
      if (error.code === 'stale_review' || error.code === 'review_expired') {
        $('#pending-review').hidden = true;
        $('#review-form').hidden = false;
        state.pendingReview = null;
      }
    }
  }
});

$('#cancel-review').addEventListener('click', () => {
  state.pendingReview = null;
  $('#pending-review').hidden = true;
  $('#review-form').hidden = false;
  clearReviewReference();
  setNotice($('#review-state'), 'Review canceled in this page. No graph writes have happened.');
});

async function initialize() {
  try { await loadHealth(); }
  catch (error) {
    $('#connection-status').textContent = 'Local service unavailable';
    $('#connection-status').dataset.state = 'unavailable';
    setNotice($('#request-state'), error.message, 'error');
  }
  if (state.graphAvailable) await loadEntities();
  await reconcileSavedReview();
}

void initialize();
