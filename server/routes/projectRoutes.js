const express = require("express");
const Project = require("../models/Project");
const { protect } = require("../middleware/auth");
const {
  generateSynopsis,
  generateSingleChapter,
  generateModularDoc,
  generateVivaQuestions,
} = require("../services/groq");
const { createPdf } = require("../services/pdf");

const router = express.Router();

function parseGithubUrl(rawUrl) {
  let clean = String(rawUrl || "").trim();
  if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
    clean = "https://" + clean;
  }
  let urlObj;
  try {
    urlObj = new URL(clean);
  } catch (_) {
    throw new Error("Please enter a valid URL (e.g. https://github.com/owner/repository).");
  }

  if (!urlObj.hostname.includes("github.com")) {
    throw new Error("Only GitHub repositories are supported. Please provide a github.com URL.");
  }

  const parts = urlObj.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Please provide a full repository URL containing owner and repository name.");
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  return { owner, repo, canonicalUrl: `https://github.com/${owner}/${repo}` };
}

async function buildAnalysis(url) {
  const { owner, repo, canonicalUrl } = parseGithubUrl(url);
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Repo2Synopsis-AI",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const [repoResponse, languageResponse, treeResponse] = await Promise.all([
    fetch(base, { headers }),
    fetch(`${base}/languages`, { headers }),
    fetch(`${base}/git/trees/HEAD?recursive=1`, { headers }),
  ]);

  if (!repoResponse.ok) {
    if (repoResponse.status === 404) {
      throw new Error(`Repository not found (${owner}/${repo}). Please check the URL and verify repository is public or GITHUB_TOKEN has access.`);
    }
    if (repoResponse.status === 403) {
      throw new Error("GitHub API rate limit exceeded. Please add a GITHUB_TOKEN to your environment or try again later.");
    }
    const errBody = await repoResponse.json().catch(() => ({}));
    throw new Error(errBody.message || `GitHub error: HTTP ${repoResponse.status}`);
  }

  const repository = await repoResponse.json();
  const languageData = languageResponse.ok ? await languageResponse.json() : {};
  const treeData = treeResponse.ok ? await treeResponse.json() : { tree: [] };
  const paths = (treeData.tree || []).map((file) => file.path);

  if (paths.length === 0) {
    throw new Error("The repository is empty or has no accessible files on its default branch.");
  }

  // Extract declared dependencies from package.json if present
  let declaredDependencies = [];
  if (paths.some((p) => /^package\.json$/i.test(p))) {
    try {
      const pkgRes = await fetch(`${base}/contents/package.json`, {
        headers: { ...headers, Accept: "application/vnd.github.raw" },
      });
      if (pkgRes.ok) {
        const pkg = JSON.parse(await pkgRes.text());
        declaredDependencies = [
          ...Object.keys(pkg.dependencies || {}),
          ...Object.keys(pkg.devDependencies || {}),
        ];
      }
    } catch (_) {}
  }

  // Extract README summary if present
  let readmeSnippet = "";
  try {
    const readmeRes = await fetch(`${base}/readme`, {
      headers: { ...headers, Accept: "application/vnd.github.raw" },
    });
    if (readmeRes.ok) {
      const rawText = await readmeRes.text();
      readmeSnippet = rawText.slice(0, 800).replace(/<[^>]+>/g, "").replace(/[\r\n]+/g, " ").trim();
    }
  } catch (_) {}

  const totalBytes =
    Object.values(languageData).reduce((sum, bytes) => sum + bytes, 0) || 1;
  const languages = Object.entries(languageData)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, bytes]) => ({
      name,
      percent: Math.round((bytes / totalBytes) * 100),
    }));

  const stack = [...languages.map((language) => language.name)];

  if (declaredDependencies.length > 0) {
    if (declaredDependencies.includes("express")) stack.push("Express.js");
    if (declaredDependencies.includes("react")) stack.push("React");
    if (declaredDependencies.includes("next")) stack.push("Next.js");
    if (declaredDependencies.includes("vue")) stack.push("Vue.js");
    if (declaredDependencies.includes("mongoose") || declaredDependencies.includes("mongodb")) stack.push("MongoDB / Mongoose");
    if (declaredDependencies.includes("pg") || declaredDependencies.includes("prisma") || declaredDependencies.includes("sequelize")) stack.push("PostgreSQL / Relational Database");
    if (declaredDependencies.includes("tailwindcss")) stack.push("Tailwind CSS");
    if (declaredDependencies.includes("socket.io")) stack.push("Socket.io");
  }

  const addStack = (name, tests) => {
    if (tests.some((test) => paths.some((path) => path.toLowerCase().includes(test)))) {
      stack.push(name);
    }
  };
  addStack("Node.js", ["package.json", "server.js", "app.js"]);
  addStack("Express.js", ["express", "server.js", "routes/"]);
  addStack("React", ["src/app.", "src/index.", "vite.config", "react"]);
  addStack("Next.js", ["next.config", "pages/", "app/"]);
  addStack("Vue.js", ["vue.config", "vite.config", ".vue"]);
  addStack("MongoDB / Mongoose", ["mongoose", "mongo"]);
  addStack("PostgreSQL", ["pg", "sequelize", "typeorm", "prisma"]);
  addStack("Tailwind CSS", ["tailwind.config", "tailwind"]);
  addStack("Python / Django / Flask", ["manage.py", "app.py", "wsgi.py", "requirements.txt"]);

  const hasBackend = paths.some((p) => /server|app\.(js|ts|py)|wsgi|manage\.py|routes|controllers|api/i.test(p));
  const hasDb = paths.some((p) => /mongo|mongoose|pg|prisma|sequelize|typeorm|database|schema|model|sql/i.test(p));
  const hasAuth =
    declaredDependencies.some((d) => ["jsonwebtoken", "jwt", "bcrypt", "bcryptjs", "passport", "next-auth", "auth0"].includes(d.toLowerCase())) ||
    paths.some((p) => /auth|login|signup|register|jwt|bcrypt|passport/i.test(p));
  const hasContact = paths.some((p) => /contact|mail|message|inquiry|form/i.test(p));
  const hasTesting = paths.some((p) => /test|spec|jest|mocha|cypress/i.test(p));
  const hasFiles = paths.some((p) => /upload|multer|s3|storage|media|asset/i.test(p));

  const modules = [];
  modules.push("Client Presentation & Responsive User Interface");

  if (hasBackend) {
    modules.push("Server-Side REST Routing & Controller Layer");
  }
  if (hasContact) {
    modules.push("Contact Submission & Client Inquiries Handler");
  }
  if (hasDb) {
    modules.push("Data Persistence & Storage Engine");
  }
  if (hasAuth) {
    modules.push("User Authentication & Security Layer");
  }
  if (hasFiles) {
    modules.push("File Upload & Media Asset Management");
  }
  if (hasTesting) {
    modules.push("Automated Testing & Quality Assurance Suite");
  }

  if (modules.length === 1) {
    modules.push("Core Application Execution Logic");
  }

  const allSignals = `${repository.name} ${repository.description || ''} ${readmeSnippet} ${stack.join(' ')} ${declaredDependencies.join(' ')}`.toLowerCase();
  const repoMeta = `${repository.name} ${repository.description || ''}`.toLowerCase();
  let domain = 'General Application';

  if (/portfolio|protfolio|resume|personal[-_\s]*web|curriculum[-_\s]*vitae|\bcv\b/i.test(repoMeta)) {
    domain = 'Developer Portfolio & Showcase';
  } else if (/framework|routing|middleware|\bexpress\b|router|server[-_\s]*core|microservice/i.test(repoMeta) || repository.name.toLowerCase() === 'express') {
    domain = 'Web Framework & Server Engine';
  } else if (/\b(student|students|attendance|college|school|university|academic|faculty|classroom|edtech|lms)\b/i.test(allSignals)) {
    domain = 'Education & Academic Management';
  } else if (/\b(health|hospital|doctor|doctors|patient|patients|clinic|clinical|medical|medicine|pharmacy|appointment)\b/i.test(allSignals)) {
    domain = 'Healthcare & Hospital Management';
  } else if (/\b(ecommerce|e-commerce|shopping|cart|checkout|store|billing|inventory)\b/i.test(allSignals)) {
    domain = 'E-Commerce & Retail Platform';
  } else if (/\b(bank|banking|finance|fintech|wallet|crypto|cryptocurrency|loan|payment|transactions?)\b/i.test(allSignals)) {
    domain = 'FinTech & Financial Transactions';
  } else if (/\b(chat|messaging|social|forum|community|tweet|feed)\b/i.test(allSignals)) {
    domain = 'Social Media & Real-time Collaboration';
  } else if (/\b(task|tasks|todo|todos|issue|bug|ticket|jira|kanban|workflow)\b/i.test(allSignals)) {
    domain = 'Project & Task Management';
  } else if (/framework|routing|middleware|router|microservice/i.test(allSignals)) {
    domain = 'Web Framework & Server Engine';
  }

  return {
    name: repository.name,
    canonicalUrl,
    description:
      repository.description ||
      readmeSnippet ||
      "Software engineering project analyzed for university project synopsis.",
    domain,
    languages:
      languages.length > 0 ? languages : [{ name: "JavaScript", percent: 100 }],
    stack: [...new Set(stack)],
    dependencies: declaredDependencies,
    modules: [...new Set(modules)],
    hasAuth: Boolean(hasAuth),
    hasBackend: Boolean(hasBackend),
    hasDb: Boolean(hasDb),
    files: paths.filter((file) => !file.endsWith("/")).length,
    architecture: hasBackend
      ? `Layered full-stack client-server architecture analyzed from repository branch (${repository.default_branch || "main"}).`
      : `Single-page client presentation architecture analyzed from repository branch (${repository.default_branch || "main"}).`,
  };
}

