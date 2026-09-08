const $ = (selector) => document.querySelector(selector);
const views = document.querySelectorAll('.view');
const navLinks = document.querySelectorAll('.nav-link');
const modal = $('#auth-modal');
const adminModal = $('#admin-modal');
const escapeHtml = (str) =>
  String(str || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
let pendingUrl = '';
let project = null;
let templateAssets = {};
let token = localStorage.getItem('r2s_token');
let currentUser = null;
let synopsisAbortController = null;
try {
  currentUser = JSON.parse(localStorage.getItem('r2s_user') || 'null');
} catch (_) {
  currentUser = null;
}
let authMode = 'register';

const documents = [['README', 'A polished project overview for your GitHub repository.'], ['API documentation', 'Endpoints, requests, responses, and auth requirements.'], ['User manual', 'Task-based instructions for end users.'], ['Installation guide', 'Local setup and environment configuration.'], ['Deployment guide', 'Production deployment checklist and operational notes.'], ['Developer documentation', 'Architecture, modules, and contribution guide.']];
const vivaQuestions = [['What problem does this project solve?', 'It reduces the time needed to turn a code repository into structured project documentation.'], ['Why is MongoDB used?', 'MongoDB stores project analysis, generated documentation, and user workspace records.'], ['How is the admin area secured?', 'The API validates a JWT and checks the user role before allowing admin routes.']];

function requireAuth(message) {
  if (!token) {
    if (message) {
      $('#synopsis-message').textContent = message;
      $('#form-message').textContent = message;
    }
    openAuth('login');
    return false;
  }
  return true;
}

function showView(id) {
  if (id === 'admin') {
    const isAdmin = currentUser && currentUser.role === 'admin' && Boolean(token);
    if (!isAdmin) {
      $('#admin-gate')?.classList.remove('hidden');
      $('#admin-content')?.classList.add('hidden');
      $('#page-title').textContent = 'Admin Access Restricted';
      openAdminModal();
    } else {
      $('#admin-gate')?.classList.add('hidden');
      $('#admin-content')?.classList.remove('hidden');
      $('#page-title').textContent = 'Platform Administration';
      loadAdminStats();
      loadAdminUsers();
    }
  } else {
    $('#page-title').textContent = id === 'workspace' ? 'Build your project report' : id.replace(/^./, (c) => c.toUpperCase());
  }
  views.forEach((view) => view.classList.toggle('active', view.id === id));
  navLinks.forEach((link) => link.classList.toggle('active', link.dataset.view === id));
}
function details() {
  const projectType = $('#project-type').value;
  const groupMembers = projectType === 'group' ? [...document.querySelectorAll('[data-group-member]')].map((member) => ({ name: member.querySelector('.group-member-name').value.trim(), rollNo: member.querySelector('.group-member-roll').value.trim() })).filter((member) => member.name || member.rollNo) : [];
  return {
    collegeName: $('#college-name').value.trim(),
    universityName: $('#university-name')?.value.trim() || '',
    courseName: $('#course-name')?.value.trim() || '',
    projectName: $('#project-name').value.trim(),
    projectType,
    studentName: $('#student-name').value.trim(),
    rollNo: $('#roll-no').value.trim(),
    enrollmentNo: $('#enrollment-no')?.value.trim() || $('#roll-no').value.trim(),
    groupMembers,
    teacherName: $('#teacher-name').value.trim(),
    academicYear: $('#academic-year').value.trim()
  };
}
function authHeaders() { return { Authorization: `Bearer ${token}` }; }
function requireProject(message) { if (!project) { $('#synopsis-message').textContent = message; showView('workspace'); return false; } return true; }

navLinks.forEach((link) => link.addEventListener('click', () => showView(link.dataset.view)));

function openAuth(mode) {
  authMode = mode;
  const isLogin = mode === 'login';
  $('#tab-login')?.classList.toggle('active', isLogin);
  $('#tab-register')?.classList.toggle('active', !isLogin);
  $('#auth-title').textContent = isLogin ? 'Sign In to Your Workspace' : 'Create Free Account';
  $('#auth-submit').textContent = isLogin ? 'Sign In' : 'Create Account';
  $('#auth-helper').textContent = isLogin ? 'Enter your registered email and password to download PDF & save data.' : 'Create an account to save analyses, generate 35-40 page reports, and export PDF.';
  $('#auth-name-group')?.classList.toggle('hidden', isLogin);
  const nameInput = $('#auth-name');
  if (nameInput) {
    nameInput.required = !isLogin;
    nameInput.classList.toggle('hidden', isLogin);
  }
  const passLabel = $('label[for="auth-password"]');
  if (passLabel) passLabel.textContent = isLogin ? 'Secure Password' : 'Password (min 8 chars & symbol)';
  const alertEl = $('#auth-alert');
  if (alertEl) {
    alertEl.classList.add('hidden');
    alertEl.textContent = '';
  }
  modal.classList.add('show');
  setTimeout(() => {
    if (isLogin) {
      $('#auth-email')?.focus();
    } else {
      $('#auth-name')?.focus();
    }
  }, 100);
}

$('#tab-login')?.addEventListener('click', () => openAuth('login'));
$('#tab-register')?.addEventListener('click', () => openAuth('register'));

function setSignedIn(user) {
  currentUser = user;
  localStorage.setItem('r2s_user', JSON.stringify({ name: user.name, email: user.email, role: user.role }));
  $('#guest-actions')?.classList.add('hidden');
  $('#account-summary')?.classList.remove('hidden');
  $('#account-name').textContent = user.name || user.email || 'Workspace';
  const isAdmin = user && user.role === 'admin';
  if (isAdmin && $('#admin')?.classList.contains('active')) {
    showView('admin');
  }
}

function setSignedOut() {
  localStorage.removeItem('r2s_token');
  localStorage.removeItem('r2s_user');
  token = null;
  currentUser = null;
  $('#guest-actions')?.classList.remove('hidden');
  $('#account-summary')?.classList.add('hidden');
}

function openAdminModal() {
  const err = $('#admin-login-error');
  if (err) {
    err.classList.add('hidden');
    err.textContent = '';
  }
  adminModal?.classList.add('show');
  $('#admin-email')?.focus();
}

function closeAdminModal() {
  adminModal?.classList.remove('show');
}

$('#admin-modal-close')?.addEventListener('click', closeAdminModal);
adminModal?.addEventListener('click', (e) => {
  if (e.target === adminModal) closeAdminModal();
});

$('#nav-admin')?.addEventListener('click', (e) => {
  e.preventDefault();
  const isAdmin = currentUser && currentUser.role === 'admin' && Boolean(token);
  if (isAdmin) {
    showView('admin');
  } else {
    openAdminModal();
  }
});

if (token) {
  if (currentUser) {
    setSignedIn(currentUser);
  }
  fetch('/api/auth/me', { headers: authHeaders() })
    .then((response) => {
      if (response.ok) return response.json();
      throw new Error(String(response.status));
    })
    .then(setSignedIn)
    .catch((err) => {
      if (err && (err.message === '401' || err.message === '403')) {
        setSignedOut();
      }
    });
} else {
  setSignedOut();
}

$('#login-button').addEventListener('click', () => openAuth('login'));
$('#register-button').addEventListener('click', () => openAuth('register'));
$('#admin-login-btn')?.addEventListener('click', () => openAdminModal());

$('#admin-login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = $('#admin-login-error');
  const submitBtn = $('#admin-submit');
  if (errorEl) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
  }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Verifying Credentials...';

  try {
    const email = $('#admin-email').value.trim();
    const password = $('#admin-password').value;
    const credentialKey = $('#admin-key').value.trim();

    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, credentialKey })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Access Forbidden: Invalid administrator credentials.');
    }

    token = data.token;
    localStorage.setItem('r2s_token', token);
    setSignedIn(data.user);
    closeAdminModal();
    showView('admin');
    loadAdminStats();
    loadAdminUsers();
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message || 'Verification failed. Access Forbidden.';
      errorEl.classList.remove('hidden');
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Verify & Access Dashboard';
  }
});

