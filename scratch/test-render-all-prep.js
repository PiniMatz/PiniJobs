import { getApplications } from '../api/db.js';
import dotenv from 'dotenv';
dotenv.config();

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  if (Array.isArray(str)) {
    return str.map(item => escapeHtml(item)).join('\n');
  }
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getProcessMetrics(app) {
  const startDate = app.applied_at ? new Date(app.applied_at) : new Date(app.created_at || Date.now());
  const lastUpdate = app.updated_at ? new Date(app.updated_at) : startDate;
  const now = new Date();
  const isFinished = app.status === 'terminated' || app.status === 'offer' || app.status === 'rejected' || app.status === 'withdrawn';
  const endDate = isFinished ? lastUpdate : now;
  const diffMs = endDate - startDate;
  const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const updatedDateStr = lastUpdate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { days, updatedDateStr, isFinished };
}

function testRender(app) {
  const prep = app.prep_summary || null;
  const metrics = getProcessMetrics(app);

  const html = `
    <div class="prep-sheet-header">
      <div class="prep-title-area">
        <h2>
          ${escapeHtml(app.company)}
          <span class="prep-status-badge prep-status-${app.status}">${app.status ? app.status.replace('_', ' ') : ''}</span>
        </h2>
        <div class="prep-title-sub">${escapeHtml(app.role_title || 'Senior Product Manager')} • Applied ${app.applied_at || 'Recently'} (${metrics.days}d active)</div>
      </div>
      <div class="prep-action-area">
        ${app.url ? `<a href="${escapeHtml(app.url)}" target="_blank" class="btn btn-outline"><span class="material-symbols-rounded">open_in_new</span> Job Link</a>` : ''}
        <button class="btn btn-primary" onclick="generateCompanyPrep('${app.id}', true)">
          <span class="material-symbols-rounded icon-spin-hover">auto_awesome</span>
          <span>${prep ? 'Refresh AI Cheat Sheet' : 'Generate AI Cheat Sheet'}</span>
        </button>
      </div>
    </div>

    ${!prep ? `
      <div class="prep-card full-width" style="text-align: center; padding: 2.5rem;">
        <span class="material-symbols-rounded" style="font-size: 3rem; color: var(--primary); margin-bottom: 0.5rem;">psychology</span>
        <h3 style="font-size: 1.2rem; color: #fff; margin-bottom: 0.5rem;">No Cheat Sheet Generated Yet</h3>
        <p style="color: var(--text-secondary); max-width: 420px; margin: 0 auto 1.25rem auto;">Click the button below to analyze ${escapeHtml(app.company)} and generate a 30-second cheat sheet for your recruiter call.</p>
        <button class="btn btn-primary" onclick="generateCompanyPrep('${app.id}', true)">
          <span class="material-symbols-rounded">auto_awesome</span>
          <span>Generate AI Cheat Sheet</span>
        </button>
      </div>
    ` : `
      <div class="prep-grid">
        <div class="prep-card full-width">
          <div class="prep-card-header">
            <span class="material-symbols-rounded">campaign</span>
            <span>30-Second Company Elevator Pitch</span>
          </div>
          <div class="prep-elevator-pitch">
            "${escapeHtml(prep.elevator_pitch || 'Company overview not available.')}"
          </div>
        </div>

        <div class="prep-card">
          <div class="prep-card-header">
            <span class="material-symbols-rounded">business</span>
            <span>Core Products & Market Offering</span>
          </div>
          <ul class="prep-bullets">
            ${(Array.isArray(prep.company_overview) 
                ? prep.company_overview 
                : String(prep.company_overview || 'Overview details not available.').split('\n')
              ).filter(Boolean).map(item => `<li>${escapeHtml(item)}</li>`).join('')
            }
          </ul>
        </div>

        <div class="prep-card">
          <div class="prep-card-header">
            <span class="material-symbols-rounded">checklist</span>
            <span>Job Description & Requirements</span>
          </div>
          <ul class="prep-bullets">
            ${(Array.isArray(prep.job_highlights)
                ? prep.job_highlights
                : String(prep.job_highlights || '').split('\n')
              ).filter(Boolean).map(h => `<li>${escapeHtml(h)}</li>`).join('')}
          </ul>
          ${(prep.key_tech_tags && prep.key_tech_tags.length > 0) ? `
            <div class="prep-tags-container">
              ${(Array.isArray(prep.key_tech_tags) ? prep.key_tech_tags : [prep.key_tech_tags]).map(t => `<span class="prep-tag-pill">${escapeHtml(t)}</span>`).join('')}
            </div>
          ` : ''}
        </div>

        <div class="prep-card">
          <div class="prep-card-header">
            <span class="material-symbols-rounded">record_voice_over</span>
            <span>Your Pitch: "Why ${escapeHtml(app.company)}?"</span>
          </div>
          <div style="font-size: 0.9rem; color: #cbd5e1; line-height: 1.5; font-style: italic;">
            "${escapeHtml(prep.why_us_pitch || 'Strong alignment with candidate background.')}"
          </div>
        </div>

        <div class="prep-card">
          <div class="prep-card-header">
            <span class="material-symbols-rounded">help</span>
            <span>Smart Questions for the Recruiter</span>
          </div>
          <ul class="prep-bullets">
            ${(Array.isArray(prep.questions_for_recruiter)
                ? prep.questions_for_recruiter
                : String(prep.questions_for_recruiter || '').split('\n')
              ).filter(Boolean).map(q => `<li>${escapeHtml(q)}</li>`).join('')}
          </ul>
        </div>

        <div class="prep-card full-width">
          <div class="prep-card-header" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="material-symbols-rounded">edit_note</span>
              <span>Live Call Notes & Key Info (Salary, Team Size, Timeline)</span>
            </div>
            <button class="btn btn-outline" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" onclick="savePrepCallNotes('${app.id}')">
              <span class="material-symbols-rounded" style="font-size: 0.9rem;">save</span>
              <span>Save Notes</span>
            </button>
          </div>
          <textarea id="prep-call-notes-textarea" class="prep-notes-textarea" placeholder="Jot down notes during your phone screen (e.g. Recruiter name, salary expectations, next interview date)...">${escapeHtml(app.notes || '')}</textarea>
        </div>
      </div>
    `}
  `;

  return html;
}

async function testAll() {
  const apps = await getApplications();
  const activeApps = apps.filter(a => a.status !== 'terminated');
  
  console.log(`Testing rendering for ${activeApps.length} active applications...`);
  
  for (const app of activeApps) {
    try {
      const resultHtml = testRender(app);
      console.log(`✅ App ID ${app.id} (${app.company}) rendered successfully! Length: ${resultHtml.length}`);
    } catch (err) {
      console.error(`❌ App ID ${app.id} (${app.company}) FAILED to render:`, err);
    }
  }
}

testAll().catch(console.error);
