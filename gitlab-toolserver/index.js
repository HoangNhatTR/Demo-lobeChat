const express = require("express");
const cors = require("cors");
const https = require("https");
const http = require("http");
const { URL } = require("url");

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const PORT = process.env.PORT || 3101;
// PUBLIC_URL can be set to an absolute public URL (eg https://abcd.ngrok.io)
// If provided, manifest and OpenAPI servers will use it to produce absolute URLs
const PUBLIC_URL = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, "") : null;
const GITLAB_API_URL = (process.env.GITLAB_API_URL || "https://gitlab.com/api/v4").replace(/\/+$/, "");
const GITLAB_TOKEN = process.env.GITLAB_PERSONAL_ACCESS_TOKEN || "";
const PLUGIN_NAME = process.env.PLUGIN_NAME || "gitlab";
const PLUGIN_LABEL = process.env.PLUGIN_LABEL || "GitLab";

// ---------------------------------------------------------------------------
// Helper – call GitLab REST API
// ---------------------------------------------------------------------------

function gitlabFetch(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const separator = path.startsWith("/") ? "" : "/";
    const fullUrl = `${GITLAB_API_URL}${separator}${path}`;
    const parsed = new URL(fullUrl);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        "PRIVATE-TOKEN": GITLAB_TOKEN,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    };

    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// LobeChat Plugin manifest
// ---------------------------------------------------------------------------

app.get("/.well-known/ai-plugin.json", (_req, res) => {
  res.json({
    schema_version: "v1",
    name_for_human: PLUGIN_LABEL,
    name_for_model: PLUGIN_NAME,
    description_for_human: "Interact with GitLab — projects, issues, merge requests, pipelines, code.",
    description_for_model:
      "Use this plugin to interact with a GitLab instance. When listing projects, always use owned=true to list only the user's own projects unless explicitly asked for all projects. You can list projects, get project details, list/create issues, list/view merge requests, list branches, view file contents, search code, and check pipeline status.",
    auth: { type: "none" },
    api: {
      type: "openapi",
      url: PUBLIC_URL ? `${PUBLIC_URL}/openapi.json` : `/openapi.json`,
    },
    logo_url: "https://about.gitlab.com/images/press/press-kit-icon.svg",
    contact_email: "admin@localhost",
    legal_info_url: "https://about.gitlab.com/terms/",
  });
});

// ---------------------------------------------------------------------------
// OpenAPI specification
// ---------------------------------------------------------------------------