$('#logout-button').addEventListener('click', () => {
  setSignedOut();
  project = null;
  showView('workspace');
});

function addGroupMember() {
  const member = document.createElement('div');
  member.className = 'group-member-row'; member.dataset.groupMember = 'true';
  member.innerHTML = '<input class="group-member-name" placeholder="Group member name"><input class="group-member-roll" placeholder="Group member roll number"><button class="icon-button remove-group-member" type="button" aria-label="Remove group member">Remove</button>';
  $('#group-member-fields').append(member);
}
function updateProjectType() {
  const isGroup = $('#project-type').value === 'group';
  $('#group-members').classList.toggle('hidden', !isGroup);
  if (isGroup && !document.querySelector('[data-group-member]')) addGroupMember();
}
$('#project-type').addEventListener('change', updateProjectType);
$('#add-group-member').addEventListener('click', addGroupMember);
$('#group-member-fields').addEventListener('click', (event) => { if (event.target.matches('.remove-group-member')) event.target.closest('[data-group-member]').remove(); });

function validateCoverDetails() {
  const fields = [
    { id: '#college-name', name: 'College Name' },
    { id: '#university-name', name: 'University Name' },
    { id: '#course-name', name: 'Course / Degree' },
    { id: '#project-name', name: 'Project Name' },
    { id: '#student-name', name: 'Candidate Name' },
    { id: '#roll-no', name: 'Roll Number' },
    { id: '#enrollment-no', name: 'Enrollment Number' },
    { id: '#teacher-name', name: 'Faculty Guide / Supervisor' },
    { id: '#academic-year', name: 'Academic Session' }
  ];

  let firstEmpty = null;
  for (const f of fields) {
    const el = $(f.id);
    if (!el || !el.value.trim()) {
      el?.classList.add('input-error');
      if (!firstEmpty) firstEmpty = { el, name: f.name };
    } else {
      el.classList.remove('input-error');
    }
  }

  if (firstEmpty) {
    firstEmpty.el.focus();
    firstEmpty.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#form-message').textContent = `⚠️ Required: Please fill "${firstEmpty.name}" in Step 1 before analyzing repository.`;
    return false;
  }
  return true;
}

