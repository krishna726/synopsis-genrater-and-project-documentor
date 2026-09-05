const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const HUMANIZER_SYSTEM_RULES = `
ACADEMIC HUMANIZER & GROUND-TRUTH ENFORCEMENT RULES:
1. Tone & Voice: Write in an active, direct, professional tone of an experienced software engineer drafting a formal academic project synopsis.
2. ZERO-HALLUCINATION MANDATE:
   - Document ONLY the exact libraries, dependencies, modules, and functionalities physically present in the scanned repository.
   - If a technology (e.g., JWT, OAuth, Docker, Redis, Redux) is NOT explicitly found in the codebase or dependencies, DO NOT mention or invent it. Do not assume standard templates.
   - If a module or feature is absent in the repo, either explain the repo's actual approach or omit the non-existent feature entirely from the section.
3. STRICTLY BANNED AI BUZZWORDS & CLICHES:
   - NEVER use: "delve into", "delving into", "tapestry", "rich tapestry", "testament", "testament to", "serves as a testament", "furthermore", "holistic", "pivotal", "groundbreaking", "beacon", "unleash", "unleashing", "in the fast-paced digital era", "in today's modern world", "revolutionize", "in conclusion, it is evident that".
4. Pragmatic Human Phrasing:
   - Keep sentences varied in length, pragmatic, and clear.
   - Describe what code functions actually do instead of using exaggerated praising adjectives.
   - Provide realistic database column names, HTTP status codes, exact data structures, and practical failure recovery flows rather than abstract generic text.
`;

function sanitizeAiOutput(raw = "") {
  if (!raw) return "";
  let text = String(raw)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  text = text
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return text;
}