router.post("/analyze", protect, async (req, res, next) => {
  const { repositoryUrl } = req.body;
  if (!repositoryUrl) {
    return res.status(400).json({ message: "Please enter a valid GitHub repository URL." });
  }

  try {
    const analysis = await buildAnalysis(repositoryUrl);
    const project = await Project.create({
      owner: req.user._id,
      repositoryUrl: analysis.canonicalUrl || repositoryUrl.trim(),
      name: analysis.name,
      description: analysis.description,
      analysis,
    });
    res.status(201).json(project);
  } catch (error) {
    next(error);
  }
});

router.get("/", protect, async (req, res) =>
  res.json(await Project.find({ owner: req.user._id }).sort("-createdAt")),
);

router.post("/:id/synopsis/chapter", protect, async (req, res, next) => {
  let isCancelled = false;
  req.on("close", () => {
    if (!res.writableEnded) {
      isCancelled = true;
    }
  });

  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    if (isCancelled || req.destroyed) return;

    const { chapterIndex, details, template } = req.body;
    const content = await generateSingleChapter({
      chapterIndex: Number(chapterIndex),
      project,
      student: details || project.documents?.details,
      template: template || {},
      isCancelled: () => isCancelled || req.destroyed,
    });

    if (isCancelled || req.destroyed) return;

    res.json({ content, chapterIndex: Number(chapterIndex) });
  } catch (error) {
    if (isCancelled || req.destroyed) {
      console.log(`Client cancelled chapter request for project ${req.params.id}`);
      return;
    }
    next(error);
  }
});

