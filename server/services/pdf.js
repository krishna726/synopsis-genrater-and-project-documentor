const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');

const run = promisify(execFile);

function escape(text = '') {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
}

function cleanHtml(raw = '') {
  return String(raw)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '');
}

function diagram(title, nodes) {
  const width = Math.max(600, nodes.length * 150);
  const boxes = nodes.map((node, index) => {
    const x = 25 + index * 145;
    return `<g>
      <rect x="${x}" y="65" width="120" height="48" rx="4" fill="#f4faf7" stroke="#0d7569" stroke-width="1.2"/>
      <text x="${x + 60}" y="94" text-anchor="middle" font-size="10.5" font-family="'Segoe UI', Arial, sans-serif" font-weight="600" fill="#16322a">${escape(node)}</text>
      ${index < nodes.length - 1 ? `<path d="M${x + 120} 89h25" stroke="#0d7569" stroke-width="1.2" marker-end="url(#a)"/>` : ''}
    </g>`;
  }).join('');

  return `<div class="diagram">
    <h3>${escape(title)}</h3>
    <svg viewBox="0 0 ${width} 150" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="a" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#0d7569"/>
        </marker>
      </defs>
      <rect width="100%" height="100%" fill="#ffffff" />
      <text x="25" y="32" font-size="12" font-weight="700" font-family="'Segoe UI', Arial, sans-serif" fill="#0d7569">${escape(title)}</text>
      ${boxes}
    </svg>
  </div>`;
}