function humanizeAcademicText(rawHtml = "") {
  if (!rawHtml) return "";
  let text = sanitizeAiOutput(rawHtml);

  const replacements = [
    [/\b(?:delve into|delving into|delves into)\b/gi, "examine"],
    [
      /\b(?:a testament to|stands as a testament|serves as a testament|testament to)\b/gi,
      "clear evidence of",
    ],
    [
      /\b(?:in today's fast-paced digital world|in the fast-paced digital era|in today's modern era|in the fast-paced world)\b/gi,
      "in modern software systems",
    ],
    [
      /\b(?:it is crucial to note that|it is imperative to note that|it is worth noting that)\b/gi,
      "notably,",
    ],
    [/\b(?:pivotal role|pivotal)\b/gi, "key role"],
    [
      /\b(?:rich tapestry of|tapestry of|tapestry)\b/gi,
      "structured combination of",
    ],
    [/\b(?:harness the power of|harnessing the power of)\b/gi, "utilizing"],
    [/\b(?:revolutionize|revolutionizing|groundbreaking)\b/gi, "modernizing"],
    [
      /\b(?:furthermore, it should be noted that|furthermore, it is essential to|furthermore)\b/gi,
      "additionally",
    ],
    [/\b(?:holistic approach|holistic)\b/gi, "end-to-end approach"],
    [/\b(?:beacon of|beacon)\b/gi, "standard model for"],
    [/\b(?:unleash the potential|unleashing|unleash)\b/gi, "enable"],
    [
      /\b(?:seamlessly integrates|seamless integration)\b/gi,
      "direct integration",
    ],
    [/\b(?:paramount importance)\b/gi, "high importance"],
    [
      /\b(?:in a nutshell|all in all|in conclusion, it is evident that)\b/gi,
      "in summary",
    ],
    [/\b(?:a plethora of)\b/gi, "multiple"],
    [/\b(?:in order to ensure)\b/gi, "to guarantee"],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return text;
}

function getGroqApiKeys() {
  const rawList = [
    process.env.GROQ_API_KEYS,
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4
  ];

  const keys = [];
  for (const item of rawList) {
    if (!item) continue;
    for (const key of String(item).split(/[,;\s]+/)) {
      const trimmed = key.trim();
      if (trimmed.startsWith('gsk_') && !keys.includes(trimmed)) {
        keys.push(trimmed);
      }
    }
  }
  return keys;
}

let currentGroqKeyIdx = 0;
function getNextGroqKey(keys) {
  if (!keys.length) return '';
  const key = keys[currentGroqKeyIdx % keys.length];
  currentGroqKeyIdx = (currentGroqKeyIdx + 1) % keys.length;
  return key;
}

async function callGroq(messages, temperature = 0.38, maxRetries = 4, isCancelled = null) {
  const keys = getGroqApiKeys();
  if (keys.length === 0) {
    throw new Error(
      "GROQ_API_KEY is missing. Add it to your .env file and restart the server.",
    );
  }

  // Inject Humanizer rules into messages
  const enhancedMessages = [
    { role: "system", content: HUMANIZER_SYSTEM_RULES },
    ...messages.filter((m) => m.role !== "system"),
  ];

  const totalAttempts = Math.max(maxRetries, keys.length * 2);
  let lastError = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (isCancelled && isCancelled()) {
      throw new Error("Client aborted request");
    }
    const activeKey = getNextGroqKey(keys);
    try {
      const response = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${activeKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
          temperature,
          messages: enhancedMessages,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (
        response.status === 429 ||
        /rate limit|tokens per minute/i.test(data.error?.message || "")
      ) {
        console.warn(
          `Groq rate limit hit on key (...${activeKey.slice(-6)}). Rotating to next API key...`,
        );
        if (isCancelled && isCancelled()) throw new Error("Client aborted request");
        if (keys.length > 1) {
          // Switch to another key immediately with slight backoff
          await new Promise((resolve) => setTimeout(resolve, 600));
          continue;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 3500 * attempt));
          continue;
        }
      }

      if (!response.ok) {
        throw new Error(
          data.error?.message || `Groq API returned HTTP ${response.status}`,
        );
      }

      const raw = data.choices?.[0]?.message?.content || "";
      return humanizeAcademicText(raw);
    } catch (err) {
      if (isCancelled && isCancelled()) throw err;
      lastError = err;
      if (attempt === totalAttempts) throw err;
      console.warn(
        `Groq call attempt ${attempt} failed: ${err.message}. Rotating key and retrying in ${attempt}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  throw lastError || new Error("All Groq API keys were exhausted or rate limited.");
}

const CHAPTER_DEFINITIONS = [
  {
    index: 1,
    id: "abstract",
    title: "1. Abstract",
    buildPrompt: ({
      project,
    }) => `You are a senior computer science professor writing Chapter 1: Abstract for a major university academic project report on "${project.name}".
CRITICAL: Write deeply technical, comprehensive, academic HTML text (at least 600-800 words) describing "${project.name}" (${project.description}). Tech stack: ${(project.analysis?.stack || []).join(", ")}.
Output clean semantic HTML only (with <h2>, <h3>, <p>, <ul>, <li>). No markdown fences.

Format:
<h2>Abstract</h2>
<p>Detailed academic abstract covering technical motivations, software architecture, core functional innovations, stack ${(project.analysis?.stack || []).join(", ")}, and measured real-world viability.</p>`,
  },
  {
    index: 2,
    id: "introduction",
    title: "2. Introduction of the Project",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 2: Introduction of the Project for "${project.name}".
Output clean semantic HTML only (at least 1100-1400 words):
<h2>Introduction</h2>
<p>Comprehensive industry background and motivation for building "${project.name}".</p>
<h3>Problem Domain</h3>
<p>In-depth analysis of existing manual/conventional solutions, deficiencies, technical challenges, and why "${project.name}" solves them.</p>
<ul>
  <li><strong>Personal / Domain Motivation:</strong> Explanation...</li>
  <li><strong>Technical Demonstration of Competencies:</strong> Explanation...</li>
  <li><strong>Operational Considerations & Maintenance:</strong> Explanation...</li>
</ul>
<h3>About the Project</h3>
<p>Architectural breakdown of "${project.name}":</p>
<h4>Front-End Layer</h4>
<p>Semantic structure, UI layout, CSS grid/flexbox, interactive DOM manipulation for "${project.name}".</p>
<h4>Back-End Layer</h4>
<p>Server-side architecture, REST endpoints, middleware handlers, request body parsing, error propagation.</p>
<h4>Data Persistence</h4>
<p>Database model, schema validation, timestamps, and connection management.</p>
<h4>Configuration and Deployment</h4>
<p>Environment variables, deployment pipeline, serverless/cloud hosting strategy.</p>
<h4>Customization and Extensibility</h4>
<p>Future modular expansions and code maintainability.</p>

Project: ${project.name} | Description: ${project.description} | Stack: ${(project.analysis?.stack || []).join(", ")}`,
  },
  {
    index: 3,
    id: "objectives_features",
    title: "3. Objective & Key Features",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 3: Objective & Key Features for "${project.name}".
Output clean semantic HTML only (at least 1000-1300 words):
<h2>Objective</h2>
<p>5-6 core primary engineering goals (architectural elegance, responsive UX, backend efficiency, database reliability, deployment readiness).</p>
<h2>Key Features</h2>
<p>Detailed technical description of EVERY key feature in "${project.name}" (${(project.analysis?.modules || []).join(", ")}):</p>
<ul>
  <li><strong>Responsive Layout & Interface:</strong> Detailed technical functionality...</li>
  <li><strong>Interactive UI Components:</strong> Smooth navigation, state management, event handlers...</li>
  <li><strong>API & Backend Processing:</strong> Specific REST endpoints, request validation, HTTP status codes...</li>
  <li><strong>Database Persistence:</strong> Automatic timestamping, data integrity, audit tracking...</li>
  <li><strong>Cloud Deployment:</strong> Automated CI/CD, environment variables isolation...</li>
</ul>

Project: ${project.name} | Modules: ${(project.analysis?.modules || []).join(", ")}`,
  },
  {
    index: 4,
    id: "category_beneficiary",
    title: "4. Project Category & Beneficiary",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 4: Project Category & Beneficiary for "${project.name}".
Output clean semantic HTML only (at least 700-900 words):
<h2>Project Category</h2>
<p>Classification of "${project.name}" within modern software engineering domains (Web Application, Client-Server Architecture, Cloud Platform) with architectural justification.</p>
<h2>Beneficiary</h2>
<p>Detailed analysis of primary and secondary target audience, end-users, industry recruiters/clients, and open-source community benefits.</p>

Project: ${project.name} | Description: ${project.description} | Stack: ${(project.analysis?.stack || []).join(", ")}`,
  },
  {
    index: 5,
    id: "feasibility",
    title: "5. Feasibility Study",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 5: Feasibility Study for "${project.name}".
Output clean semantic HTML only (at least 1000-1300 words):
<h2>Technical Feasibility</h2>
<p>Deep evaluation of ${(project.analysis?.stack || []).join(", ")}, framework maturity, compute requirements, API reliability, and migration pathways.</p>
<h2>Operational Feasibility</h2>
<p>User onboarding, deployment ease, operational overhead, administrative workflows, and maintenance.</p>
<h2>Economic Feasibility</h2>
<p>Cost analysis, open-source stack zero-cost licensing, free tier cloud hosting vs enterprise infrastructure.</p>
<h2>Schedule Feasibility</h2>
<p>Semester-long milestone timeline (Requirements, Frontend, Backend, Integration & QA, Deployment) with risk mitigation.</p>

Project: ${project.name} | Stack: ${(project.analysis?.stack || []).join(", ")}`,
  },
  {
    index: 6,
    id: "methodology_planning",
    title: "6. Methodology Used & Planning Work",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 6: Methodology Used & Planning Work for "${project.name}".
Output clean semantic HTML only (at least 1100-1400 words):
<h2>Methodology Used</h2>
<p>Agile-Scrum Iterative Development model: sprint cycles, GitHub project boards, Git-Flow branching model, continuous integration.</p>
<h2>Planning Work</h2>
<p>Detailed planning artifacts for "${project.name}":</p>
<ul>
  <li><strong>Requirement Elicitation:</strong> Functional (FR) & Non-Functional (NFR) requirements with targets.</li>
  <li><strong>Work Breakdown Structure (WBS):</strong> Discrete work packages across development layers.</li>
  <li><strong>Gantt Timeline:</strong> 12-week sprint schedule from concept to release.</li>
  <li><strong>SWOT Analysis:</strong> Strengths, Weaknesses, Opportunities, and Threats for this stack.</li>
  <li><strong>Quality Assurance & Testing Strategy:</strong> Unit tests, integration validation, and code consistency.</li>
</ul>

Project: ${project.name} | Stack: ${(project.analysis?.stack || []).join(", ")}`,
  },
  {
    index: 7,
    id: "tools_technologies",
    title: "7. Tools & Technologies Used",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 7: Tools & Technologies Used for "${project.name}".
CRITICAL: Only write about technologies that are actually part of this project's detected stack: ${(project.analysis?.stack || []).join(", ")}.
Output clean semantic HTML only (at least 1100-1400 words):
<h2>Tools & Technologies Used</h2>
<p>System architecture and cohesive suite of technologies powering "${project.name}".</p>
<h3>Programming Languages</h3>
<p>Detailed technical role of languages used (${(project.analysis?.stack || []).join(", ")}).</p>
<h3>DBMS</h3>
<p>Database architecture, document structure/relational schema, indexing, and connection management.</p>
<h3>Web Technologies</h3>
<p>Frontend standards, semantic markup, responsive styling, CDN assets, and API communication.</p>
<h3>Database Connectivity</h3>
<p>Driver / ODM connectivity, connection string security via environment variables, schema validation.</p>
<h3>Development Environment</h3>
<p>IDE tooling (VS Code), linting, package management with npm, version control with Git/GitHub.</p>
<h3>User Interface Tools</h3>
<p>Typography, vector icons, CSS animation keyframes, and cross-device responsive layout mechanisms.</p>

Project: ${project.name} | Stack: ${(project.analysis?.stack || []).join(", ")}`,
  },
  {
    index: 8,
    id: "platform",
    title: "8. Platform Used",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 8: Platform Used for "${project.name}".
Output clean semantic HTML only (at least 700-1000 words):
<h2>Platform Used</h2>
<p>Cloud/serverless deployment infrastructure, edge routing, CDN caching, and SSL termination for "${project.name}".</p>
<h3>Hardware Specifications</h3>
<p>Client-side minimum & recommended hardware specs, plus server-side compute/memory/storage requirements.</p>
<h3>Software Specifications</h3>
<p>Operating system compatibility, runtime versions (Node.js LTS, etc.), browser standards, and package manifests.</p>

Project: ${project.name} | Stack: ${(project.analysis?.stack || []).join(", ")}`,
  },
  {
    index: 9,
    id: "modules",
    title: "9. Module Description",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 9: Module Description for "${project.name}".
CRITICAL: Describe EVERY detected functional module of this project: ${(project.analysis?.modules || []).join(", ")}.
Output clean semantic HTML only (at least 1200-1500 words):
<h2>Module Description</h2>
<p>Architectural modularity and separation of concerns for "${project.name}".</p>
${(
  project.analysis?.modules || [
    "Client Presentation Layer",
    "REST API Routing Engine",
    "Database Persistence Layer",
  ]
)
  .map(
    (mod, i) => `
<h3>Module ${i + 1}: ${mod}</h3>
<p>Comprehensive description of purpose, input parameters, internal processing algorithms, data validation, and output responses for this module.</p>
`,
  )
  .join("")}

Project: ${project.name} | Modules: ${(project.analysis?.modules || []).join(", ")}`,
  },
  {
    index: 10,
    id: "system_design",
    title: "10. System Design",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 10: System Design for "${project.name}".
Output clean semantic HTML only (at least 1000-1300 words):
<h2>System Design</h2>
<p>Data flow and entity modeling philosophy for "${project.name}" (Domain: ${project.analysis?.domain || 'Software Engineering Application'}).</p>
<h3>Data Flow Diagrams</h3>
<h4>0-Level DFD (Context Diagram)</h4>
<p>Detailed textual explanation of external actors (User / Client), system boundary of "${project.name}", primary input/output data transactions, and persistent storage.</p>
<h4>1-Level DFD</h4>
<p>Detailed architectural breakdown of internal sub-processes, data stores (${(project.analysis?.stack || []).filter((s) => /db|mongo|sql/i.test(s)).join(', ') || 'Database Storage'}), and operational execution flows for "${project.name}".</p>
<h3>Entity-Relationship Diagram</h3>
<p>Structural representation of core business entities, primary keys, relationships, and relational cardinalities tailored strictly to "${project.name}".</p>

Project: ${project.name} | Description: ${project.description} | Domain: ${project.analysis?.domain || 'Application'} | Stack: ${(project.analysis?.stack || []).join(", ")} | Modules: ${(project.analysis?.modules || []).join(", ")}`,
  },
  {
    index: 11,
    id: "data_tables",
    title: "11. Data Tables",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 11: Data Tables for "${project.name}".
CRITICAL: Generate 4 to 6 comprehensive, professional database tables / collection schemas strictly relevant to "${project.name}" (${project.description || ''}).
Detected Project Domain: ${project.analysis?.domain || 'General Application'}.
Detected Stack: ${(project.analysis?.stack || []).join(", ")}.
Detected Modules: ${(project.analysis?.modules || []).join(", ")}.

INSTRUCTIONS:
- Every table MUST be strictly tailored to what "${project.name}" actually does.
- If "${project.name}" is an e-commerce project, create tables like: products, orders, order_items, customers, payments.
- If "${project.name}" is a student / university / attendance project, create tables like: students, attendance_records, courses, faculty, feedback.
- If "${project.name}" is healthcare, create tables like: patients, appointments, medical_records, doctors.
- If "${project.name}" is a web framework / backend library / API (like Express), create data registries like: routes_registry, middleware_stack, request_audit_logs, server_config, response_cache.
- If "${project.name}" is a chat / social platform, create tables like: users, direct_messages, posts, comments, followers.
- If "${project.name}" is a task management platform, create tables like: workspaces, tasks, task_assignments, comments, audit_logs.
- If "${project.name}" is a portfolio, create tables like: showcase_projects, skills, contact_messages, experience.
- DO NOT output unrelated portfolio tables if "${project.name}" is NOT a portfolio!

Output clean semantic HTML only (at least 1000-1400 words):
<h2>Data Tables</h2>
<p>Physical schema and relational specifications underlying the database architecture of "${project.name}".</p>

For EACH of the 4 to 6 tables, output:
<p class="table-caption">Table X of N — [table_name]</p>
<p class="table-sub-caption">[Technical purpose of this table in ${project.name}]</p>
<table>
  <thead><tr><th>FIELD</th><th>TYPE</th><th>DESCRIPTION</th><th>KEY</th></tr></thead>
  <tbody>
    <tr><td>id</td><td>INTEGER / ObjectId</td><td>Primary key identifier</td><td>PK</td></tr>
    [4 to 7 realistic domain-specific columns with descriptions and keys (PK / FK / -)]
  </tbody>
</table>

Project: ${project.name} | Description: ${project.description} | Stack: ${(project.analysis?.stack || []).join(", ")}`,
  },
  {
    index: 12,
    id: "future_scope",
    title: "12. Future Scope",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 12: Future Scope for "${project.name}".
Output clean semantic HTML only (at least 900-1200 words):
<h2>Future Scope</h2>
<p>Prospective technical extensions and roadmap for "${project.name}":</p>
<ul>
  <li><strong>Progressive Web Application (PWA) Transformation:</strong> Offline caching, service workers, app manifest, installability.</li>
  <li><strong>Server-Side Rendering (SSR) & SEO Optimization:</strong> Framework transitions, metadata indexing, performance tuning.</li>
  <li><strong>Integration of a Headless CMS:</strong> Content authoring decoupled from codebase.</li>
  <li><strong>Advanced Data Analytics & Insights:</strong> Real-time visitor metrics, event tracking dashboards.</li>
  <li><strong>Enhanced Security & Compliance:</strong> Rate limiting, CAPTCHA integration, GDPR consent management.</li>
  <li><strong>Scalable Backend Architecture:</strong> Microservices refactoring, containerization with Docker.</li>
  <li><strong>AI-Powered Features:</strong> Interactive assistant / intelligent queries based on project data.</li>
  <li><strong>Continuous Integration / Continuous Deployment (CI/CD):</strong> Automated test suites, GitHub Actions pipelines.</li>
  <li><strong>Performance Optimization & Edge Computing:</strong> CDN caching, image optimization (WebP/AVIF).</li>
</ul>

Project: ${project.name} | Stack: ${(project.analysis?.stack || []).join(", ")}`,
  },
  {
    index: 13,
    id: "conclusion",
    title: "13. Conclusion",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 13: Conclusion for "${project.name}".
Output clean semantic HTML only (at least 600-800 words):
<h2>Conclusion</h2>
<p>Comprehensive concluding evaluation summarizing how "${project.name}" successfully fulfills all its functional and engineering objectives, adheres to software development best practices, and delivers a robust, production-grade software artifact.</p>

Project: ${project.name} | Stack: ${(project.analysis?.stack || []).join(", ")}`,
  },
  {
    index: 14,
    id: "bibliography",
    title: "14. Bibliography",
    buildPrompt: ({
      project,
    }) => `You are writing Chapter 14: Bibliography for "${project.name}".
CRITICAL: Generate 6 to 10 IEEE/APA academic citations and official documentation references strictly relevant to "${project.name}", its detected tech stack: ${(project.analysis?.stack || []).join(", ")}, and domain: ${project.analysis?.domain || 'Software Engineering'}.
Output clean semantic HTML only (at least 600-800 words):
<h2>Bibliography</h2>
<p>Foundational technical documentation, research papers, and standards references employed in the design and implementation of "${project.name}":</p>
<ul>
  <li>Include official documentation citations for ${(project.analysis?.stack || []).join(', ') || 'the technologies used'}.</li>
  <li>Include IEEE/ACM research references on ${project.analysis?.domain || 'modern software architecture'}.</li>
  <li>Include standard software engineering references (Sommerville, Pressman, Martin Fowler).</li>
</ul>`,
  },
];

function escapeHtml(text = "") {
  return String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
}

function generateDfd0Svg(project) {
  const name = escapeHtml(project.name || 'System');
  const hasAuth = Boolean(project.analysis?.hasAuth);
  const visitorLabel = hasAuth ? 'User' : 'Visitor';
  const systemLabel = `${name.slice(0, 16)} System`;

  return `<div class="diagram-wrap">
  <svg viewBox="0 0 850 160" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff; font-family:'Times New Roman',Times,serif;">
    <defs>
      <marker id="dfd0-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill="#000000" />
      </marker>
    </defs>

    <!-- Entity Rectangle -->
    <rect x="80" y="45" width="200" height="70" fill="#ffffff" stroke="#000000" stroke-width="1.6" />
    <text x="180" y="86" text-anchor="middle" font-size="15" font-family="'Times New Roman',Times,serif" fill="#000000">${visitorLabel}</text>

    <!-- Arrow Line -->
    <line x1="280" y1="80" x2="510" y2="80" stroke="#000000" stroke-width="1.6" marker-end="url(#dfd0-arrow)" />

    <!-- Process Ellipse -->
    <ellipse cx="640" cy="80" rx="130" ry="52" fill="#ffffff" stroke="#000000" stroke-width="1.6" />
    <text x="640" y="86" text-anchor="middle" font-size="15" font-family="'Times New Roman',Times,serif" fill="#000000">${systemLabel}</text>
  </svg>
  <p class="diagram-caption">Figure 10.1: 0-Level Context Data Flow Diagram (DFD)</p>
</div>`;
}

function generateDfd1Svg(project) {
  const name = String(project.name || '').toLowerCase();
  const desc = String(project.description || '').toLowerCase();
  const domain = String(project.analysis?.domain || '');
  const allSignals = `${name} ${desc} ${domain.toLowerCase()}`;
  const hasAuth = Boolean(project.analysis?.hasAuth);
  const stack = (project.analysis?.stack || []).filter(Boolean);
  const dbName = stack.find((s) => /mongo|sql|postgres|mysql|sqlite|redis|database|db/i.test(s)) || 'Database Store';

  const isPortfolio = domain === 'Developer Portfolio & Showcase' || /portfolio|protfolio|resume|personal[-_\s]*web|curriculum[-_\s]*vitae|\bcv\b/i.test(`${name} ${desc}`);
  const isFramework = domain === 'Web Framework & Server Engine' || (/framework|routing|middleware|\bexpress\b|router/i.test(`${name} ${desc}`) || name === 'express');
  const isStudent = domain === 'Education & Academic Management' || /\b(student|students|attendance|college|school|university|academic|faculty|lms)\b/i.test(allSignals);
  const isEcommerce = domain === 'E-Commerce & Retail Platform' || /\b(ecommerce|e-commerce|shopping|cart|checkout|store|billing)\b/i.test(allSignals);
  const isHealthcare = domain === 'Healthcare & Hospital Management' || /\b(health|hospital|doctor|doctors|patient|patients|clinic|medical)\b/i.test(allSignals);
  const isFintech = domain === 'FinTech & Financial Transactions' || /\b(bank|banking|finance|fintech|wallet|crypto|payment|transactions?)\b/i.test(allSignals);
  const isSocialOrChat = domain === 'Social Media & Real-time Collaboration' || /\b(chat|messaging|social|forum|community|tweet|feed)\b/i.test(allSignals);
  const isTaskOrIssue = domain === 'Project & Task Management' || /\b(task|tasks|todo|todos|issue|bug|ticket|jira|kanban)\b/i.test(allSignals);

  let visitorLabel = isStudent ? 'User / Student' : isEcommerce ? 'Customer' : isHealthcare ? 'Patient / Doctor' : isFintech ? 'Account Holder' : isPortfolio ? 'Visitor' : hasAuth ? 'Registered User' : 'Client User';

  let p1_1 = 'Serve Client', p1_2 = 'Interface UI', storeTop = 'Application Cache';
  let p2_1 = 'Route API', p2_2 = 'Requests', storeLeft = 'Request Router';
  let p3_1 = 'Process Input', p3_2 = 'Transactions', storeRight = 'Input Buffer';
  let p4_1 = 'Persist Core', p4_2 = 'Application Data', storeBottomLeft = dbName;
  let p5_1 = 'Validate Payload', p5_2 = '& Security', storeBottomRight = 'Validation Rules';

  if (isStudent) {
    p1_1 = 'Serve Academic'; p1_2 = 'Portal UI'; storeTop = 'Portal Cache';
    p2_1 = 'Generate Academic'; p2_2 = 'Reports'; storeLeft = 'Report Engine';
    p3_1 = 'Process Attendance'; p3_2 = 'Submission'; storeRight = 'Input Buffer';
    p4_1 = 'Persist Academic'; p4_2 = 'Records'; storeBottomLeft = dbName;
    p5_1 = 'Validate Student'; p5_2 = 'Identity'; storeBottomRight = 'Student Registry';
  } else if (isEcommerce) {
    p1_1 = 'Serve Product'; p1_2 = 'Storefront UI'; storeTop = 'Catalog CDN Cache';
    p2_1 = 'Process Cart &'; p2_2 = 'Checkout'; storeLeft = 'Order Queue';
    p3_1 = 'Submit Customer'; p3_2 = 'Inquiries'; storeRight = 'Support Queue';
    p4_1 = 'Persist Orders &'; p4_2 = 'Inventory Data'; storeBottomLeft = dbName;
    p5_1 = 'Authorize Payment'; p5_2 = 'Transactions'; storeBottomRight = 'Payment Gateway';
  } else if (isHealthcare) {
    p1_1 = 'Serve Clinic'; p1_2 = 'Portal UI'; storeTop = 'Patient Session Cache';
    p2_1 = 'Schedule Doctor'; p2_2 = 'Appointments'; storeLeft = 'Scheduling Queue';
    p3_1 = 'Process Medical'; p3_2 = 'Inquiry Forms'; storeRight = 'Triage Buffer';
    p4_1 = 'Persist Patient &'; p4_2 = 'EHR Records'; storeBottomLeft = dbName;
    p5_1 = 'Verify Doctor'; p5_2 = 'Credentials'; storeBottomRight = 'Staff Registry';
  } else if (isSocialOrChat) {
    p1_1 = 'Serve Chat &'; p1_2 = 'Feed UI'; storeTop = 'Realtime Socket Cache';
    p2_1 = 'Broadcast Posts'; p2_2 = '& Stories'; storeLeft = 'Event Broker';
    p3_1 = 'Transmit Direct'; p3_2 = 'Messages'; storeRight = 'Message Queue';
    p4_1 = 'Persist User Posts'; p4_2 = '& Messages'; storeBottomLeft = dbName;
    p5_1 = 'Authenticate Token'; p5_2 = '& Session'; storeBottomRight = 'Auth Store';
  } else if (isTaskOrIssue) {
    p1_1 = 'Serve Workspace'; p1_2 = 'Kanban UI'; storeTop = 'Workspace Cache';
    p2_1 = 'Track Task'; p2_2 = 'Milestones'; storeLeft = 'Sprint Engine';
    p3_1 = 'Handle Issue'; p3_2 = 'Submissions'; storeRight = 'Task Buffer';
    p4_1 = 'Persist Workspaces'; p4_2 = '& Tickets'; storeBottomLeft = dbName;
    p5_1 = 'Verify Member'; p5_2 = 'Permissions'; storeBottomRight = 'RBAC Rules';
  } else if (isFintech) {
    p1_1 = 'Serve Banking'; p1_2 = 'Dashboard UI'; storeTop = 'Encrypted Session';
    p2_1 = 'Execute Fund'; p2_2 = 'Transfers'; storeLeft = 'Transaction Engine';
    p3_1 = 'Handle Support'; p3_2 = 'Tickets'; storeRight = 'Audit Buffer';
    p4_1 = 'Persist Ledgers'; p4_2 = '& Balances'; storeBottomLeft = dbName;
    p5_1 = 'Validate KYC &'; p5_2 = 'Anti-Fraud'; storeBottomRight = 'Security Vault';
  } else if (isFramework) {
    p1_1 = 'Handle Inbound'; p1_2 = 'HTTP Requests'; storeTop = 'Kernel Buffer';
    p2_1 = 'Execute Route'; p2_2 = 'Middleware'; storeLeft = 'Middleware Pipeline';
    p3_1 = 'Parse Request'; p3_2 = 'Body & Headers'; storeRight = 'Stream Parser';
    p4_1 = 'Log Traffic &'; p4_2 = 'Audit Records'; storeBottomLeft = dbName;
    p5_1 = 'Dispatch Final'; p5_2 = 'Response'; storeBottomRight = 'HTTP Engine';
  } else if (isPortfolio) {
    p1_1 = 'Serve Static'; p1_2 = 'Portfolio UI'; storeTop = 'Static File Cache';
    p2_1 = 'Provide Resume'; p2_2 = 'Download'; storeLeft = 'File System';
    p3_1 = 'Handle Contact'; p3_2 = 'Form Submission'; storeRight = 'None';
    p4_1 = 'Persist Contact'; p4_2 = 'Messages'; storeBottomLeft = dbName;
    p5_1 = 'Validate Contact'; p5_2 = 'Payload'; storeBottomRight = 'Validation Rules';
  }

  return `<div class="diagram-wrap">
  <svg viewBox="0 0 860 520" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff; font-family:'Times New Roman',Times,serif;">
    <defs>
      <marker id="dfd1-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1 L 9 5 L 0 9 z" fill="#000000" />
      </marker>
    </defs>

    <!-- Center Entity: Visitor / User -->
    <rect x="340" y="225" width="180" height="60" fill="#ffffff" stroke="#000000" stroke-width="1.6" />
    <text x="430" y="260" text-anchor="middle" font-size="15" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(visitorLabel)}</text>

    <!-- Top Process 1 -->
    <ellipse cx="430" cy="115" rx="75" ry="38" fill="#ffffff" stroke="#000000" stroke-width="1.5" />
    <text x="430" y="110" text-anchor="middle" font-size="11.5" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(p1_1)}</text>
    <text x="430" y="126" text-anchor="middle" font-size="11.5" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(p1_2)}</text>
    <line x1="430" y1="225" x2="430" y2="153" stroke="#000000" stroke-width="1.4" />
    <line x1="430" y1="77" x2="430" y2="48" stroke="#000000" stroke-width="1.4" stroke-dasharray="4,3" />
    <path d="M 370 48 L 370 36 L 490 36 L 490 48" fill="none" stroke="#000000" stroke-width="1.5" />
    <text x="430" y="30" text-anchor="middle" font-size="11" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(storeTop)}</text>

    <!-- Left Process 2 -->
    <ellipse cx="180" cy="235" rx="75" ry="38" fill="#ffffff" stroke="#000000" stroke-width="1.5" />
    <text x="180" y="230" text-anchor="middle" font-size="11.5" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(p2_1)}</text>
    <text x="180" y="246" text-anchor="middle" font-size="11.5" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(p2_2)}</text>
    <line x1="340" y1="255" x2="255" y2="238" stroke="#000000" stroke-width="1.4" />
    <line x1="30" y1="185" x2="140" y2="185" stroke="#000000" stroke-width="1.5" />
    <line x1="30" y1="215" x2="140" y2="215" stroke="#000000" stroke-width="1.5" />
    <line x1="140" y1="185" x2="140" y2="215" stroke="#000000" stroke-width="1.5" />
    <text x="85" y="204" text-anchor="middle" font-size="11" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(storeLeft)}</text>
    <line x1="140" y1="200" x2="180" y2="200" stroke="#000000" stroke-width="1.4" stroke-dasharray="4,3" />

    <!-- Right Process 3 -->
    <ellipse cx="670" cy="235" rx="75" ry="38" fill="#ffffff" stroke="#000000" stroke-width="1.5" />
    <text x="670" y="230" text-anchor="middle" font-size="11.5" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(p3_1)}</text>
    <text x="670" y="246" text-anchor="middle" font-size="11.5" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(p3_2)}</text>
    <line x1="520" y1="255" x2="595" y2="238" stroke="#000000" stroke-width="1.4" />
    <line x1="710" y1="185" x2="820" y2="185" stroke="#000000" stroke-width="1.5" />
    <line x1="710" y1="215" x2="820" y2="215" stroke="#000000" stroke-width="1.5" />
    <line x1="710" y1="185" x2="710" y2="215" stroke="#000000" stroke-width="1.5" />
    <text x="765" y="204" text-anchor="middle" font-size="11" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(storeRight)}</text>
    <line x1="670" y1="200" x2="710" y2="200" stroke="#000000" stroke-width="1.4" stroke-dasharray="4,3" />

    <!-- Bottom-Left Process 4 -->
    <ellipse cx="290" cy="385" rx="75" ry="38" fill="#ffffff" stroke="#000000" stroke-width="1.5" />
    <text x="290" y="380" text-anchor="middle" font-size="11.5" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(p4_1)}</text>
    <text x="290" y="396" text-anchor="middle" font-size="11.5" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(p4_2)}</text>
    <line x1="380" y1="285" x2="320" y2="350" stroke="#000000" stroke-width="1.4" marker-end="url(#dfd1-arrow)" />
    <line x1="290" y1="423" x2="250" y2="470" stroke="#000000" stroke-width="1.4" stroke-dasharray="4,3" />
    <rect x="180" y="470" width="140" height="42" fill="#ffffff" stroke="#000000" stroke-width="1.5" />
    <text x="250" y="496" text-anchor="middle" font-size="12" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(storeBottomLeft)}</text>

    <!-- Bottom-Right Process 5 -->
    <ellipse cx="570" cy="385" rx="75" ry="38" fill="#ffffff" stroke="#000000" stroke-width="1.5" />
    <text x="570" y="380" text-anchor="middle" font-size="11.5" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(p5_1)}</text>
    <text x="570" y="396" text-anchor="middle" font-size="11.5" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(p5_2)}</text>
    <line x1="480" y1="285" x2="540" y2="350" stroke="#000000" stroke-width="1.4" marker-end="url(#dfd1-arrow)" />
    <line x1="570" y1="423" x2="610" y2="470" stroke="#000000" stroke-width="1.4" stroke-dasharray="4,3" />
    <rect x="540" y="470" width="140" height="42" fill="#ffffff" stroke="#000000" stroke-width="1.5" />
    <text x="610" y="496" text-anchor="middle" font-size="12" font-family="'Times New Roman',Times,serif" fill="#000000">${escapeHtml(storeBottomRight)}</text>
  </svg>
  <p class="diagram-caption">Figure 10.2: 1-Level Detailed Data Flow Diagram (DFD)</p>