// Clear error style on input
['#college-name', '#university-name', '#course-name', '#project-name', '#student-name', '#roll-no', '#enrollment-no', '#teacher-name', '#academic-year'].forEach((id) => {
  $(id)?.addEventListener('input', (e) => {
    if (e.target.value.trim()) e.target.classList.remove('input-error');
  });
});

$('#analyze-form').addEventListener('submit', (event) => {
  event.preventDefault();
  
  if (!validateCoverDetails()) return;

  pendingUrl = $('#repository-url').value.trim();
  if (!token) {
    $('#form-message').textContent = 'Please sign in to analyze repository and generate your synopsis.';
    return openAuth('login');
  }
  
  $('#step-badge-1')?.classList.add('done');
  $('#step-badge-2')?.classList.add('active');
  analyzeRepository();
});

$('.close-modal')?.addEventListener('click', () => modal.classList.remove('show'));
modal?.addEventListener('click', (e) => {
  if (e.target === modal) modal.classList.remove('show');
});

$('#forgot-password-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  alert('Contact the administrator (krishnakushwaha123kk@gmail.com) to reset password.');
});

$('#auth-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitBtn = $('#auth-submit');
  const alertEl = $('#auth-alert');
  const originalText = submitBtn.textContent;

  const body = {
    name: $('#auth-name')?.value.trim() || '',
    email: $('#auth-email')?.value.trim().toLowerCase() || '',
    password: $('#auth-password')?.value || ''
  };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) {
    if (alertEl) {
      alertEl.className = 'auth-alert error';
      alertEl.textContent = 'Please enter a valid email address.';
      alertEl.classList.remove('hidden');
    }
    return;
  }

  if (authMode !== 'login') {
    if (body.password.length < 8) {
      if (alertEl) {
        alertEl.className = 'auth-alert error';
        alertEl.textContent = 'Password must be at least 8 characters long.';
        alertEl.classList.remove('hidden');
      }
      return;
    }
    if (!/[^a-zA-Z0-9]/.test(body.password)) {
      if (alertEl) {
        alertEl.className = 'auth-alert error';
        alertEl.textContent = 'Password must contain at least one special symbol (e.g. @, #, $, !).';
        alertEl.classList.remove('hidden');
      }
      return;
    }
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing...';
  if (alertEl) {
    alertEl.classList.add('hidden');
    alertEl.textContent = '';
  }
  const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/signup';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      const msg = data.message || 'Unable to authenticate. Please check your credentials.';
      if (alertEl) {
        alertEl.className = 'auth-alert error';
        alertEl.textContent = msg;
        alertEl.classList.remove('hidden');
      } else {
        alert(msg);
      }
      return;
    }
    token = data.token;
    localStorage.setItem('r2s_token', token);
    localStorage.setItem('r2s_user', JSON.stringify(data.user));
    modal.classList.remove('show');
    setSignedIn(data.user);
    if (pendingUrl && validateCoverDetails()) analyzeRepository();
  } catch (err) {
    const errMessage = err.message || 'Network error during authentication.';
    if (alertEl) {
      alertEl.className = 'auth-alert error';
      alertEl.textContent = errMessage;
      alertEl.classList.remove('hidden');
    } else {
      alert(errMessage);
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

const CHAPTERS = [
  { index: 1, name: 'Abstract' },
  { index: 2, name: 'Introduction of the Project' },
  { index: 3, name: 'Objective & Key Features' },
  { index: 4, name: 'Project Category & Beneficiary' },
  { index: 5, name: 'Feasibility Study' },
  { index: 6, name: 'Methodology Used & Planning Work' },
  { index: 7, name: 'Tools & Technologies Used' },
  { index: 8, name: 'Platform Used' },
  { index: 9, name: 'Module Description' },
  { index: 10, name: 'System Design (DFD & ER Diagram)' },
  { index: 11, name: 'Data Tables' },
  { index: 12, name: 'Future Scope' },
  { index: 13, name: 'Conclusion' },
  { index: 14, name: 'Bibliography' }
];

let chapterStates = {};

function initChapterQueue() {
  CHAPTERS.forEach((c) => {
    chapterStates[c.index] = 'queued';
  });
  renderChapterQueue();
}

function renderChapterQueue() {
  const container = $('#chapter-queue-grid');
  if (!container) return;
  container.innerHTML = CHAPTERS.map((c) => {
    const state = chapterStates[c.index] || 'queued';
    const num = String(c.index).padStart(2, '0');
    const label = state === 'done' ? 'Done ✓' : state === 'generating' ? 'Generating...' : 'Queued';
    const pillClass = `status-${state}`;
    return `<div class="chapter-queue-item ${state}">
      <span><strong>${num}</strong> ${c.name}</span>
      <span class="chapter-status-pill ${pillClass}">${label}</span>
    </div>`;
  }).join('');
}

function updatePageCounter() {
  const text = $('#synopsis-editor').innerText || '';
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  // An average A4 formatted thesis page with diagrams/tables holds ~300-350 words + chapter breaks
  const estPages = Math.max(1, Math.round(words / 320) + 4); // +4 for Cover, TOC, Diagrams
  $('#page-counter').textContent = `${words.toLocaleString()} Words | ~${estPages} A4 Pages`;
}

async function analyzeRepository() {
  $('#form-message').textContent = 'Inspecting repository structure and dependencies...';
  try {
    const response = await fetch('/api/projects/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ repositoryUrl: pendingUrl })
    });
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      throw new Error('Server returned an invalid response. Please sign in or check server connection.');
    }

    if (!response.ok) {
      if (response.status === 401) {
        setSignedOut();
        openAuth('login');
        throw new Error('Your session has expired. Please sign in again.');
      }
      throw new Error(data.message || 'Analysis failed. Please check the repository URL.');
    }

    project = data;
    $('#project-name').value = data.name;
    fillAnalysis(data.analysis);
    fillDraft(data);
    initChapterQueue();
    if ($('#chapter-progress-bar')) $('#chapter-progress-bar').style.width = '0%';
    if ($('#page-counter')) $('#page-counter').textContent = 'Target: 35-40 A4 Pages';
    $('#step-badge-1')?.classList.add('done');
    $('#step-badge-2')?.classList.add('done');
    $('#step-badge-3')?.classList.add('active');
    $('#form-message').textContent = `Analysis complete: ${data.name} is ready.`;
    showView('analysis');
  } catch (error) {
    $('#form-message').textContent = error.message || 'Analysis failed. Please try again.';
  }
}