function chromePath() {
  const home = os.homedir();
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(home, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(home, 'AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'),
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    path.join(home, 'AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ];
  return candidates.find((c) => c && fsSync.existsSync(c));
}

async function resolveAssetDataUrl(source) {
  if (!source) return '';
  if (source.startsWith('data:image/')) return source;
  try {
    const uploadMatch = source.match(/\/uploads\/([^/?#]+)$/);
    if (uploadMatch) {
      const filePath = path.join(__dirname, '../uploads', uploadMatch[1]);
      if (fsSync.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        const buffer = await fs.readFile(filePath);
        return `data:${mime};base64,${buffer.toString('base64')}`;
      }
    }
  } catch (_) {}
  return source;
}

async function defaultCollegeLogo() {
  try {
    const candidatePaths = [
      path.join(__dirname, '../../client/image.png'),
      path.join(process.cwd(), 'client/image.png'),
      path.join(__dirname, '../uploads/image.png')
    ];
    for (const p of candidatePaths) {
      if (fsSync.existsSync(p)) {
        const image = await fs.readFile(p);
        return `data:image/png;base64,${image.toString('base64')}`;
      }
    }
    return '';
  } catch (_) {
    return '';
  }
}

async function createPdf({ project, synopsis, details, assets = {} }) {
  const chrome = chromePath();
  if (!chrome) {
    throw new Error('No compatible Chromium browser found (Google Chrome or Microsoft Edge). Please install Chrome or set CHROME_PATH in your .env file.');
  }

  const rawModules = (project.analysis?.modules || []).filter(Boolean);
  const rawStack = (project.analysis?.stack || []).filter(Boolean);

  const m1 = rawModules[0] || 'Presentation UI';
  const m2 = rawModules[1] || 'API Controller';
  const m3 = rawModules[2] || 'Business Logic';
  const m4 = rawModules[3] || 'Data Layer';

  const dbName = rawStack.includes('MongoDB') ? 'MongoDB Atlas' : rawStack.includes('PostgreSQL') ? 'PostgreSQL' : rawStack.includes('MySQL') ? 'MySQL' : 'Data Store';

  const archNodes = ['Client User', (project.name || 'Web App').slice(0, 18), m2.slice(0, 18), dbName];
  const dfdNodes = ['Visitor Request', m1.slice(0, 18), m2.slice(0, 18), dbName];
  const erNodes = [
    'User / Visitor',
    m2.replace(/API|Route|Endpoint/i, 'Transaction').trim() || 'Record Item',
    m3.replace(/Service|Engine|Logic/i, 'Core Entity').trim() || 'Data Model',
    'Activity Log'
  ];
  const useCaseNodes = ['End User', `Access ${m1.slice(0, 14)}`, `Execute ${m2.slice(0, 14)}`, `Persist in ${dbName.slice(0, 14)}`];

  const diagrams = [
    diagram('System Architecture Flow', archNodes),
    diagram('Data Flow Diagram (DFD Level 0)', dfdNodes),
    diagram('Entity Relationship (ER) Data Model', erNodes),
    diagram('Functional Use Case Execution', useCaseNodes)
  ].join('');

  const defaultImage = await defaultCollegeLogo();
  const logoRaw = assets.logo || defaultImage;
  const logoData = await resolveAssetDataUrl(logoRaw);

  const logo = logoData ? `<img class="cover-logo" src="${escape(logoData)}" alt="College Logo" />` : '';

  const course = details.courseName || 'Bachelor of Computer Applications (BCA)';
  const college = details.collegeName || 'dr vsips';
  const university = details.universityName || 'csjmu';
  const candidate = details.studentName || 'KRISHNA KUSHWAHA';
  const roll = details.rollNo || '241160034';
  const enrollment = details.enrollmentNo || details.rollNo || 'csjma24116003436';
  const guide = details.teacherName || 'dr.vsics';
  const projectTitle = details.projectName || project.name || 'MY-PROTFOLIO';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escape(projectTitle)} - Project Synopsis</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 18mm 15mm 18mm 15mm;
      @top-left {
        content: "${escape(projectTitle)}";
        font-size: 8pt;
        color: #555555;
        font-family: 'Times New Roman', Times, serif;
      }
      @top-right {
        content: "Major Project Synopsis";
        font-size: 8pt;
        color: #555555;
        font-family: 'Times New Roman', Times, serif;
      }
      @bottom-left {
        content: "${escape(college || 'Department of Computer Science')}";
        font-size: 8pt;
        color: #666666;
        font-family: 'Times New Roman', Times, serif;
      }
      @bottom-right {
        content: "Page " counter(page) " of " counter(pages);
        font-size: 8pt;
        color: #555555;
        font-family: 'Times New Roman', Times, serif;
      }
    }
    @page:first {
      @top-left { content: ""; }
      @top-right { content: ""; }
      @bottom-left { content: ""; }
      @bottom-right { content: ""; }
    }
    *, *::before, *::after {
      box-sizing: border-box !important;
      max-width: 100% !important;
    }
    html, body {
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      color: #111111 !important;
      font-family: 'Times New Roman', Times, serif !important;
      font-size: 11pt;
      line-height: 1.6;
      text-rendering: optimizeLegibility;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page-break {
      page-break-after: always;
      break-after: page;
    }
    .prelim-page {
      width: 100% !important;
      min-height: 245mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      text-align: center;
      page-break-after: always;
      break-after: page;
      padding: 6mm 5mm 4mm;
      font-family: 'Times New Roman', Times, serif;
    }
    .cover-project-label {
      font-size: 15pt;
      font-weight: 700;
      letter-spacing: 2px;
      margin: 0 0 14px;
      color: #111;
      text-transform: uppercase;
    }
    .cover-synopsis-label {
      font-size: 12pt;
      font-weight: 600;
      letter-spacing: 1.5px;
      margin: 0 0 12px;
      color: #222;
      text-transform: uppercase;
    }
    .cover-on-label {
      font-size: 11pt;
      font-weight: 600;
      letter-spacing: 1px;
      margin: 0 0 16px;
      color: #333;
      text-transform: uppercase;
    }
    .cover-title {
      font-size: 17pt;
      font-weight: 800;
      color: #111;
      letter-spacing: 0.8px;
      margin: 0 0 18px;
      line-height: 1.35;
      text-transform: uppercase;
    }
    .cover-subtext {
      font-size: 11pt;
      color: #333;
      margin: 0 0 4px;
      line-height: 1.4;
    }
    .cover-subtext-2 {
      font-size: 11pt;
      color: #333;
      margin: 0 0 12px;
    }
    .cover-course {
      font-size: 13.5pt;
      font-weight: 700;
      color: #111;
      margin: 0 0 20px;
    }
    .cover-by-label {
      font-size: 11pt;
      color: #333;
      margin: 0 0 6px;
    }
    .cover-candidate {
      font-size: 12.5pt;
      font-weight: 700;
      color: #111;
      letter-spacing: 0.5px;
      margin: 0 0 2px;
      text-transform: uppercase;
    }
    .cover-roll {
      font-size: 11pt;
      color: #222;
      margin: 0 0 18px;
    }
    .cover-guide-label {
      font-size: 11pt;
      color: #333;
      margin: 0 0 6px;
    }
    .cover-guide-name {
      font-size: 12pt;
      font-weight: 600;
      color: #111;
      margin: 0 0 20px;
    }
    .cover-logo-wrap {
      margin: 0 auto 14px;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .cover-logo {
      width: 88px;
      height: 88px;
      object-fit: contain;
      margin: 0 auto;
      display: block;
      border-radius: 50%;
    }
    .cover-college {
      font-size: 12.5pt;
      font-weight: 700;
      color: #111;
      margin: 0 0 8px;
      line-height: 1.35;
    }
    .cover-undertaken {
      font-size: 10.5pt;
      color: #444;
      margin: 0 0 8px;
    }
    .cover-university {
      font-size: 12.5pt;
      font-weight: 700;
      color: #111;
      margin: 0 0 10px;
      line-height: 1.35;
    }
    .cover-page-num {
      font-size: 10pt;
      color: #333;
      margin: 6px 0 0;
    }

    .doc-page {
      width: 100% !important;
      page-break-after: always;
      break-after: page;
      padding: 5mm 0;
    }
    .doc-heading {
      font-size: 18pt;
      font-weight: 800;
      text-align: center;
      margin-bottom: 25px;
      text-decoration: underline;
      color: #111;
    }
    .doc-text {
      text-align: justify;
      margin-bottom: 16px;
      line-height: 1.65;
      font-size: 11pt;
    }
    .doc-sign-block {
      margin-top: 40px;
      text-align: left;
      font-size: 11pt;
      line-height: 1.7;
    }
    .toc-title {
      font-size: 18pt;
      font-weight: 800;
      text-align: center;
      margin-bottom: 25px;
      text-decoration: underline;
      color: #111;
    }
    .toc-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .toc-list li {
      display: flex;
      align-items: baseline;
      font-size: 11pt;
      font-weight: 700;
      margin-bottom: 14px;
      color: #111;
    }
    .toc-list li.toc-sub {
      padding-left: 25px;
      font-weight: 400;
      font-size: 10.5pt;
      color: #333;
    }
    .toc-dots {
      flex: 1;
      border-bottom: 1px dotted #888888;
      margin: 0 8px;
    }
    .toc-num {
      font-weight: 700;
      color: #111;
      flex-shrink: 0;
    }

    h2 {
      font-size: 15pt;
      font-weight: 800;
      color: #111;
      margin-top: 24px;
      margin-bottom: 12px;
      page-break-before: always;
      break-before: page;
    }
    h3 {
      font-size: 12.5pt;
      font-weight: 700;
      color: #111;
      margin-top: 16px;
      margin-bottom: 8px;
    }
    h4 {
      font-size: 11.5pt;
      font-weight: 700;
      color: #222;
      margin-top: 12px;
      margin-bottom: 6px;
    }
    p {
      margin-top: 0;
      margin-bottom: 12px;
      text-align: justify;
      line-height: 1.6;
      word-break: break-word;
    }
    ul, ol {
      margin-top: 6px;
      margin-bottom: 14px;
      padding-left: 24px;
    }
    li {
      margin-bottom: 6px;
      text-align: justify;
    }
    table {
      width: 100% !important;
      max-width: 100% !important;
      table-layout: fixed !important;
      border-collapse: collapse !important;
      margin: 16px 0 !important;
      font-size: 9.5pt !important;
      page-break-inside: avoid !important;
    }
    table th, table td {
      border: 1px solid #ccdcd5 !important;
      padding: 6px 8px !important;
      text-align: left !important;
      vertical-align: top !important;
      word-break: break-word !important;
      overflow-wrap: anywhere !important;
    }
    table th {
      background: #fbfdfc !important;
      color: #333 !important;
      font-weight: 700 !important;
      text-transform: uppercase;
      font-size: 8.5pt;
      letter-spacing: 0.5px;
    }
    table tr:nth-child(even) {
      background: #fafafa !important;
    }
    .table-caption {
      font-weight: 700;
      color: #b35900;
      margin-top: 16px;
      margin-bottom: 4px;
      font-size: 11pt;
    }
    .table-sub-caption {
      font-style: italic;
      color: #555;
      font-size: 9.5pt;
      margin-bottom: 8px;
    }
    .diagram-wrap {
      width: 100%;
      text-align: center;
      margin: 16px 0;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .diagram-wrap svg {
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      display: block;
      margin: 0 auto;
      background: #ffffff !important;
    }
    .er-section, .er-heading, .diagram-er-wrap {
      page-break-before: always !important;
      break-before: page !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .diagram-caption {
      font-size: 10.5pt;
      font-weight: 700;
      color: #111;
      margin-top: 8px;
      margin-bottom: 18px;
      text-align: center;
      font-family: 'Times New Roman', Times, serif;
    }
  </style>
</head>
<body>
  <!-- PAGE 1: COVER PAGE -->
  <section class="prelim-page">
    <div>
      <p class="cover-project-label">PROJECT</p>
      <p class="cover-synopsis-label">SYNOPSIS</p>
      <p class="cover-on-label">ON</p>
      <h1 class="cover-title">${escape(projectTitle.toUpperCase())}</h1>
      <p class="cover-subtext">Submitted in partial fulfillment of the requirements for</p>
      <p class="cover-subtext-2">the award of</p>
      <p class="cover-course">${escape(course)}</p>
    </div>

    <div>
      <p class="cover-by-label">By</p>
      <p class="cover-candidate">${escape(candidate.toUpperCase())}</p>
      <p class="cover-roll">(${escape(roll || enrollment)})</p>
    </div>

    <div>
      <p class="cover-guide-label">Under the Guidance of</p>
      <p class="cover-guide-name">${escape(guide)}</p>
    </div>

    <div>
      <div class="cover-logo-wrap">${logo}</div>
      <p class="cover-college">${escape(college)}</p>
      <p class="cover-undertaken">undertaken at</p>
      <p class="cover-university">${escape(university)}</p>
      <p class="cover-page-num">1</p>
    </div>
  </section>

  <!-- PAGE 2: ACKNOWLEDGEMENT -->
  <section class="doc-page">
    <h2 class="doc-heading">Acknowledgement</h2>
    <p class="doc-text">I convey my sincere gratitude to "${escape(guide)}" for giving me the opportunity to prepare my project work on "${escape(projectTitle)}". This project would not have taken its present shape without the direction, patience, and encouragement I received throughout its preparation.</p>
    <p class="doc-text">I am thankful to "${escape(guide)}" for the technical guidance, timely feedback, and valuable time spared for reviewing my work at every stage, from problem identification to the final structuring of this synopsis.</p>
    <p class="doc-text">I express my sincere obligation and thanks to the Principal and all faculty members of ${escape(course)} at <b>${escape(college)}</b> for providing the guidance, infrastructure, motivation, and valuable advice necessary for completing this project work successfully.</p>
    <p class="doc-text">I would also like to acknowledge the support of my peers and family, whose encouragement made it possible to dedicate the time and focus this project required.</p>
    
    <div class="doc-sign-block">
      <p>Name: ${escape(candidate)}</p>
      <p>Roll No.: ${escape(roll)}</p>
      <p>Enrollment No.: ${escape(enrollment)}</p>
    </div>
  </section>

  <!-- PAGE 3: DECLARATION -->
  <section class="doc-page">
    <h2 class="doc-heading">Declaration</h2>
    <p class="doc-text">I do hereby declare that the project work entitled "${escape(projectTitle)}" submitted by me for the partial fulfilment of the requirement for the award of ${escape(course)}, is an authentic work completed by me under the guidance of ${escape(guide)}.</p>
    <p class="doc-text">The report being submitted has not been submitted earlier, either in part or in full, for the award of any degree or diploma to this or any other Institute or University.</p>
    <p class="doc-text">All sources of information used in this project, including textual, statistical, and design references, have been duly acknowledged in the bibliography.</p>
    
    <div class="doc-sign-block">
      <p>Name: ${escape(candidate)}</p>
      <p>Roll No.: ${escape(roll)}</p>
      <br>
      <p>Date: ${escape(new Date().toLocaleDateString('en-GB'))}</p>
    </div>
  </section>

  <!-- PAGE 4: CERTIFICATE OF ORIGINALITY -->
  <section class="doc-page">
    <h2 class="doc-heading">Certificate of Originality</h2>
    <p class="doc-text">This is to certify that the project report entitled "${escape(projectTitle)}" submitted to <b>${escape(college)}</b>, in partial fulfilment of the requirement for the award of ${escape(course)}, is an original work carried out by "${escape(candidate)}".</p>
    <p class="doc-text">${escape(candidate)} — Enrollment No.: "${escape(enrollment)}", Roll No.: "${escape(roll)}"</p>
    <p class="doc-text">The matter embodied in this project is genuine work done by the student and has not been submitted, whether in whole or in part, to this University or to any other University/Institute for the fulfilment of the requirement of any course of study.</p>
    <p class="doc-text">It is further certified that the student has completed this project under my supervision and that the work reflects an original understanding of the problem domain and its proposed solution.</p>
    
    <div class="doc-sign-block">
      <p>Name of Guide</p>
      <p><b>${escape(guide)}</b></p>
      <p>${escape(course)}</p>
    </div>
  </section>

  <!-- PAGE 5: TABLE OF CONTENTS -->
  <section class="doc-page">
    <h2 class="toc-title">Table of Contents</h2>
    <ul class="toc-list">
      <li><span class="toc-text">1. Abstract</span><span class="toc-dots"></span><span class="toc-num">06</span></li>
      <li><span class="toc-text">2. Introduction of the Project</span><span class="toc-dots"></span><span class="toc-num">06</span></li>
      <li class="toc-sub"><span class="toc-text">Problem Domain</span><span class="toc-dots"></span><span class="toc-num">07</span></li>
      <li class="toc-sub"><span class="toc-text">About the Project</span><span class="toc-dots"></span><span class="toc-num">07</span></li>
      <li><span class="toc-text">3. Objective & Key Features</span><span class="toc-dots"></span><span class="toc-num">10</span></li>
      <li><span class="toc-text">4. Project Category & Beneficiary</span><span class="toc-dots"></span><span class="toc-num">14</span></li>
      <li><span class="toc-text">5. Feasibility Study</span><span class="toc-dots"></span><span class="toc-num">15</span></li>
      <li><span class="toc-text">6. Methodology Used & Planning Work</span><span class="toc-dots"></span><span class="toc-num">19</span></li>
      <li><span class="toc-text">7. Tools & Technologies Used</span><span class="toc-dots"></span><span class="toc-num">23</span></li>
      <li><span class="toc-text">8. Platform Used</span><span class="toc-dots"></span><span class="toc-num">27</span></li>
      <li><span class="toc-text">9. Module Description</span><span class="toc-dots"></span><span class="toc-num">29</span></li>
      <li><span class="toc-text">10. System Design</span><span class="toc-dots"></span><span class="toc-num">32</span></li>
      <li class="toc-sub"><span class="toc-text">Data Flow Diagrams (0-Level & 1-Level)</span><span class="toc-dots"></span><span class="toc-num">33</span></li>
      <li class="toc-sub"><span class="toc-text">Entity-Relationship Diagram</span><span class="toc-dots"></span><span class="toc-num">34</span></li>
      <li><span class="toc-text">11. Data Tables</span><span class="toc-dots"></span><span class="toc-num">35</span></li>
      <li><span class="toc-text">12. Future Scope</span><span class="toc-dots"></span><span class="toc-num">40</span></li>
      <li><span class="toc-text">13. Conclusion</span><span class="toc-dots"></span><span class="toc-num">42</span></li>
      <li><span class="toc-text">14. Bibliography</span><span class="toc-dots"></span><span class="toc-num">44</span></li>
    </ul>
  </section>

  <!-- CHAPTERS 1 TO 14 -->
  ${cleanHtml(synopsis)}
</body>
</html>`;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repo2synopsis-'));
  const htmlPath = path.join(tempDir, 'synopsis.html');
  const pdfPath = path.join(tempDir, 'synopsis.pdf');

  try {
    await fs.writeFile(htmlPath, html, 'utf-8');
    await run(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--allow-file-access-from-files',
        '--no-pdf-header-footer',
        '--run-all-compositor-stages-before-draw',
        `--print-to-pdf=${pdfPath}`,
        htmlPath
      ],
      { windowsHide: true, timeout: 120000 }
    );
    return await fs.readFile(pdfPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { createPdf };