</div>`;
}

function renderErBox(x, y, w, h, title, pk, attrs = []) {
  const safeTitle = escapeHtml(String(title || 'Entity').slice(0, 22));
  const safePk = escapeHtml(String(pk || 'id').slice(0, 22));
  const safeAttrs = (attrs || []).slice(0, 5).map((a) => escapeHtml(String(a || '').slice(0, 22)));

  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff" stroke="#000000" stroke-width="1.5" />
    <text x="${x + w / 2}" y="${y + 24}" text-anchor="middle" font-size="12.5" font-weight="700" font-family="'Times New Roman',Times,serif" fill="#000000">${safeTitle}</text>
    <line x1="${x + 10}" y1="${y + 33}" x2="${x + w - 10}" y2="${y + 33}" stroke="#000000" stroke-width="1" />
    <text x="${x + w / 2}" y="${y + 53}" text-anchor="middle" font-size="11" text-decoration="underline" font-family="'Times New Roman',Times,serif" fill="#000000">${safePk}</text>
    ${safeAttrs.map((attr, idx) => `
      <text x="${x + w / 2}" y="${y + 72 + idx * 18}" text-anchor="middle" font-size="10.5" font-family="'Times New Roman',Times,serif" fill="#000000">${attr}</text>
    `).join('')}
  `;
}