function fillAnalysis(analysis) {
  $('#file-count').textContent = analysis.files;
  $('#language-count').textContent = analysis.languages.length;
  $('#module-count').textContent = analysis.modules.length;
  $('#stack-tags').innerHTML = analysis.stack.map((item) => `<span>${item}</span>`).join('');
  $('#architecture').textContent = analysis.architecture;
  $('#module-list').innerHTML = analysis.modules.map((item) => `<li>${item}</li>`).join('');
}

function fillDraft(data) {
  initChapterQueue();
  $('#synopsis-editor').innerHTML = `<h2>${data.name}: Major Project Synopsis</h2><p>Click <strong>Generate Full 35-40 Page Report</strong> to create all 12 chapters with deep engineering analysis, flowcharts, schemas, and IEEE bibliography.</p>`;
}

async function uploadTemplates() {
  const logo = $('#college-logo').files[0];
  const cover = $('#cover-template').files[0];
  if (!logo && !cover) return templateAssets;
  const asDataUrl = (file) => new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const response = await fetch('/api/uploads/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ logo: await asDataUrl(logo), cover: await asDataUrl(cover) })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Template upload failed.');
  templateAssets = { ...templateAssets, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value).map(([key, value]) => [key, new URL(value, window.location.origin).href])) };
  return templateAssets;
}

