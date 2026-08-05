// State Management
let applications = [];
let upcomingEvents = [];
let currentJob = null; // Store currently viewed job in details sheet
let activeTab = 'board';
let selectedPrepAppId = null;

// API Helpers
function getHeaders() {
  const token = localStorage.getItem('WEBAPP_JOBS_TOKEN') || '';
  const headers = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function apiCall(url, options = {}) {
  const defaultOptions = {
    headers: getHeaders(),
  };
  
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...(options.headers || {})
    }
  };

  const response = await fetch(url, mergedOptions);
  
  if (response.status === 401) {
    const token = prompt('API Access Token required. Please enter token:');
    if (token) {
      localStorage.setItem('WEBAPP_JOBS_TOKEN', token);
      location.reload();
    }
    throw new Error('Unauthorized');
  }
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  
  if (response.status === 204) return null;
  return response.json();
}

// Tab Switcher
function switchTab(tabName) {
  activeTab = tabName;
  const boardBtn = document.getElementById('tab-btn-board');
  const prepBtn = document.getElementById('tab-btn-prep');
  const boardContainer = document.getElementById('board-view-container');
  const prepContainer = document.getElementById('prep-view-container');

  if (tabName === 'prep') {
    boardBtn.classList.remove('active');
    prepBtn.classList.add('active');
    boardContainer.classList.add('hidden');
    prepContainer.classList.remove('hidden');
    renderPrepTab();
  } else {
    prepBtn.classList.remove('active');
    boardBtn.classList.add('active');
    prepContainer.classList.add('hidden');
    boardContainer.classList.remove('hidden');
    renderBoard();
  }
}