app.get("/openapi.json", (_req, res) => {
  res.json({
    openapi: "3.1.0",
    info: {
      title: "GitLab Tool Server",
      description: "Provides GitLab operations as tools for LobeChat",
      version: "1.0.0",
    },
    servers: [{ url: `http://host.docker.internal:${PORT}` }],
    paths: {
      "/api/projects": {
        get: {
          operationId: "listProjects",
          summary: "List GitLab projects",
          description: "List GitLab projects owned by the authenticated user. Use owned=true (default) to list user's own projects, or owned=false to list all accessible projects.",
          parameters: [
            { name: "search", in: "query", schema: { type: "string" }, description: "Search term" },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "per_page", in: "query", schema: { type: "integer", default: 20 } },
            { name: "owned", in: "query", schema: { type: "boolean", default: true }, description: "Only list owned projects (default: true)" },
          ],
          responses: { 200: { description: "List of projects" } },
        },
      },
      "/api/projects/{id}": {
        get: {
          operationId: "getProject",
          summary: "Get project details",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Project ID or URL-encoded path" },
          ],
          responses: { 200: { description: "Project details" } },
        },
      },
      "/api/projects/{id}/issues": {
        get: {
          operationId: "listIssues",
          summary: "List issues of a project",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "state", in: "query", schema: { type: "string", enum: ["opened", "closed", "all"], default: "opened" } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "per_page", in: "query", schema: { type: "integer", default: 20 } },
          ],
          responses: { 200: { description: "List of issues" } },
        },
        post: {
          operationId: "createIssue",
          summary: "Create a new issue",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    labels: { type: "string", description: "Comma-separated labels" },
                    assignee_ids: { type: "array", items: { type: "integer" } },
                    milestone_id: { type: "integer" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Created issue" } },
        },
      },
      "/api/projects/{id}/issues/{issue_iid}": {
        get: {
          operationId: "getIssue",
          summary: "Get a single issue",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "issue_iid", in: "path", required: true, schema: { type: "integer" } },
          ],
          responses: { 200: { description: "Issue details" } },
        },
      },
      "/api/projects/{id}/merge_requests": {
        get: {
          operationId: "listMergeRequests",
          summary: "List merge requests of a project",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "state", in: "query", schema: { type: "string", enum: ["opened", "closed", "merged", "all"], default: "opened" } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "per_page", in: "query", schema: { type: "integer", default: 20 } },
          ],
          responses: { 200: { description: "List of merge requests" } },
        },
      },
      "/api/projects/{id}/merge_requests/{mr_iid}": {
        get: {
          operationId: "getMergeRequest",
          summary: "Get merge request details",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "mr_iid", in: "path", required: true, schema: { type: "integer" } },
          ],
          responses: { 200: { description: "Merge request details" } },
        },
      },
      "/api/projects/{id}/merge_requests/{mr_iid}/changes": {
        get: {
          operationId: "getMergeRequestChanges",
          summary: "Get merge request diff/changes",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "mr_iid", in: "path", required: true, schema: { type: "integer" } },
          ],
          responses: { 200: { description: "MR changes/diff" } },
        },
      },
      "/api/projects/{id}/repository/branches": {
        get: {
          operationId: "listBranches",
          summary: "List repository branches",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "search", in: "query", schema: { type: "string" } },
          ],
          responses: { 200: { description: "List of branches" } },
        },
      },
      "/api/projects/{id}/repository/files/{file_path}": {
        get: {
          operationId: "getFileContent",
          summary: "Get file content from repository",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "file_path", in: "path", required: true, schema: { type: "string" }, description: "URL-encoded file path" },
            { name: "ref", in: "query", schema: { type: "string", default: "main" }, description: "Branch or tag name" },
          ],
          responses: { 200: { description: "File content (base64 encoded)" } },
        },
      },
      "/api/projects/{id}/pipelines": {
        get: {
          operationId: "listPipelines",
          summary: "List project pipelines",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["running", "pending", "success", "failed", "canceled", "skipped", "manual"] } },
            { name: "ref", in: "query", schema: { type: "string" } },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "per_page", in: "query", schema: { type: "integer", default: 20 } },
          ],
          responses: { 200: { description: "List of pipelines" } },
        },
      },
      "/api/projects/{id}/pipelines/{pipeline_id}": {
        get: {
          operationId: "getPipeline",
          summary: "Get pipeline details",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "pipeline_id", in: "path", required: true, schema: { type: "integer" } },
          ],
          responses: { 200: { description: "Pipeline details" } },
        },
      },
      "/api/projects/{id}/pipelines/{pipeline_id}/jobs": {
        get: {
          operationId: "listPipelineJobs",
          summary: "List jobs of a pipeline",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "pipeline_id", in: "path", required: true, schema: { type: "integer" } },
          ],
          responses: { 200: { description: "List of pipeline jobs" } },
        },
      },
      "/api/search": {
        get: {
          operationId: "searchCode",
          summary: "Search code across projects",
          parameters: [
            { name: "search", in: "query", required: true, schema: { type: "string" } },
            { name: "scope", in: "query", schema: { type: "string", enum: ["projects", "issues", "merge_requests", "blobs"], default: "blobs" } },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "per_page", in: "query", schema: { type: "integer", default: 20 } },
          ],
          responses: { 200: { description: "Search results" } },
        },
      },
    },
  });
});

// ---------------------------------------------------------------------------
// LobeChat manifest (LobeChat custom format)
// ---------------------------------------------------------------------------