$('#generate-synopsis').addEventListener('click', async () => {
  if (!requireAuth('Please sign in or create an account to generate and save your report.')) return;
  if (!requireProject('Analyze a repository before generating the synopsis.')) return;
  const btn = $('#generate-synopsis');
  const stopBtn = $('#stop-synopsis');
  btn.disabled = true;
  stopBtn?.classList.remove('hidden');
  synopsisAbortController = new AbortController();
  const { signal } = synopsisAbortController;

  $('#synopsis-message').textContent = 'Starting 12-Chapter generation pipeline...';
  $('#synopsis-editor').innerHTML = '';
  
  try {
    await uploadTemplates();
    const total = CHAPTERS.length;
    let combinedHtml = '';

    for (let i = 0; i < total; i++) {
      if (signal.aborted) {
        throw new Error('Generation stopped by user.');
      }
      const chapter = CHAPTERS[i];
      chapterStates[chapter.index] = 'generating';
      renderChapterQueue();
      $('#chapter-progress-bar').style.width = `${Math.round(((i) / total) * 100)}%`;
      $('#synopsis-message').textContent = `Generating Chapter ${chapter.index}/${total}: ${chapter.name}...`;

      let data;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (signal.aborted) {
          throw new Error('Generation stopped by user.');
        }
        try {
          const response = await fetch(`/api/projects/${project._id}/synopsis/chapter`, {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
              chapterIndex: chapter.index,
              details: details(),
              template: { hasLogo: Boolean(templateAssets.logo), hasCover: Boolean(templateAssets.cover) }
            })
          });

          const text = await response.text();
          try {
            data = JSON.parse(text);
          } catch (_) {
            throw new Error(`Server returned invalid response for Chapter ${chapter.index}`);
          }

          if (!response.ok) throw new Error(data.message || `Failed generating chapter ${chapter.index}`);
          break;
        } catch (chapterErr) {
          if (signal.aborted || chapterErr.name === 'AbortError' || chapterErr.message?.includes('stopped by user')) {
            throw new Error('Generation stopped by user.');
          }
          if (attempt === 3) throw chapterErr;
          $('#synopsis-message').textContent = `Buffering Chapter ${chapter.index} (attempt ${attempt}/3): ${chapterErr.message}...`;
          await new Promise((r) => setTimeout(r, 3000 * attempt));
        }
      }

      combinedHtml += `${data.content}\n\n`;
      $('#synopsis-editor').innerHTML = combinedHtml;
      chapterStates[chapter.index] = 'done';
      renderChapterQueue();
      updatePageCounter();
      $('#chapter-progress-bar').style.width = `${Math.round(((i + 1) / total) * 100)}%`;

      // Small pacing pause between chapters to respect API rate limits
      if (i < total - 1) {
        if (signal.aborted) throw new Error('Generation stopped by user.');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (signal.aborted) throw new Error('Generation stopped by user.');

    // Save final document
    await fetch(`/api/projects/${project._id}/documents`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ documents: { ...project.documents, synopsis: combinedHtml, details: details(), assets: templateAssets } })
    });

    $('#synopsis-message').textContent = 'Full Major Project Report (35-40 pages) generated! You can edit or download PDF.';
  } catch (error) {
    if (error.name === 'AbortError' || error.message?.includes('stopped by user')) {
      $('#synopsis-message').textContent = 'Generation stopped by user. Progress halted.';
    } else {
      $('#synopsis-message').textContent = error.message || 'Generation failed.';
    }
  } finally {
    btn.disabled = false;
    stopBtn?.classList.add('hidden');
    CHAPTERS.forEach((c) => {
      if (chapterStates[c.index] === 'generating') {
        chapterStates[c.index] = 'waiting';
      }
    });
    renderChapterQueue();
    synopsisAbortController = null;
  }
});