function generateErDiagramSvg(project) {
  const name = String(project.name || '').toLowerCase();
  const desc = String(project.description || '').toLowerCase();
  const domain = String(project.analysis?.domain || '');
  const allSignals = `${name} ${desc} ${domain.toLowerCase()}`;
  const hasAuth = Boolean(project.analysis?.hasAuth);

  const isPortfolio = domain === 'Developer Portfolio & Showcase' || /portfolio|protfolio|resume|personal[-_\s]*web|curriculum[-_\s]*vitae|\bcv\b/i.test(`${name} ${desc}`);
  const isFramework = domain === 'Web Framework & Server Engine' || (/framework|routing|middleware|\bexpress\b|router/i.test(`${name} ${desc}`) || name === 'express');
  const isStudent = domain === 'Education & Academic Management' || /\b(student|students|attendance|college|school|university|academic|faculty|lms)\b/i.test(allSignals);
  const isEcommerce = domain === 'E-Commerce & Retail Platform' || /\b(ecommerce|e-commerce|shopping|cart|checkout|store|billing)\b/i.test(allSignals);
  const isHealthcare = domain === 'Healthcare & Hospital Management' || /\b(health|hospital|doctor|doctors|patient|patients|clinic|medical)\b/i.test(allSignals);
  const isFintech = domain === 'FinTech & Financial Transactions' || /\b(bank|banking|finance|fintech|wallet|crypto|payment|transactions?)\b/i.test(allSignals);
  const isSocialOrChat = domain === 'Social Media & Real-time Collaboration' || /\b(chat|messaging|social|forum|community|tweet|feed)\b/i.test(allSignals);
  const isTaskOrIssue = domain === 'Project & Task Management' || /\b(task|tasks|todo|todos|issue|bug|ticket|jira|kanban)\b/i.test(allSignals);

  const rawClean = (project.name || 'System').replace(/[^a-zA-Z0-9]/g, '');
  const cleanPrefix = rawClean.charAt(0).toUpperCase() + rawClean.slice(1, 14);

  // Default clean application schema
  let b1 = { title: 'SystemAuditLog', pk: 'id', attrs: ['eventAction', 'ipAddress', 'requestPath', 'statusCode', 'timestamp'] };
  let b2 = { title: `${cleanPrefix}Record`, pk: 'id', attrs: ['recordTitle', 'description', 'category', 'status', 'updatedAt'] };
  let b3 = { title: 'ConfigurationSetting', pk: 'id', attrs: ['settingKey', 'settingValue', 'scope', 'isActive', 'updatedAt'] };
  let b4 = { title: 'TransactionEvent', pk: 'id', attrs: ['actionType', 'payloadDetails', 'sourceChannel', 'createdAt'] };
  let b5 = { title: hasAuth ? 'UserAccount' : 'ClientEntity', pk: 'id', attrs: ['username', 'email', 'role', 'fullName', 'createdAt'] };
  let rel0 = 'submits (0..*)';
  let rel1 = 'manages (0..*)';
  let rel2 = 'configures (1..*)';
  let rel3 = 'triggers (0..*)';

  if (isStudent) {
    b1 = { title: 'FeedbackInquiry', pk: 'id', attrs: ['studentName', 'email', 'subject', 'message', 'submittedAt'] };
    b2 = { title: 'AttendanceRecord', pk: 'id', attrs: ['attendanceDate', 'status', 'session', 'course', 'recordedAt'] };
    b3 = { title: 'CourseSubject', pk: 'id', attrs: ['subjectName', 'subjectCode', 'credits', 'semester'] };
    b4 = { title: 'FacultyGuide', pk: 'id', attrs: ['facultyName', 'department', 'designation', 'email', 'phone'] };
    b5 = { title: 'Student', pk: 'studentId', attrs: ['rollNumber', 'fullName', 'courseName', 'enrollmentNo', 'email'] };
    rel0 = 'submits (0..*)';
    rel1 = 'records (1..*)';
    rel2 = 'enrolls (1..*)';
    rel3 = 'mentors (1..*)';
  } else if (isEcommerce) {
    b1 = { title: 'CustomerInquiry', pk: 'id', attrs: ['customerName', 'email', 'subject', 'message', 'createdAt'] };
    b2 = { title: 'ProductCatalog', pk: 'id', attrs: ['productName', 'unitPrice', 'stockQuantity', 'category', 'imageUrl'] };
    b3 = { title: 'CustomerOrder', pk: 'id', attrs: ['orderDate', 'totalAmount', 'orderStatus', 'paymentMethod'] };
    b4 = { title: 'PaymentReceipt', pk: 'id', attrs: ['amountPaid', 'paymentStatus', 'gatewayRef', 'orderId'] };
    b5 = { title: 'CustomerAccount', pk: 'customerId', attrs: ['fullName', 'email', 'phoneNumber', 'address', 'createdAt'] };
    rel0 = 'submits (0..*)';
    rel1 = 'browses (1..*)';
    rel2 = 'places (0..*)';
    rel3 = 'authorizes (1..1)';
  } else if (isHealthcare) {
    b1 = { title: 'EmergencyInquiry', pk: 'id', attrs: ['patientName', 'contactPhone', 'symptoms', 'recordedAt'] };
    b2 = { title: 'MedicalRecord', pk: 'id', attrs: ['diagnosis', 'prescription', 'treatmentDate', 'status'] };
    b3 = { title: 'DoctorSchedule', pk: 'id', attrs: ['doctorName', 'specialty', 'shiftTime', 'roomNumber'] };
    b4 = { title: 'AppointmentSlot', pk: 'id', attrs: ['appointmentDate', 'timeSlot', 'consultationFee', 'status'] };
    b5 = { title: 'PatientProfile', pk: 'patientId', attrs: ['fullName', 'age', 'gender', 'bloodGroup', 'contactPhone'] };
    rel0 = 'registers (0..*)';
    rel1 = 'diagnoses (1..*)';
    rel2 = 'books (0..*)';
    rel3 = 'treats (1..*)';
  } else if (isSocialOrChat) {
    b1 = { title: 'DirectMessage', pk: 'id', attrs: ['senderId', 'receiverId', 'messageText', 'sentAt', 'readStatus'] };
    b2 = { title: 'UserPost', pk: 'id', attrs: ['caption', 'mediaUrl', 'likeCount', 'publishedAt'] };
    b3 = { title: 'PostComment', pk: 'id', attrs: ['postId', 'authorId', 'commentText', 'createdAt'] };
    b4 = { title: 'UserFollow', pk: 'id', attrs: ['followerId', 'followingId', 'status', 'createdAt'] };
    b5 = { title: 'UserAccount', pk: 'userId', attrs: ['username', 'email', 'fullName', 'profilePicUrl', 'createdAt'] };
    rel0 = 'sends (0..*)';
    rel1 = 'publishes (0..*)';
    rel2 = 'comments (0..*)';
    rel3 = 'connects (0..*)';
  } else if (isTaskOrIssue) {
    b1 = { title: 'TaskComment', pk: 'id', attrs: ['taskId', 'authorName', 'commentBody', 'postedAt'] };
    b2 = { title: 'TaskItem', pk: 'id', attrs: ['title', 'description', 'priorityLevel', 'status', 'dueDate'] };
    b3 = { title: 'ProjectWorkspace', pk: 'id', attrs: ['workspaceName', 'category', 'status', 'deadline'] };
    b4 = { title: 'ActivityAuditLog', pk: 'id', attrs: ['actionType', 'timestamp', 'ipAddress', 'source'] };
    b5 = { title: 'UserProfile', pk: 'userId', attrs: ['username', 'email', 'role', 'fullName', 'createdAt'] };
    rel0 = 'posts (0..*)';
    rel1 = 'assigned (0..*)';
    rel2 = 'manages (1..*)';
    rel3 = 'tracks (1..*)';
  } else if (isFintech) {
    b1 = { title: 'SupportTicket', pk: 'id', attrs: ['accountNo', 'subject', 'queryText', 'openedAt'] };
    b2 = { title: 'BankAccount', pk: 'id', attrs: ['accountNumber', 'accountType', 'currentBalance', 'status'] };
    b3 = { title: 'FundTransfer', pk: 'id', attrs: ['fromAccount', 'toAccount', 'amount', 'transferDate'] };
    b4 = { title: 'TransactionAudit', pk: 'id', attrs: ['referenceNo', 'channel', 'ipAddress', 'timestamp'] };
    b5 = { title: 'AccountHolder', pk: 'holderId', attrs: ['fullName', 'nationalId', 'email', 'phoneNumber'] };
    rel0 = 'submits (0..*)';
    rel1 = 'maintains (1..*)';
    rel2 = 'executes (0..*)';
    rel3 = 'verifies (1..1)';
  } else if (isFramework) {
    b1 = { title: 'AccessLog', pk: 'id', attrs: ['clientIp', 'httpMethod', 'routePath', 'statusCode', 'timestamp'] };
    b2 = { title: 'RouteHandler', pk: 'id', attrs: ['pathPattern', 'httpMethod', 'handlerName', 'middlewareChain'] };
    b3 = { title: 'MiddlewareLayer', pk: 'id', attrs: ['middlewareName', 'executionOrder', 'routeScope', 'isActive'] };
    b4 = { title: 'ResponseCache', pk: 'id', attrs: ['cacheKey', 'contentLength', 'ttlSeconds', 'createdAt'] };
    b5 = { title: 'ServerInstance', pk: 'instanceId', attrs: ['hostAddress', 'portNumber', 'protocolMode', 'uptime'] };
    rel0 = 'logs (0..*)';
    rel1 = 'routes (1..*)';
    rel2 = 'executes (1..*)';
    rel3 = 'serves (0..*)';
  } else if (isPortfolio) {
    b1 = { title: 'ContactMessage', pk: 'id', attrs: ['name', 'email', 'message', 'createdAt', 'updatedAt'] };
    b2 = { title: 'ProjectShowcase', pk: 'id', attrs: ['title', 'description', 'category', 'url', 'image'] };
    b3 = { title: 'SkillItem', pk: 'id', attrs: ['name', 'proficiency', 'category'] };
    b4 = { title: 'WorkExperience', pk: 'id', attrs: ['title', 'company', 'startDate', 'endDate', 'description'] };
    b5 = { title: 'DeveloperProfile', pk: 'userId', attrs: ['fullName', 'email', 'bioSummary', 'location', 'profileImage'] };
    rel0 = 'submits (1..*)';
    rel1 = 'creates (0..*)';
    rel2 = 'possesses (1..*)';
    rel3 = 'holds (0..*)';
  }

  const w = 230, h = 165;
  const b1_svg = renderErBox(25, 25, w, h, b1.title, b1.pk, b1.attrs);
  const b2_svg = renderErBox(325, 25, w, h, b2.title, b2.pk, b2.attrs);
  const b3_svg = renderErBox(625, 25, w, h, b3.title, b3.pk, b3.attrs);
  const b4_svg = renderErBox(25, 250, w, h, b4.title, b4.pk, b4.attrs);
  const b5_svg = renderErBox(325, 250, w, h, b5.title, b5.pk, b5.attrs);

  return `<div class="diagram-wrap diagram-er-wrap">
  <svg viewBox="0 0 880 435" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff; font-family:'Times New Roman',Times,serif;">
    <!-- 5 Entity Boxes -->
    ${b1_svg}
    ${b2_svg}
    ${b3_svg}
    ${b4_svg}
    ${b5_svg}

    <!-- Diagonal Line: Box 5 top-left to Box 1 bottom-right -->
    <line x1="325" y1="250" x2="255" y2="190" stroke="#000000" stroke-width="1.3" />
    <g transform="translate(245, 212)">
      <rect x="0" y="-10" width="88" height="16" fill="#ffffff" stroke="#000000" stroke-width="0.8" rx="2" />
      <text x="44" y="2" text-anchor="middle" font-size="9.5" font-family="'Times New Roman',Times,serif" fill="#000000">${rel0}</text>
    </g>

    <!-- Vertical Line: Box 5 top to Box 2 bottom -->
    <line x1="440" y1="250" x2="440" y2="190" stroke="#000000" stroke-width="1.3" />
    <g transform="translate(440, 220)">
      <rect x="-44" y="-9" width="88" height="16" fill="#ffffff" stroke="#000000" stroke-width="0.8" rx="2" />
      <text x="0" y="3" text-anchor="middle" font-size="9.5" font-family="'Times New Roman',Times,serif" fill="#000000">${rel1}</text>
    </g>

    <!-- Diagonal Line: Box 5 top-right to Box 3 bottom-left -->
    <line x1="555" y1="250" x2="625" y2="190" stroke="#000000" stroke-width="1.3" />
    <g transform="translate(548, 212)">
      <rect x="0" y="-10" width="88" height="16" fill="#ffffff" stroke="#000000" stroke-width="0.8" rx="2" />
      <text x="44" y="2" text-anchor="middle" font-size="9.5" font-family="'Times New Roman',Times,serif" fill="#000000">${rel2}</text>
    </g>

    <!-- Horizontal Line: Box 5 left to Box 4 right -->
    <line x1="325" y1="332" x2="255" y2="332" stroke="#000000" stroke-width="1.3" />
    <g transform="translate(290, 332)">
      <rect x="-44" y="-8" width="88" height="16" fill="#ffffff" stroke="#000000" stroke-width="0.8" rx="2" />
      <text x="0" y="3" text-anchor="middle" font-size="9.5" font-family="'Times New Roman',Times,serif" fill="#000000">${rel3}</text>
    </g>
  </svg>
  <p class="diagram-caption">Figure 10.3: Entity-Relationship (ER) Diagram</p>
</div>`;
}