router.post("/:id/synopsis", protect, async (req, res, next) => {
  let isCancelled = false;
  req.on("close", () => {
    if (!res.writableEnded) {
      isCancelled = true;
    }
  });

  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });
    if (!project)
      return res.status(404).json({ message: "Project not found." });

    if (isCancelled || req.destroyed) return;

    const synopsis = await generateSynopsis({
      project,
      student: req.body.details,
      template: req.body.template,
      isCancelled: () => isCancelled || req.destroyed,
    });

    if (isCancelled || req.destroyed) {
      console.log(`Client aborted full synopsis generation for project ${req.params.id}`);
      return;
    }

    project.documents = {
      ...project.documents,
      synopsis,
      details: req.body.details,
      assets: req.body.assets || {},
    };
    await project.save();
    res.json({ synopsis });
  } catch (error) {
    if (isCancelled || req.destroyed) {
      console.log(`Client aborted full synopsis generation for project ${req.params.id}`);
      return;
    }
    next(error);
  }
});

router.post("/:id/doc", protect, async (req, res, next) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });
    if (!project)
      return res.status(404).json({ message: "Project not found." });
    const { docType, details } = req.body;
    const content = await generateModularDoc({
      docType: docType || "API Documentation",
      project,
      student: details || project.documents?.details,
    });
    res.json({ content, docType });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/viva", protect, async (req, res, next) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });
    if (!project)
      return res.status(404).json({ message: "Project not found." });
    const questions = await generateVivaQuestions({ project });
    res.json({ questions });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/export/pdf", protect, async (req, res, next) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      owner: req.user._id,
    });
    if (!project)
      return res.status(404).json({ message: "Project not found." });
    const pdf = await createPdf({
      project,
      synopsis:
        req.body.synopsis ||
        project.documents?.synopsis ||
        "<h2>Project Synopsis</h2>",
      details: req.body.details || project.documents?.details || {},
      assets: req.body.assets || project.documents?.assets || {},
    });
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${project.name}-synopsis.pdf"`,
    });
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/documents", protect, async (req, res) => {
  const project = await Project.findOneAndUpdate(
    { _id: req.params.id, owner: req.user._id },
    { documents: req.body.documents },
    { new: true },
  );
  if (!project) return res.status(404).json({ message: "Project not found." });
  res.json(project);
});

module.exports = router;