$('#stop-synopsis')?.addEventListener('click', () => {
  if (synopsisAbortController) {
    $('#synopsis-message').textContent = 'Stopping generation pipeline...';
    synopsisAbortController.abort();
  }
});

$('#export-pdf').addEventListener('click', async () => {
  if (!requireAuth('Please sign in or create an account to download your submission-ready PDF.')) return;
  if (!requireProject('Analyze a repository before downloading a PDF.')) return;
  $('#synopsis-message').textContent = 'Compiling 35-40 page formatted PDF with diagrams...';
  try {
    await uploadTemplates();
    const response = await fetch(`/api/projects/${project._id}/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        synopsis: $('#synopsis-editor').innerHTML,
        details: details(),
        assets: templateAssets
      })
    });
    if (!response.ok) { const error = await response.json(); throw new Error(error.message); }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: `${details().projectName || project.name}-major-synopsis.pdf`
    });
    link.click();
    URL.revokeObjectURL(url);
    $('#synopsis-message').textContent = 'Submission PDF downloaded successfully.';
  } catch (error) {
    $('#synopsis-message').textContent = error.message || 'PDF export failed.';
  }
});

initChapterQueue();

documents.forEach(([name, description]) => {
  $('#document-grid').insertAdjacentHTML('beforeend', `<article><span class="number">DOCUMENT</span><h3>${name}</h3><p>${description}</p><button class="generate-doc" data-name="${name}">Generate with AI</button></article>`);
});

function renderVivaList(list) {
  $('#viva-list').innerHTML = list.map((item) => `<details><summary>${item.question}</summary><p>${item.answer}</p></details>`).join('');
}
renderVivaList(vivaQuestions.map(([question, answer]) => ({ question, answer })));

$('#generate-viva-btn')?.addEventListener('click', async () => {
  if (!requireAuth('Please sign in to generate project-specific viva questions.')) return;
  if (!requireProject('Analyze a repository first to generate project-specific viva questions.')) return;
  $('#viva-status').textContent = 'Generating 10 tailored Viva questions and model answers with AI...';
  try {
    const response = await fetch(`/api/projects/${project._id}/viva`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Failed to generate viva questions.');
    if (Array.isArray(data.questions) && data.questions.length > 0) {
      renderVivaList(data.questions);
      $('#viva-status').textContent = 'Viva questions generated successfully based on your repository!';
    }
  } catch (error) {
    $('#viva-status').textContent = error.message || 'Viva generation failed.';
  }
});

document.addEventListener('click', async (event) => {
  if (event.target.matches('[data-command]')) {
    document.execCommand(event.target.dataset.command, false);
  }
  if (event.target.matches('.generate-doc')) {
    if (!requireAuth('Please sign in to generate modular documentation.')) return;
    const docName = event.target.dataset.name;
    if (!requireProject(`Analyze a repository first to generate ${docName}.`)) return;
    showView('synopsis');
    $('#synopsis-message').textContent = `Generating ${docName} with AI...`;
    $('#synopsis-editor').innerHTML = `<h2>${docName}</h2><p>Generating document content from repository metadata...</p>`;
    try {
      const response = await fetch(`/api/projects/${project._id}/doc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ docType: docName, details: details() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Documentation generation failed.');
      $('#synopsis-editor').innerHTML = data.content;
      $('#synopsis-message').textContent = `${docName} generated successfully. You can edit and export as PDF.`;
    } catch (error) {
      $('#synopsis-message').textContent = error.message || 'Failed to generate document.';
    }
  }
});