function injectSystemDesignDiagrams(html, project) {
  const dfd0 = generateDfd0Svg(project);
  const dfd1 = generateDfd1Svg(project);
  const er = generateErDiagramSvg(project);

  let updated = html;

  // 1. Inject 0-Level DFD
  if (/<h4>\s*0-Level DFD[\s\S]*?<\/p>/i.test(updated)) {
    updated = updated.replace(/(<h4>\s*0-Level DFD[\s\S]*?<\/p>)/i, `$1\n\n${dfd0}\n\n`);
  } else if (/<h3>\s*Data Flow Diagrams[\s\S]*?<\/p>/i.test(updated)) {
    updated = updated.replace(/(<h3>\s*Data Flow Diagrams[\s\S]*?<\/p>)/i, `$1\n\n${dfd0}\n\n`);
  } else {
    updated = `${dfd0}\n\n` + updated;
  }

  // 2. Inject 1-Level DFD
  if (/<h4>\s*1-Level DFD[\s\S]*?<\/p>/i.test(updated)) {
    updated = updated.replace(/(<h4>\s*1-Level DFD[\s\S]*?<\/p>)/i, `$1\n\n${dfd1}\n\n`);
  } else if (/Figure 10\.1[\s\S]*?<\/p>/i.test(updated)) {
    updated = updated.replace(/(Figure 10\.1[\s\S]*?<\/p>)/i, `$1\n\n<h4>1-Level DFD</h4>\n<p>The 1-Level Data Flow Diagram expands the system boundary, illustrating the internal sub-processes, data transactions, and interactions between external entities and storage repositories.</p>\n\n${dfd1}\n\n`);
  } else {
    updated += `\n\n<h4>1-Level DFD</h4>\n\n${dfd1}\n\n`;
  }

  // 3. Inject ER Diagram on a dedicated clean page
  const erBlock = `\n\n<div class="er-section">
<h3 class="er-heading">Entity-Relationship Diagram</h3>
<p>The Entity-Relationship (ER) diagram below models the conceptual and physical database schema for ${escapeHtml(project.name || 'the system')}, establishing core entities, primary key attributes, and relational cardinalities governing data integrity.</p>

${er}
</div>\n\n`;

  if (updated.includes('class="er-section"')) {
    updated = updated.replace(/<div class="er-section">[\s\S]*?<\/div>\s*(?:<\/div>)?/i, erBlock);
  } else if (/<h3>\s*Entity-Relationship Diagram[\s\S]*?<\/p>/i.test(updated)) {
    updated = updated.replace(/<h3>\s*Entity-Relationship Diagram[\s\S]*?<\/p>/i, erBlock);
  } else if (/Entity-Relationship/i.test(updated)) {
    updated = updated.replace(/<h[34][^>]*>[^<]*Entity-Relationship[\s\S]*?<\/p>/i, erBlock);
  } else {
    updated += erBlock;
  }

  return updated;
}