app.get("/manifest.json", (_req, res) => {
  const baseUrl = PUBLIC_URL ? PUBLIC_URL : `http://localhost:${PORT}`;
  res.json({
    api: [
      {
        name: "listProjects",
        description: "List GitLab projects owned by the authenticated user",
        parameters: {
          type: "object",
          properties: {
            search: { type: "string" },
            page: { type: "integer", default: 1 },
            per_page: { type: "integer", default: 20 },
            owned: { type: "boolean", default: true },
          },
        },
      },
      {
        name: "getProject",
        description: "Get project details",
        parameters: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
      {
        name: "listIssues",
        description: "List issues of a project",
        parameters: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            state: { type: "string", enum: ["opened", "closed", "all"], default: "opened" },
            search: { type: "string" },
            page: { type: "integer", default: 1 },
            per_page: { type: "integer", default: 20 },
          },
        },
      },
      {
        name: "createIssue",
        description: "Create a new issue",
        parameters: {
          type: "object",
          required: ["id", "_requestBody"],
          properties: {
            id: { type: "string" },
            _requestBody: {
              type: "object",
              required: ["title"],
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                labels: { type: "string" },
                assignee_ids: { type: "array", items: { type: "integer" } },
                milestone_id: { type: "integer" },
              },
            },
          },
        },
      },
      {
        name: "getIssue",
        description: "Get a single issue",
        parameters: {
          type: "object",
          required: ["id", "issue_iid"],
          properties: {
            id: { type: "string" },
            issue_iid: { type: "integer" },
          },
        },
      },
      {
        name: "listMergeRequests",
        description: "List merge requests of a project",
        parameters: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            state: { type: "string", enum: ["opened", "closed", "merged", "all"], default: "opened" },
            search: { type: "string" },
            page: { type: "integer", default: 1 },
            per_page: { type: "integer", default: 20 },
          },
        },
      },
      {
        name: "getMergeRequest",
        description: "Get merge request details",
        parameters: {
          type: "object",
          required: ["id", "mr_iid"],
          properties: { id: { type: "string" }, mr_iid: { type: "integer" } },
        },
      },
      {
        name: "getMergeRequestChanges",
        description: "Get merge request diff/changes",
        parameters: {
          type: "object",
          required: ["id", "mr_iid"],
          properties: { id: { type: "string" }, mr_iid: { type: "integer" } },
        },
      },
      {
        name: "listBranches",
        description: "List repository branches",
        parameters: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            search: { type: "string" },
          },
        },
      },
      {
        name: "getFileContent",
        description: "Get file content from repository",
        parameters: {
          type: "object",
          required: ["id", "file_path"],
          properties: {
            id: { type: "string" },
            file_path: { type: "string" },
            ref: { type: "string", default: "main" },
          },
        },
      },
      {
        name: "listPipelines",
        description: "List project pipelines",
        parameters: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["running", "pending", "success", "failed", "canceled", "skipped", "manual"] },
            ref: { type: "string" },
            page: { type: "integer", default: 1 },
            per_page: { type: "integer", default: 20 },
          },
        },
      },
      {
        name: "searchCode",
        description: "Search code across projects",
        parameters: {
          type: "object",
          required: ["search"],
          properties: {
            search: { type: "string" },
            scope: { type: "string", enum: ["projects", "issues", "merge_requests", "blobs"], default: "blobs" },
            page: { type: "integer", default: 1 },
            per_page: { type: "integer", default: 20 },
          },
        },
      },
    ],
    meta: {
      title: "GitLab",
      avatar: "https://about.gitlab.com/images/press/press-kit-icon.svg",
      description: "Interact with GitLab — projects, issues, merge requests, pipelines, code.",
    },
    type: "default",
    openapi: `${baseUrl}/openapi.json`,
    version: "1",
    homepage: "https://about.gitlab.com/terms/",
    settings: { type: "object", properties: {} },
    identifier: "gitlab",
    systemRole:
      "Use this plugin to interact with a GitLab instance. When listing projects, always use owned=true to list only the user's own projects unless explicitly asked for all projects. You can list projects, get project details, list/create issues, list/view merge requests, list branches, view file contents, search code, and check pipeline status.",
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeProjectId(id) {
  // If numeric, pass through; otherwise URL-encode the path
  return /^\d+$/.test(id) ? id : encodeURIComponent(id);
}