// Load Data
async function loadData() {
  try {
    applications = await apiCall('/api/applications');
    upcomingEvents = await apiCall('/api/events?action=upcoming');
    
    // Update badge count for active prep applications
    const activeApps = applications.filter(a => a.status !== 'terminated' && a.status !== 'rejected' && a.status !== 'withdrawn');
    const badgeEl = document.getElementById('prep-badge-count');
    if (badgeEl) badgeEl.textContent = activeApps.length;

    if (activeTab === 'prep') {
      renderPrepTab();
    } else {
      renderBoard();
    }
    renderSidebar();
    
    // Refresh open sheet if viewing a job
    if (currentJob) {
      const updatedJob = await apiCall(`/api/applications?id=${currentJob.id}`);
      currentJob = updatedJob;
      renderDetailSheet(updatedJob);
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

// Render Recruiter Screening Prep Tab
function renderPrepTab() {
  const activeApps = applications.filter(a => a.status !== 'terminated' && a.status !== 'rejected' && a.status !== 'withdrawn');
  
  // Sort active apps by status urgency then updated date
  const statusRank = { screening: 1, interview: 2, home_task: 3, offer: 4, applied: 5 };
  activeApps.sort((a, b) => {
    const rankA = statusRank[a.status] || 99;
    const rankB = statusRank[b.status] || 99;
    if (rankA !== rankB) return rankA - rankB;
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  });

  const searchInput = document.getElementById('prep-search-input');
  const searchText = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filteredApps = activeApps.filter(app => {
    if (!searchText) return true;
    return (app.company && app.company.toLowerCase().includes(searchText)) ||
           (app.role_title && app.role_title.toLowerCase().includes(searchText));
  });

  const companyListEl = document.getElementById('prep-company-list');
  if (!companyListEl) return;

  if (filteredApps.length === 0) {
    companyListEl.innerHTML = `<div class="empty-state">No active opportunities match search</div>`;
    renderPrepDetailPanel(null);
    return;
  }

  // Auto-select first active company if current selection is invalid
  if (!selectedPrepAppId || !filteredApps.some(a => a.id === selectedPrepAppId)) {
    selectedPrepAppId = filteredApps[0].id;
  }

  companyListEl.innerHTML = '';
  filteredApps.forEach(app => {
    const item = document.createElement('div');
    item.className = `prep-company-item ${app.id === selectedPrepAppId ? 'active' : ''}`;
    item.onclick = (e) => {
      if (e) e.stopPropagation();
      selectedPrepAppId = app.id;
      document.querySelectorAll('.prep-company-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      renderPrepDetailPanel(app);
    };

    const metrics = getProcessMetrics(app);

    item.innerHTML = `
      <div class="prep-item-top">
        <span class="prep-item-name">${escapeHtml(app.company)}</span>
        <span class="prep-status-badge prep-status-${app.status}">${app.status.replace('_', ' ')}</span>
      </div>
      <div class="prep-item-role">${escapeHtml(app.role_title || 'Senior Product Manager')}</div>
      <div class="prep-item-meta">
        <span>Updated: ${metrics.updatedDateStr}</span>
        <span>${metrics.days}d active</span>
      </div>
    `;
    companyListEl.appendChild(item);
  });

  const selectedApp = applications.find(a => a.id === selectedPrepAppId);
  renderPrepDetailPanel(selectedApp);
}

// Render Cheat Sheet Detail Panel
function renderPrepDetailPanel(app) {
  const panelEl = document.getElementById('prep-detail-panel');
  if (!panelEl) return;

  if (!app) {
    panelEl.innerHTML = `
      <div class="prep-empty-state">
        <span class="material-symbols-rounded">phone_in_talk</span>
        <h3>Select an active company on the left to open your Recruiter Screening Cheat Sheet</h3>
        <p>Active opportunities are automatically synced and enriched with company highlights, job description tags, and recruiter interview pitch strategies.</p>
      </div>
    `;
    return;
  }

  const prep = app.prep_summary || null;
  const metrics = getProcessMetrics(app);

  panelEl.innerHTML = `
    <div class="prep-sheet-header">
      <div class="prep-title-area">
        <h2>
          ${escapeHtml(app.company)}
          <span class="prep-status-badge prep-status-${app.status}">${app.status.replace('_', ' ')}</span>
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
        <!-- Elevator Pitch Card -->
        <div class="prep-card full-width">
          <div class="prep-card-header">
            <span class="material-symbols-rounded">campaign</span>
            <span>30-Second Company Elevator Pitch</span>
          </div>
          <div class="prep-elevator-pitch">
            "${escapeHtml(prep.elevator_pitch || 'Company overview not available.')}"
          </div>
        </div>

        <!-- Company Overview & Product Offerings -->
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

        <!-- Job Description & Must-Have Skills -->
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

        <!-- "Why This Company?" Pitch -->
        <div class="prep-card">
          <div class="prep-card-header">
            <span class="material-symbols-rounded">record_voice_over</span>
            <span>Your Pitch: "Why ${escapeHtml(app.company)}?"</span>
          </div>
          <div style="font-size: 0.9rem; color: #cbd5e1; line-height: 1.5; font-style: italic;">
            "${escapeHtml(prep.why_us_pitch || 'Strong alignment with candidate background.')}"
          </div>
        </div>

        <!-- Smart Questions to Ask Recruiter -->
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

        <!-- Live Call Notes -->
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
}

// Generate AI Prep Sheet Handler
async function generateCompanyPrep(appId, forceRefresh = false) {
  try {
    const btn = document.querySelector('#prep-detail-panel button.btn-primary');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="material-symbols-rounded icon-spin-hover">sync</span> Analyzing Company & Job...`;
    }

    const res = await apiCall(`/api/company-prep?appId=${appId}${forceRefresh ? '&refresh=true' : ''}`);
    if (res && res.prep_summary) {
      const targetApp = applications.find(a => a.id === appId);
      if (targetApp) {
        targetApp.prep_summary = res.prep_summary;
      }
      renderPrepDetailPanel(targetApp);
    } else {
      alert('Failed to generate cheat sheet. Please try again.');
      renderPrepTab();
    }
  } catch (err) {
    alert(`Failed to generate prep sheet: ${err.message}`);
    renderPrepTab();
  }
}

// Save Call Notes Handler
async function savePrepCallNotes(appId) {
  const textarea = document.getElementById('prep-call-notes-textarea');
  if (!textarea) return;
  const notesText = textarea.value;

  try {
    await apiCall(`/api/applications?id=${appId}`, {
      method: 'PUT',
      body: JSON.stringify({ notes: notesText })
    });
    const targetApp = applications.find(a => a.id === appId);
    if (targetApp) targetApp.notes = notesText;
    alert('Call notes saved successfully!');
  } catch (err) {
    alert(`Failed to save notes: ${err.message}`);
  }
}

// Explicit Window Expose for Inline HTML Onclick Handlers
window.generateCompanyPrep = generateCompanyPrep;
window.savePrepCallNotes = savePrepCallNotes;

function getProcessMetrics(app) {
  const startDate = app.applied_at ? new Date(app.applied_at) : new Date(app.created_at || Date.now());
  const lastUpdate = app.updated_at ? new Date(app.updated_at) : startDate;
  const now = new Date();

  const isFinished = app.status === 'terminated' || app.status === 'offer' || app.status === 'rejected' || app.status === 'withdrawn';
  const endDate = isFinished ? lastUpdate : now;

  const diffMs = endDate - startDate;
  const days = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  const updatedDateStr = lastUpdate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return {
    days,
    updatedDateStr,
    isFinished
  };
}

// Render Board & Columns
function renderBoard() {
  const columns = ['applied', 'screening', 'interview', 'home_task', 'offer', 'terminated'];
  
  // Clear all columns
  columns.forEach(col => {
    const container = document.getElementById(`col-${col}`);
    if (container) container.innerHTML = '';
  });

  // Keep track of counts
  const counts = { applied: 0, screening: 0, interview: 0, home_task: 0, offer: 0, terminated: 0 };

  applications.forEach(app => {
    let colId = app.status;
    if (colId === 'rejected' || colId === 'withdrawn') {
      colId = 'terminated';
    } else if (colId === 'saved') {
      colId = 'applied';
    }

    const container = document.getElementById(`col-${colId}`);
    if (container) {
      counts[colId]++;
      
      const card = document.createElement('div');
      card.className = `job-card status-${colId}`;
      card.draggable = true;
      card.dataset.id = app.id;
      
      const hasUpcomingEvent = upcomingEvents.some(e => e.application_id === app.id);
      
      let sourceBadge = '';
      if (app.source) {
        const sourceLower = app.source.toLowerCase().trim();
        sourceBadge = `<span class="card-badge source-${sourceLower}">${app.source}</span>`;
      }

      const metrics = getProcessMetrics(app);
      const durationText = metrics.isFinished ? `${metrics.days}d total` : `${metrics.days}d active`;

      card.innerHTML = `
        ${hasUpcomingEvent ? '<div class="card-event-indicator" title="Upcoming event"></div>' : ''}
        <div class="card-company">${escapeHtml(app.company)}</div>
        <div class="card-role">${escapeHtml(app.role_title)}</div>
        <div class="card-meta">
          ${sourceBadge}
          <div class="card-dates">
            <span class="card-updated">${metrics.updatedDateStr}</span>
            <span class="card-duration">${durationText}</span>
          </div>
        </div>
      `;
      
      card.addEventListener('click', () => showJobDetails(app.id));
      card.addEventListener('dragstart', handleDragStart);
      
      container.appendChild(card);
    }
  });

  columns.forEach(col => {
    const countBadge = document.querySelector(`.board-column[data-status="${col}"] .column-count`);
    if (countBadge) countBadge.textContent = counts[col];
  });
}

// Render Sidebar Upcoming Events
function renderSidebar() {
  const container = document.getElementById('upcoming-events-list');
  if (!container) return;
  container.innerHTML = '';

  if (upcomingEvents.length === 0) {
    container.innerHTML = '<div class="empty-state">No upcoming events</div>';
    return;
  }

  upcomingEvents.forEach(event => {
    const app = applications.find(a => a.id === event.application_id);
    const company = app ? app.company : 'Unknown Company';
    const role = app ? app.role_title : 'Unknown Role';
    
    const card = document.createElement('div');
    card.className = 'event-card';
    
    card.innerHTML = `
      <div class="event-card-header">
        <span class="event-type-badge type-${event.type}">${event.type}</span>
        <span class="event-time-relative">${formatRelativeTime(event.due_at)}</span>
      </div>
      <div class="event-card-job" data-app-id="${event.application_id}">
        ${escapeHtml(company)} — <span style="font-weight: normal; font-size: 0.85rem; color: var(--text-secondary);">${escapeHtml(role)}</span>
      </div>
      <div class="event-card-detail">${escapeHtml(event.detail)}</div>
      <div class="event-due-date">
        <span class="material-symbols-rounded">schedule</span>
        ${new Date(event.due_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </div>
    `;
    
    // Tap job name to view application details
    const jobLink = card.querySelector('.event-card-job');
    jobLink.addEventListener('click', (e) => {
      e.stopPropagation();
      showJobDetails(event.application_id);
    });

    container.appendChild(card);
  });
}

// Show job detail sheet
async function showJobDetails(id) {
  try {
    currentJob = await apiCall(`/api/applications?id=${id}`);
    renderDetailSheet(currentJob);
    document.getElementById('detail-sheet').classList.add('active');
  } catch (error) {
    console.error('Error fetching job details:', error);
  }
}

function renderDetailSheet(job) {
  const body = document.getElementById('sheet-body-content');
  if (!body) return;

  const urlLink = job.url 
    ? `<a href="${job.url}" target="_blank" rel="noopener">${escapeHtml(job.url)} <span class="material-symbols-rounded" style="font-size: 0.9rem; vertical-align: middle;">open_in_new</span></a>` 
    : '<span class="detail-value text-muted">No URL</span>';

  // Render detail fields
  let content = `
    <div class="detail-title-section">
      <div class="detail-company">${escapeHtml(job.company)}</div>
      <div class="detail-role">${escapeHtml(job.role_title)}</div>
      <span class="card-badge source-${job.source ? job.source.toLowerCase().trim() : ''}" style="font-size: 0.8rem; padding: 0.25rem 0.75rem;">
        ${escapeHtml(job.source || 'Direct')}
      </span>
    </div>

    <div class="detail-grid">
      <div class="detail-field">
        <span class="detail-label">Status</span>
        <span class="detail-value" style="font-weight: 600; text-transform: capitalize;">${job.status}</span>
      </div>
      <div class="detail-field">
        <span class="detail-label">Applied Date</span>
        <span class="detail-value">${job.applied_at || 'Not applied'}</span>
      </div>
      <div class="detail-field">
        <span class="detail-label">Salary Range</span>
        <span class="detail-value">${escapeHtml(job.salary) || '<span class="text-muted">Not specified</span>'}</span>
      </div>
      <div class="detail-field">
        <span class="detail-label">Location</span>
        <span class="detail-value">${escapeHtml(job.location) || '<span class="text-muted">Not specified</span>'}</span>
      </div>
      <div class="detail-field" style="grid-column: span 2;">
        <span class="detail-label">Job URL</span>
        <span class="detail-value">${urlLink}</span>
      </div>
      <div class="detail-field" style="grid-column: span 2;">
        <span class="detail-label">Contact Details</span>
        <span class="detail-value">${escapeHtml(job.contact) || '<span class="text-muted">No contact listed</span>'}</span>
      </div>
    </div>

    ${job.notes ? `
    <div class="detail-text-block">
      <span class="detail-label">Quick Notes</span>
      <div>${escapeHtml(job.notes)}</div>
    </div>
    ` : ''}

    ${job.description ? `
    <div class="detail-text-block">
      <span class="detail-label">Job Description</span>
      <div>${escapeHtml(job.description)}</div>
    </div>
    ` : ''}

    ${job.requirements ? `
    <div class="detail-text-block">
      <span class="detail-label">Requirements</span>
      <div>${escapeHtml(job.requirements)}</div>
    </div>
    ` : ''}

    <div class="timeline-section">
      <div class="timeline-header">
        <h3>Timeline & Events</h3>
        <button class="btn btn-outline" style="padding: 0.3rem 0.75rem; font-size: 0.8rem;" id="add-timeline-event-btn">
          <span class="material-symbols-rounded" style="font-size: 1rem;">add</span>
          Add Log
        </button>
      </div>
      <div class="timeline-container" id="timeline-events-container">
        <!-- Render events list -->
      </div>
    </div>
  `;

  body.innerHTML = content;

  // Render events timeline
  const timeline = body.querySelector('#timeline-events-container');
  if (job.events && job.events.length > 0) {
    job.events.forEach(e => {
      const item = document.createElement('div');
      item.className = `timeline-item type-${e.type}`;
      
      const dateStr = new Date(e.ts).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      let dueStr = '';
      if (e.due_at) {
        const isFuture = new Date(e.due_at) > new Date();
        dueStr = `
          <div class="timeline-item-due" style="color: ${isFuture ? 'var(--warning)' : 'var(--muted)'}">
            <span class="material-symbols-rounded" style="font-size: 0.85rem; vertical-align: middle;">schedule</span>
            ${isFuture ? 'Scheduled: ' : 'Happened: '} ${new Date(e.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </div>
        `;
      }

      item.innerHTML = `
        <div class="timeline-item-meta">
          <span class="timeline-item-type">${e.type}</span>
          <span>${dateStr}</span>
        </div>
        <div class="timeline-item-detail">${escapeHtml(e.detail)}</div>
        ${dueStr}
      `;
      timeline.appendChild(item);
    });
  } else {
    timeline.innerHTML = '<div class="empty-state" style="padding: 1.5rem;">No logged events yet</div>';
  }

  // Hook up event modal launch button
  body.querySelector('#add-timeline-event-btn').addEventListener('click', () => {
    document.getElementById('event-job-id').value = job.id;
    document.getElementById('event-form').reset();
    document.getElementById('event-modal').classList.add('active');
  });
}

// Drag & Drop Functionality
let draggedCardId = null;

function handleDragStart(e) {
  draggedCardId = this.dataset.id;
  e.dataTransfer.setData('text/plain', draggedCardId);
}

// Set up Board drag target behavior
function initDragAndDrop() {
  const columns = document.querySelectorAll('.board-column');
  
  columns.forEach(column => {
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      column.style.background = 'rgba(99, 102, 241, 0.05)';
    });

    column.addEventListener('dragleave', () => {
      column.style.background = 'rgba(15, 23, 42, 0.4)';
    });

    column.addEventListener('drop', async (e) => {
      e.preventDefault();
      column.style.background = 'rgba(15, 23, 42, 0.4)';
      
      const id = e.dataTransfer.getData('text/plain');
      const targetStatus = column.dataset.status;
      
      if (!id || !targetStatus) return;

      const app = applications.find(a => a.id === id);
      if (app && app.status !== targetStatus) {
        // Optimistic visual update
        app.status = targetStatus;
        app.updated_at = new Date().toISOString();
        renderBoard();
        
        try {
          await apiCall(`/api/applications?id=${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: targetStatus })
          });
          loadData(); // Reload fully to capture generated status events
        } catch (error) {
          console.error('Failed to update status on drag-and-drop:', error);
          loadData(); // Revert on failure
        }
      }
    });
  });
}

// Modal Form Controllers
async function handleJobFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('form-job-id').value;
  
  const payload = {
    company: document.getElementById('form-company').value,
    role_title: document.getElementById('form-role').value,
    status: document.getElementById('form-status').value,
    applied_at: document.getElementById('form-applied-at').value || new Date().toISOString().split('T')[0],
    source: document.getElementById('form-source').value,
    url: document.getElementById('form-url').value,
    location: document.getElementById('form-location').value,
    salary: document.getElementById('form-salary').value,
    contact: document.getElementById('form-contact').value,
    notes: document.getElementById('form-notes').value,
    description: document.getElementById('form-description').value,
    requirements: document.getElementById('form-requirements').value,
  };

  try {
    if (id) {
      // Edit
      await apiCall(`/api/applications?id=${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
    } else {
      // Create
      await apiCall('/api/applications', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    
    closeModal();
    loadData();
  } catch (error) {
    alert(`Failed to save application: ${error.message}`);
  }
}

async function handleEventFormSubmit(e) {
  e.preventDefault();
  const appId = document.getElementById('event-job-id').value;
  
  const dueInput = document.getElementById('event-due-at').value;
  const payload = {
    type: document.getElementById('event-type').value,
    detail: document.getElementById('event-detail').value,
    due_at: dueInput ? new Date(dueInput).toISOString() : null
  };

  try {
    await apiCall(`/api/events?appId=${appId}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    document.getElementById('event-modal').classList.remove('active');
    loadData(); // Reloads details page automatically
  } catch (error) {
    alert(`Failed to log event: ${error.message}`);
  }
}

// Gmail Sync Trigger
async function handleGmailSync() {
  const syncBtn = document.getElementById('sync-btn');
  const syncText = document.getElementById('sync-text');
  
  syncBtn.disabled = true;
  syncBtn.querySelector('span').style.animation = 'spin 1s linear infinite';
  syncText.textContent = 'Syncing...';

  try {
    const res = await apiCall('/api/gmail-sync', { method: 'POST' });
    syncText.textContent = 'Sync Complete!';
    
    if (res.processed > 0 || res.updates.length > 0) {
      alert(`Sync finished successfully!\nProcessed ${res.processed} messages. Found ${res.updates.length} updates.`);
    } else {
      // Toast notification style
      syncText.textContent = 'Inbox Stays Clean';
    }
    
    // Clear any reconnect error states on success
    document.getElementById('reconnect-btn').classList.add('hidden');
    
    loadData();
  } catch (error) {
    console.error('Sync failed:', error);
    if (error.message.includes('reconnect') || error.message.includes('OAuth')) {
      document.getElementById('reconnect-btn').classList.remove('hidden');
      alert('Gmail access needs re-authentication. Click the Reconnect button.');
    } else {
      alert(`Sync failed: ${error.message}`);
    }
  } finally {
    setTimeout(() => {
      syncBtn.disabled = false;
      syncBtn.querySelector('span').style.animation = '';
      syncText.textContent = 'Sync Gmail';
    }, 2000);
  }
}

// Reconnect Gmail Button
function handleGmailReconnect() {
  // Direct back to our oauth endpoint which handles redirection to google consent screen
  window.location.href = '/api/auth?action=login';
}

// Modals Open/Close UI Helper
function openAddModal() {
  document.getElementById('modal-title').textContent = 'Add Job Application';
  document.getElementById('form-job-id').value = '';
  document.getElementById('job-form').reset();
  
  // Set default applied date to today
  document.getElementById('form-applied-at').value = new Date().toISOString().split('T')[0];
  document.getElementById('form-status').value = 'applied';
  
  document.getElementById('job-modal').classList.add('active');
}

function openEditModal() {
  if (!currentJob) return;
  
  document.getElementById('modal-title').textContent = 'Edit Job Application';
  document.getElementById('form-job-id').value = currentJob.id;
  
  document.getElementById('form-company').value = currentJob.company || '';
  document.getElementById('form-role').value = currentJob.role_title || '';
  document.getElementById('form-status').value = currentJob.status || 'applied';
  document.getElementById('form-applied-at').value = currentJob.applied_at || '';
  document.getElementById('form-source').value = currentJob.source || '';
  document.getElementById('form-url').value = currentJob.url || '';
  document.getElementById('form-location').value = currentJob.location || '';
  document.getElementById('form-salary').value = currentJob.salary || '';
  document.getElementById('form-contact').value = currentJob.contact || '';
  document.getElementById('form-notes').value = currentJob.notes || '';
  document.getElementById('form-description').value = currentJob.description || '';
  document.getElementById('form-requirements').value = currentJob.requirements || '';

  document.getElementById('job-modal').classList.add('active');
}

function closeModal() {
  document.getElementById('job-modal').classList.remove('active');
}

function closeSheet() {
  document.getElementById('detail-sheet').classList.remove('active');
  currentJob = null;
}

// Delete job handler
async function handleDeleteJob() {
  if (!currentJob) return;
  if (!confirm(`Are you sure you want to delete the application for ${currentJob.company}?`)) return;

  try {
    await apiCall(`/api/applications?id=${currentJob.id}`, { method: 'DELETE' });
    closeSheet();
    loadData();
  } catch (error) {
    alert(`Failed to delete application: ${error.message}`);
  }
}

// Utility
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

// Listeners Setup
document.addEventListener('DOMContentLoaded', () => {
  // Load Initial Data
  loadData();
  initDragAndDrop();

  // Listeners Setup
  document.getElementById('tab-btn-board').addEventListener('click', () => switchTab('board'));
  document.getElementById('tab-btn-prep').addEventListener('click', () => switchTab('prep'));

  const prepSearch = document.getElementById('prep-search-input');
  if (prepSearch) {
    prepSearch.addEventListener('input', renderPrepTab);
  }

  // Modal Open Buttons
  document.getElementById('add-job-btn').addEventListener('click', openAddModal);
  
  // Sheet actions
  document.getElementById('edit-job-btn-sheet').addEventListener('click', openEditModal);
  document.getElementById('delete-job-btn-sheet').addEventListener('click', handleDeleteJob);

  // Close buttons
  document.getElementById('close-modal-btn').addEventListener('click', closeModal);
  document.getElementById('cancel-modal-btn').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', closeModal);

  document.getElementById('close-sheet-btn').addEventListener('click', closeSheet);
  document.getElementById('sheet-overlay').addEventListener('click', closeSheet);

  document.getElementById('close-event-modal-btn').addEventListener('click', () => {
    document.getElementById('event-modal').classList.remove('active');
  });
  document.getElementById('cancel-event-modal-btn').addEventListener('click', () => {
    document.getElementById('event-modal').classList.remove('active');
  });
  document.getElementById('event-modal-overlay').addEventListener('click', () => {
    document.getElementById('event-modal').classList.remove('active');
  });

  // Submit forms
  document.getElementById('job-form').addEventListener('submit', handleJobFormSubmit);
  document.getElementById('event-form').addEventListener('submit', handleEventFormSubmit);

  // Sync / Reconnect
  document.getElementById('sync-btn').addEventListener('click', handleGmailSync);
  document.getElementById('reconnect-btn').addEventListener('click', handleGmailReconnect);
  
  // Setup auto refresh every 5 minutes
  setInterval(loadData, 5 * 60 * 1000);

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('ServiceWorker registered:', reg.scope))
        .catch(err => console.warn('ServiceWorker registration failed:', err));
    });
  }
});