async function generateSingleChapter({
  chapterIndex,
  project,
  student,
  template,
  isCancelled,
}) {
  if (isCancelled && isCancelled()) {
    throw new Error("Client aborted request");
  }
  const def = CHAPTER_DEFINITIONS.find((c) => c.index === Number(chapterIndex));
  if (!def) throw new Error(`Invalid chapter index: ${chapterIndex}`);
  let prompt = def.buildPrompt({ project, student, template });
  if (project.analysis?.hasAuth === false) {
    prompt += `\nSTRICT NEGATIVE CONSTRAINT: This project DOES NOT have user authentication, login/signup portals, or JWT tokens. NEVER mention JWT, token signing, password hashing, or authentication. Only describe actual detected modules: ${(project.analysis?.modules || []).join(", ")}.`;
  }
  let content = await callGroq([{ role: "user", content: prompt }], 0.35, 4, isCancelled);

  if (Number(chapterIndex) === 10) {
    content = injectSystemDesignDiagrams(content, project);
  }

  return content;
}

async function generateFullComprehensiveSynopsis({
  project,
  student,
  template,
  isCancelled,
}) {
  const chaptersHtml = [];
  const batchSize = 3;
  for (let i = 0; i < CHAPTER_DEFINITIONS.length; i += batchSize) {
    // Early break if client cancelled / disconnected to save Groq API tokens
    if (isCancelled && isCancelled()) {
      console.log("Client aborted synopsis generation. Terminating subsequent AI batches.");
      break;
    }
    const batch = CHAPTER_DEFINITIONS.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (chapterDef) => {
        if (isCancelled && isCancelled()) return "";
        let prompt = chapterDef.buildPrompt({ project, student, template });
        if (project.analysis?.hasAuth === false) {
          prompt += `\nSTRICT NEGATIVE CONSTRAINT: This project DOES NOT have user authentication, login/signup portals, or JWT tokens. NEVER mention JWT, token signing, password hashing, or authentication. Only describe actual detected modules: ${(project.analysis?.modules || []).join(", ")}.`;
        }
        let chContent = await callGroq(
          [{ role: "user", content: prompt }],
          0.35,
          4,
          isCancelled
        );
        if (chapterDef.index === 10) {
          chContent = injectSystemDesignDiagrams(chContent, project);
        }
        return chContent;
      }),
    );
    if (isCancelled && isCancelled()) {
      console.log("Client aborted synopsis generation after batch. Exiting loop.");
      break;
    }
    chaptersHtml.push(...results.filter(Boolean));
  }
  return chaptersHtml.join('\n\n<hr class="chapter-divider" />\n\n');
}