$('#shorten').addEventListener('click', () => {
  $('#synopsis-editor').innerHTML = $('#synopsis-editor').innerHTML.replace(/This synopsis presents[^<]+/, 'This synopsis documents the project.');
});
$('#expand').addEventListener('click', () => {
  $('#synopsis-editor').insertAdjacentHTML('beforeend', '<h3>Future Scope</h3><p>The platform can expand with advanced AI analysis, collaborative editing, and institution-specific templates.</p>');
});
$('#copy-synopsis').addEventListener('click', () => {
  navigator.clipboard.writeText($('#synopsis-editor').innerText);
  alert('Synopsis copied to clipboard!');
});
$('#download-synopsis').addEventListener('click', () => {
  const blob = new Blob([$('#synopsis-editor').innerText], { type: 'text/plain' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${details().projectName || 'project'}-synopsis.txt` });
  link.click();
  URL.revokeObjectURL(link.href);
});
async function loadAdminStats() {
  token = localStorage.getItem('r2s_token') || token;
  if (!currentUser) {
    const stored = localStorage.getItem('r2s_user');
    if (stored) { try { currentUser = JSON.parse(stored); } catch (_) {} }
  }
  if (!token || !currentUser || currentUser.role !== 'admin') return;
  try {
    const response = await fetch('/api/admin/stats', { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 403) {
        showView('admin');
      }
      return;
    }
    $('#admin-users').textContent = data.users;
    $('#admin-reports').textContent = data.reports;
    $('#admin-requests').textContent = data.apiRequests;
    $('#admin-prompts').textContent = data.prompts;
  } catch (_) {}
}

async function loadAdminUsers() {
  token = localStorage.getItem('r2s_token') || token;
  if (!currentUser) {
    const stored = localStorage.getItem('r2s_user');
    if (stored) { try { currentUser = JSON.parse(stored); } catch (_) {} }
  }
  if (!token || !currentUser || currentUser.role !== 'admin') return;
  const listEl = $('#admin-users-list');
  if (!listEl) return;
  try {
    const response = await fetch('/api/admin/users', { headers: authHeaders() });
    if (!response.ok) {
      listEl.innerHTML = '<tr><td colspan="6" style="padding: 16px; text-align: center; color: #e53e3e;">Failed to load registered users.</td></tr>';
      return;
    }
    const users = await response.json();
    if (!users || !users.length) {
      listEl.innerHTML = '<tr><td colspan="6" style="padding: 16px; text-align: center; color: var(--muted);">No registered users found.</td></tr>';
      return;
    }
    listEl.innerHTML = users.map((u) => `
      <tr style="border-bottom: 1px solid var(--border, #e2e8f0);">
        <td style="padding: 10px 8px; font-family: monospace; font-size: 0.8rem; color: var(--primary); cursor: pointer;" title="Click to fill User ID" onclick="if(document.getElementById('admin-change-user-id')) document.getElementById('admin-change-user-id').value='${u._id}'">${escapeHtml(String(u._id || ''))}</td>
        <td style="padding: 10px 8px; font-weight: 600;">${escapeHtml(u.name || 'Anonymous')}</td>
        <td style="padding: 10px 8px;">${escapeHtml(u.email || '--')}</td>
        <td style="padding: 10px 8px;">
          <span style="font-size: 0.78rem; padding: 2px 8px; border-radius: 4px; font-weight: 600; ${u.role === 'admin' ? 'background: #fed7d7; color: #c53030;' : 'background: #e2e8f0; color: #4a5568;'}">${escapeHtml(u.role || 'user')}</span>
        </td>
        <td style="padding: 10px 8px; font-weight: 600;">${u.apiRequests || 0} reqs</td>
        <td style="padding: 10px 8px; color: var(--muted); font-size: 0.82rem;">${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '--'}</td>
      </tr>
    `).join('');
  } catch (_) {
    listEl.innerHTML = '<tr><td colspan="6" style="padding: 16px; text-align: center; color: #e53e3e;">Network error fetching registered users.</td></tr>';
  }
}

$('#load-admin')?.addEventListener('click', async () => {
  token = localStorage.getItem('r2s_token') || token;
  if (!currentUser) {
    const stored = localStorage.getItem('r2s_user');
    if (stored) { try { currentUser = JSON.parse(stored); } catch (_) {} }
  }

  if (!token || !currentUser || currentUser.role !== 'admin') {
    openAdminModal();
    return;
  }

  const btn = $('#load-admin');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('is-refreshing');
  btn.innerHTML = '<span class="spinner-icon"></span> Refreshing...';

  try {
    await Promise.all([loadAdminStats(), loadAdminUsers()]);
    btn.innerHTML = '✓ Refreshed!';
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
      btn.classList.remove('is-refreshing');
    }, 1500);
  } catch (_) {
    btn.innerHTML = 'Refresh Failed';
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
      btn.classList.remove('is-refreshing');
    }, 1800);
  }
});

$('#admin-change-pass-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = $('#admin-change-user-id')?.value.trim();
  const newPass = $('#admin-change-new-pass')?.value || '';
  const msgEl = $('#admin-change-pass-msg');
  const btn = $('#admin-change-pass-btn');

  if (!userId) {
    if (msgEl) {
      msgEl.textContent = 'Please enter a User ID.';
      msgEl.style.color = '#ef4444';
      msgEl.classList.remove('hidden');
    }
    return;
  }

  if (newPass.length < 8 || !/[^a-zA-Z0-9]/.test(newPass)) {
    if (msgEl) {
      msgEl.textContent = 'Password must be at least 8 characters and contain at least 1 special symbol.';
      msgEl.style.color = '#ef4444';
      msgEl.classList.remove('hidden');
    }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Updating...';

  try {
    const res = await fetch(`/api/admin/users/${userId}/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ password: newPass })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Failed to update user password.');
    if (msgEl) {
      msgEl.textContent = data.message || 'Password updated successfully!';
      msgEl.style.color = '#10b981';
      msgEl.classList.remove('hidden');
    }
    $('#admin-change-new-pass').value = '';
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = err.message || 'Error updating password.';
      msgEl.style.color = '#ef4444';
      msgEl.classList.remove('hidden');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Change Password';
  }
});