function buildQuery(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.append(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function pick(obj, keys) {
  const result = {};
  for (const k of keys) {
    if (k in obj) result[k] = obj[k];
  }
  return result;
}

// Summarize to reduce payload size for LLM context
function summarizeProject(p) {
  return pick(p, [
    "id", "name", "name_with_namespace", "path_with_namespace",
    "description", "web_url", "default_branch",
    "star_count", "forks_count", "open_issues_count",
    "visibility", "last_activity_at",
  ]);
}

function summarizeIssue(i) {
  return {
    ...pick(i, [
      "iid", "title", "state", "web_url", "description",
      "created_at", "updated_at", "labels",
    ]),
    author: i.author?.username,
    assignees: i.assignees?.map((a) => a.username),
    milestone: i.milestone?.title,
  };
}

function summarizeMR(mr) {
  return {
    ...pick(mr, [
      "iid", "title", "state", "web_url", "description",
      "source_branch", "target_branch", "merge_status",
      "created_at", "updated_at", "labels",
    ]),
    author: mr.author?.username,
    assignees: mr.assignees?.map((a) => a.username),
    reviewers: mr.reviewers?.map((r) => r.username),
  };
}

function summarizePipeline(p) {
  return pick(p, [
    "id", "iid", "status", "ref", "sha", "web_url",
    "created_at", "updated_at", "source",
  ]);
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// --- Projects ---
app.get("/api/projects", async (req, res) => {
  try {
    const q = buildQuery(pick(req.query, ["search", "page", "per_page", "owned", "membership"]));
    const r = await gitlabFetch(`/projects${q}`);
    const projects = Array.isArray(r.data) ? r.data.map(summarizeProject) : r.data;
    res.status(r.status).json(projects);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    const r = await gitlabFetch(`/projects/${encodeProjectId(req.params.id)}`);
    res.status(r.status).json(r.status === 200 ? summarizeProject(r.data) : r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Issues ---
app.get("/api/projects/:id/issues", async (req, res) => {
  try {
    const q = buildQuery(pick(req.query, ["state", "search", "page", "per_page", "labels", "assignee_username"]));
    const r = await gitlabFetch(`/projects/${encodeProjectId(req.params.id)}/issues${q}`);
    const issues = Array.isArray(r.data) ? r.data.map(summarizeIssue) : r.data;
    res.status(r.status).json(issues);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/projects/:id/issues", async (req, res) => {
  try {
    const body = pick(req.body, ["title", "description", "labels", "assignee_ids", "milestone_id"]);
    const r = await gitlabFetch(`/projects/${encodeProjectId(req.params.id)}/issues`, "POST", body);
    res.status(r.status).json(r.status === 201 ? summarizeIssue(r.data) : r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/projects/:id/issues/:issue_iid", async (req, res) => {
  try {
    const r = await gitlabFetch(`/projects/${encodeProjectId(req.params.id)}/issues/${req.params.issue_iid}`);
    res.status(r.status).json(r.status === 200 ? summarizeIssue(r.data) : r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Merge Requests ---
app.get("/api/projects/:id/merge_requests", async (req, res) => {
  try {
    const q = buildQuery(pick(req.query, ["state", "search", "page", "per_page"]));
    const r = await gitlabFetch(`/projects/${encodeProjectId(req.params.id)}/merge_requests${q}`);
    const mrs = Array.isArray(r.data) ? r.data.map(summarizeMR) : r.data;
    res.status(r.status).json(mrs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/projects/:id/merge_requests/:mr_iid", async (req, res) => {
  try {
    const r = await gitlabFetch(`/projects/${encodeProjectId(req.params.id)}/merge_requests/${req.params.mr_iid}`);
    res.status(r.status).json(r.status === 200 ? summarizeMR(r.data) : r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/projects/:id/merge_requests/:mr_iid/changes", async (req, res) => {
  try {
    const r = await gitlabFetch(`/projects/${encodeProjectId(req.params.id)}/merge_requests/${req.params.mr_iid}/changes`);
    if (r.status === 200 && r.data.changes) {
      // Trim large diffs to avoid blowing LLM context
      const changes = r.data.changes.map((c) => ({
        old_path: c.old_path,
        new_path: c.new_path,
        new_file: c.new_file,
        deleted_file: c.deleted_file,
        renamed_file: c.renamed_file,
        diff: c.diff?.substring(0, 3000),
      }));
      res.json({ ...summarizeMR(r.data), changes });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Branches ---
app.get("/api/projects/:id/repository/branches", async (req, res) => {
  try {
    const q = buildQuery(pick(req.query, ["search"]));
    const r = await gitlabFetch(`/projects/${encodeProjectId(req.params.id)}/repository/branches${q}`);
    if (Array.isArray(r.data)) {
      const branches = r.data.map((b) => ({
        name: b.name,
        merged: b.merged,
        protected: b.protected,
        default: b.default,
        web_url: b.web_url,
        last_commit: b.commit
          ? { id: b.commit.short_id, message: b.commit.title, authored_date: b.commit.authored_date }
          : null,
      }));
      res.json(branches);
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- File content ---
app.get("/api/projects/:id/repository/files/:file_path", async (req, res) => {
  try {
    const ref = req.query.ref || "main";
    const filePath = encodeURIComponent(req.params.file_path);
    const r = await gitlabFetch(`/projects/${encodeProjectId(req.params.id)}/repository/files/${filePath}?ref=${encodeURIComponent(ref)}`);
    if (r.status === 200 && r.data.content) {
      const decoded = Buffer.from(r.data.content, "base64").toString("utf-8");
      // Limit file content to 10 000 chars to avoid huge context
      const content = decoded.length > 10000 ? decoded.substring(0, 10000) + "\n... [truncated]" : decoded;
      res.json({
        file_name: r.data.file_name,
        file_path: r.data.file_path,
        size: r.data.size,
        ref: r.data.ref,
        content,
      });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Pipelines ---
app.get("/api/projects/:id/pipelines", async (req, res) => {
  try {
    const q = buildQuery(pick(req.query, ["status", "ref", "page", "per_page"]));
    const r = await gitlabFetch(`/projects/${encodeProjectId(req.params.id)}/pipelines${q}`);
    const pipelines = Array.isArray(r.data) ? r.data.map(summarizePipeline) : r.data;
    res.status(r.status).json(pipelines);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/projects/:id/pipelines/:pipeline_id", async (req, res) => {
  try {
    const r = await gitlabFetch(
      `/projects/${encodeProjectId(req.params.id)}/pipelines/${req.params.pipeline_id}`
    );
    res.status(r.status).json(r.status === 200 ? summarizePipeline(r.data) : r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/projects/:id/pipelines/:pipeline_id/jobs", async (req, res) => {
  try {
    const r = await gitlabFetch(
      `/projects/${encodeProjectId(req.params.id)}/pipelines/${req.params.pipeline_id}/jobs`
    );
    if (Array.isArray(r.data)) {
      const jobs = r.data.map((j) =>
        pick(j, ["id", "name", "stage", "status", "web_url", "duration", "created_at", "finished_at"])
      );
      res.json(jobs);
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Search ---
app.get("/api/search", async (req, res) => {
  try {
    const q = buildQuery(pick(req.query, ["search", "scope", "page", "per_page"]));
    const r = await gitlabFetch(`/search${q}`);
    res.status(r.status).json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`GitLab Tool Server running on port ${PORT}`);
  console.log(`  GitLab API: ${GITLAB_API_URL}`);
  console.log(`  Token configured: ${GITLAB_TOKEN ? "yes" : "NO — set GITLAB_PERSONAL_ACCESS_TOKEN"}`);
  console.log(`  Plugin manifest: http://localhost:${PORT}/.well-known/ai-plugin.json`);
  console.log(`  OpenAPI spec:    http://localhost:${PORT}/openapi.json`);
});