async function generateModularDoc({ docType, project, student }) {
  let prompt = `You are a lead technical writer. Generate a comprehensive, professional, production-grade "${docType}" for the following project.
Output clean semantic HTML only (with <h2>, <h3>, <p>, <ul>, <ol>, <code>, <pre>, <table>). No markdown fences or page boilerplate.

Project Name: ${project.name}
Description: ${project.description}
Tech Stack: ${(project.analysis?.stack || []).join(", ")}
Modules: ${(project.analysis?.modules || []).join(", ")}
Architecture: ${project.analysis?.architecture}
Student/Author: ${student?.studentName || "Student Developer"}

Make the content deeply technical, practical, formatted cleanly, and directly applicable to this specific project.`;

  if (project.analysis?.hasAuth === false) {
    prompt += `\nSTRICT NEGATIVE CONSTRAINT: This project has NO login/JWT authentication. Do NOT include authentication or tokens.`;
  }

  return await callGroq([{ role: "user", content: prompt }], 0.35);
}

async function generateVivaQuestions({ project }) {
  let prompt = `You are an external university viva examiner and technical lead interviewing a candidate on their final-year software project.

Generate 10 in-depth, challenging Viva-Voce questions with comprehensive model answers tailored specifically to this project's technology stack and architecture.

Project Name: ${project.name}
Description: ${project.description}
Tech Stack: ${(project.analysis?.stack || []).join(", ")}
Modules: ${(project.analysis?.modules || []).join(", ")}
Architecture: ${project.analysis?.architecture}

Output a clean JSON array with exactly this format:
[
  {
    "question": "Detailed technical or conceptual question?",
    "answer": "Clear, direct, authoritative answer explaining the engineering rationale, trade-offs, and implementation details."
  }
]
Do NOT include any markdown code fences or other text. Output pure JSON only.`;

  if (project.analysis?.hasAuth === false) {
    prompt += `\nSTRICT NEGATIVE CONSTRAINT: This project has NO login/JWT authentication. Focus questions on frontend, backend REST APIs, database queries, and deployment.`;
  }

  const raw = await callGroq([{ role: "user", content: prompt }], 0.4);
  try {
    const cleanJson = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return JSON.parse(cleanJson);
  } catch (_) {
    return [
      {
        question: `What is the architectural pattern used in ${project.name}?`,
        answer:
          project.analysis?.architecture ||
          "Modular client-server architecture separating UI, REST routing, and database storage.",
      },
      {
        question: "How is data persistence and state managed across requests?",
        answer: `Persistent records are stored in ${project.analysis?.stack?.find((s) => /mongo|sql|db/i.test(s)) || "the database"}, handled asynchronously through backend endpoints.`,
      },
    ];
  }
}

module.exports = {
  CHAPTER_DEFINITIONS,
  generateSingleChapter,
  generateFullComprehensiveSynopsis,
  generateSynopsis: generateFullComprehensiveSynopsis,
  generateModularDoc,
  generateVivaQuestions,
  generateErDiagramSvg,
  generateDfd1Svg,
};
