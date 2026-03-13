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

const PORT = process.env.PORT || 3103;
const PUBLIC_URL = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, "") : null;
const JIRA_BASE_URL = (process.env.JIRA_BASE_URL || "").replace(/\/+$/, "").trim();
const JIRA_EMAIL = (process.env.JIRA_EMAIL || "").trim();
const JIRA_API_TOKEN = (process.env.JIRA_API_TOKEN || "").trim();

// Auto-detect: Jira Cloud (.atlassian.net) vs Jira Server/Data Center
const IS_CLOUD = JIRA_BASE_URL.includes(".atlassian.net");
const API_VERSION = IS_CLOUD ? "3" : "2";
const API_BASE = `/rest/api/${API_VERSION}`;

// Auth header:
//   Cloud  → Basic base64(email:api_token)
//   Server → Bearer <personal_access_token>
function getAuthHeader() {
  if (IS_CLOUD) {
    const basic = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
    return `Basic ${basic}`;
  }
  return `Bearer ${JIRA_API_TOKEN}`;
}

// ---------------------------------------------------------------------------
// Helper – call Jira REST API
// ---------------------------------------------------------------------------

function jiraFetch(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const separator = path.startsWith("/") ? "" : "/";
    const fullUrl = `${JIRA_BASE_URL}${separator}${path}`;
    const parsed = new URL(fullUrl);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // Allow self-signed certs for self-hosted Jira
      rejectUnauthorized: IS_CLOUD,
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
    name_for_human: "Jira",
    name_for_model: "jira",
    description_for_human: "Interact with Jira — projects, issues, sprints, boards, and comments.",
    description_for_model:
      "Use this plugin to interact with a Jira instance. You can search issues using JQL, list projects, get issue details, create/update issues, add comments, transition issue status, list boards, and list sprints.",
    auth: { type: "none" },
    api: {
      type: "openapi",
      url: PUBLIC_URL ? `${PUBLIC_URL}/openapi.json` : `/openapi.json`,
    },
    logo_url: "https://cdn.worldvectorlogo.com/logos/jira-1.svg",
    contact_email: "admin@localhost",
    legal_info_url: "https://www.atlassian.com/legal",
  });
});

// ---------------------------------------------------------------------------
// OpenAPI specification
// ---------------------------------------------------------------------------

app.get("/openapi.json", (_req, res) => {
  res.json({
    openapi: "3.1.0",
    info: {
      title: "Jira Tool Server",
      description: "Provides Jira operations as tools for LobeChat",
      version: "1.0.0",
    },
    servers: [{ url: `http://host.docker.internal:${PORT}` }],
    paths: {
      "/api/projects": {
        get: {
          operationId: "listProjects",
          summary: "List all Jira projects",
          parameters: [
            { name: "maxResults", in: "query", schema: { type: "integer", default: 50 }, description: "Max results to return" },
            { name: "startAt", in: "query", schema: { type: "integer", default: 0 }, description: "Index of first result" },
          ],
          responses: { 200: { description: "List of projects" } },
        },
      },
      "/api/projects/{projectKeyOrId}": {
        get: {
          operationId: "getProject",
          summary: "Get project details",
          parameters: [
            { name: "projectKeyOrId", in: "path", required: true, schema: { type: "string" }, description: "Project key (e.g. PROJ) or numeric ID" },
          ],
          responses: { 200: { description: "Project details" } },
        },
      },
      "/api/search": {
        get: {
          operationId: "searchIssues",
          summary: "Search issues using JQL",
          description: "Search Jira issues using JQL (Jira Query Language). Example JQL: project = PROJ AND status = 'In Progress' ORDER BY created DESC",
          parameters: [
            { name: "jql", in: "query", required: true, schema: { type: "string" }, description: "JQL query string" },
            { name: "maxResults", in: "query", schema: { type: "integer", default: 20 } },
            { name: "startAt", in: "query", schema: { type: "integer", default: 0 } },
          ],
          responses: { 200: { description: "Search results" } },
        },
      },
      "/api/issues/{issueKeyOrId}": {
        get: {
          operationId: "getIssue",
          summary: "Get issue details",
          parameters: [
            { name: "issueKeyOrId", in: "path", required: true, schema: { type: "string" }, description: "Issue key (e.g. PROJ-123) or ID" },
          ],
          responses: { 200: { description: "Issue details" } },
        },
      },
      "/api/issues": {
        post: {
          operationId: "createIssue",
          summary: "Create a new issue",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["projectKey", "summary", "issueType"],
                  properties: {
                    projectKey: { type: "string", description: "Project key (e.g. PROJ)" },
                    summary: { type: "string", description: "Issue title/summary" },
                    description: { type: "string", description: "Issue description (plain text)" },
                    issueType: { type: "string", description: "Issue type name (e.g. Task, Bug, Story)" },
                    priority: { type: "string", description: "Priority name (e.g. High, Medium, Low)" },
                    assignee: { type: "string", description: "Assignee username (Server) or accountId (Cloud)" },
                    labels: { type: "array", items: { type: "string" }, description: "Labels" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Created issue" } },
        },
      },
      "/api/issues/{issueKeyOrId}": {
        put: {
          operationId: "updateIssue",
          summary: "Update an existing issue",
          parameters: [
            { name: "issueKeyOrId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    summary: { type: "string" },
                    description: { type: "string" },
                    priority: { type: "string" },
                    assignee: { type: "string", description: "Assignee username (Server) or accountId (Cloud)" },
                    labels: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          responses: { 204: { description: "Issue updated" } },
        },
      },
      "/api/issues/{issueKeyOrId}/comments": {
        get: {
          operationId: "listComments",
          summary: "List comments on an issue",
          parameters: [
            { name: "issueKeyOrId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "List of comments" } },
        },
        post: {
          operationId: "addComment",
          summary: "Add a comment to an issue",
          parameters: [
            { name: "issueKeyOrId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["body"],
                  properties: {
                    body: { type: "string", description: "Comment text" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Comment added" } },
        },
      },
      "/api/issues/{issueKeyOrId}/transitions": {
        get: {
          operationId: "getTransitions",
          summary: "Get available status transitions for an issue",
          parameters: [
            { name: "issueKeyOrId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { 200: { description: "Available transitions" } },
        },
        post: {
          operationId: "transitionIssue",
          summary: "Transition an issue to a new status",
          parameters: [
            { name: "issueKeyOrId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["transitionId"],
                  properties: {
                    transitionId: { type: "string", description: "Transition ID (get from getTransitions)" },
                  },
                },
              },
            },
          },
          responses: { 204: { description: "Issue transitioned" } },
        },
      },
      "/api/boards": {
        get: {
          operationId: "listBoards",
          summary: "List Jira boards (Scrum/Kanban)",
          parameters: [
            { name: "projectKeyOrId", in: "query", schema: { type: "string" }, description: "Filter by project key or ID" },
            { name: "type", in: "query", schema: { type: "string", enum: ["scrum", "kanban"] }, description: "Board type filter" },
            { name: "maxResults", in: "query", schema: { type: "integer", default: 50 } },
            { name: "startAt", in: "query", schema: { type: "integer", default: 0 } },
          ],
          responses: { 200: { description: "List of boards" } },
        },
      },
      "/api/boards/{boardId}/sprints": {
        get: {
          operationId: "listSprints",
          summary: "List sprints of a board",
          parameters: [
            { name: "boardId", in: "path", required: true, schema: { type: "integer" } },
            { name: "state", in: "query", schema: { type: "string", enum: ["active", "closed", "future"] }, description: "Sprint state filter" },
            { name: "maxResults", in: "query", schema: { type: "integer", default: 50 } },
            { name: "startAt", in: "query", schema: { type: "integer", default: 0 } },
          ],
          responses: { 200: { description: "List of sprints" } },
        },
      },
      "/api/myself": {
        get: {
          operationId: "getMyself",
          summary: "Get current authenticated user info",
          responses: { 200: { description: "Current user details" } },
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
        description: "List all Jira projects",
        parameters: {
          type: "object",
          properties: {
            maxResults: { type: "integer", default: 50 },
            startAt: { type: "integer", default: 0 },
          },
        },
      },
      {
        name: "getProject",
        description: "Get project details",
        parameters: {
          type: "object",
          required: ["projectKeyOrId"],
          properties: { projectKeyOrId: { type: "string" } },
        },
      },
      {
        name: "searchIssues",
        description: "Search issues using JQL (Jira Query Language)",
        parameters: {
          type: "object",
          required: ["jql"],
          properties: {
            jql: { type: "string" },
            maxResults: { type: "integer", default: 20 },
            startAt: { type: "integer", default: 0 },
          },
        },
      },
      {
        name: "getIssue",
        description: "Get issue details by key or ID",
        parameters: {
          type: "object",
          required: ["issueKeyOrId"],
          properties: { issueKeyOrId: { type: "string" } },
        },
      },
      {
        name: "createIssue",
        description: "Create a new Jira issue",
        parameters: {
          type: "object",
          required: ["projectKey", "summary", "issueType"],
          properties: {
            projectKey: { type: "string" },
            summary: { type: "string" },
            description: { type: "string" },
            issueType: { type: "string" },
            priority: { type: "string" },
            assignee: { type: "string" },
            labels: { type: "array", items: { type: "string" } },
          },
        },
      },
      {
        name: "updateIssue",
        description: "Update an existing Jira issue",
        parameters: {
          type: "object",
          required: ["issueKeyOrId"],
          properties: {
            issueKeyOrId: { type: "string" },
            summary: { type: "string" },
            description: { type: "string" },
            priority: { type: "string" },
            assignee: { type: "string" },
            labels: { type: "array", items: { type: "string" } },
          },
        },
      },
      {
        name: "listComments",
        description: "List comments on an issue",
        parameters: {
          type: "object",
          required: ["issueKeyOrId"],
          properties: { issueKeyOrId: { type: "string" } },
        },
      },
      {
        name: "addComment",
        description: "Add a comment to an issue",
        parameters: {
          type: "object",
          required: ["issueKeyOrId", "body"],
          properties: {
            issueKeyOrId: { type: "string" },
            body: { type: "string" },
          },
        },
      },
      {
        name: "getTransitions",
        description: "Get available status transitions for an issue",
        parameters: {
          type: "object",
          required: ["issueKeyOrId"],
          properties: { issueKeyOrId: { type: "string" } },
        },
      },
      {
        name: "transitionIssue",
        description: "Transition an issue to a new status",
        parameters: {
          type: "object",
          required: ["issueKeyOrId", "transitionId"],
          properties: {
            issueKeyOrId: { type: "string" },
            transitionId: { type: "string" },
          },
        },
      },
      {
        name: "listBoards",
        description: "List Jira boards (Scrum/Kanban)",
        parameters: {
          type: "object",
          properties: {
            projectKeyOrId: { type: "string" },
            type: { type: "string", enum: ["scrum", "kanban"] },
            maxResults: { type: "integer", default: 50 },
            startAt: { type: "integer", default: 0 },
          },
        },
      },
      {
        name: "listSprints",
        description: "List sprints of a board",
        parameters: {
          type: "object",
          required: ["boardId"],
          properties: {
            boardId: { type: "integer" },
            state: { type: "string", enum: ["active", "closed", "future"] },
            maxResults: { type: "integer", default: 50 },
            startAt: { type: "integer", default: 0 },
          },
        },
      },
      {
        name: "getMyself",
        description: "Get current authenticated user info",
        parameters: { type: "object", properties: {} },
      },
    ],
    meta: {
      title: "Jira",
      avatar: "https://cdn.worldvectorlogo.com/logos/jira-1.svg",
      description: "Interact with Jira — projects, issues, sprints, boards, and comments.",
    },
    type: "default",
    openapi: `${baseUrl}/openapi.json`,
    version: "1",
    homepage: "https://www.atlassian.com/software/jira",
    settings: { type: "object", properties: {} },
    identifier: "jira",
    systemRole:
      "Use this plugin to interact with a Jira instance. You can search issues using JQL, list projects, get issue details, create/update issues, add comments, transition issue status, list boards, and list sprints. When searching issues, use JQL syntax like: project = KEY AND status = 'In Progress'.",
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Summarizers to reduce payload size for LLM context
function summarizeProject(p) {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    projectTypeKey: p.projectTypeKey,
    style: p.style,
    lead: p.lead?.displayName || p.lead?.name,
  };
}

function summarizeIssue(i) {
  const f = i.fields || {};
  return {
    key: i.key,
    id: i.id,
    summary: f.summary,
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.name,
    issueType: f.issuetype?.name,
    priority: f.priority?.name,
    assignee: f.assignee?.displayName || f.assignee?.name,
    reporter: f.reporter?.displayName || f.reporter?.name,
    labels: f.labels,
    created: f.created,
    updated: f.updated,
    description: truncateDescription(f.description),
  };
}

function summarizeComment(c) {
  return {
    id: c.id,
    author: c.author?.displayName || c.author?.name,
    body: truncateDescription(c.body),
    created: c.created,
    updated: c.updated,
  };
}

function summarizeBoard(b) {
  return {
    id: b.id,
    name: b.name,
    type: b.type,
    location: b.location ? { projectKey: b.location.projectKey, name: b.location.name } : null,
  };
}

function summarizeSprint(s) {
  return pick(s, ["id", "name", "state", "startDate", "endDate", "completeDate", "goal"]);
}

// Description handling:
//   Jira Server (API v2) → plain text string
//   Jira Cloud  (API v3) → ADF (Atlassian Document Format)
function truncateDescription(desc) {
  if (!desc) return null;
  if (typeof desc === "string") {
    return desc.length > 3000 ? desc.substring(0, 3000) + "... [truncated]" : desc;
  }
  // ADF format (Cloud) — extract text content
  if (desc.type === "doc" && Array.isArray(desc.content)) {
    const text = extractAdfText(desc);
    return text.length > 3000 ? text.substring(0, 3000) + "... [truncated]" : text;
  }
  return JSON.stringify(desc).substring(0, 3000);
}

function extractAdfText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (Array.isArray(node.content)) {
    return node.content.map(extractAdfText).join(node.type === "paragraph" ? "\n" : "");
  }
  return "";
}

// Build description field for create/update:
//   Server → plain text string
//   Cloud  → ADF document
function buildDescription(text) {
  if (!text) return undefined;
  if (IS_CLOUD) {
    return {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    };
  }
  return text;
}

// Build assignee field:
//   Server → { name: "username" }
//   Cloud  → { accountId: "..." }
function buildAssignee(assignee) {
  if (!assignee) return undefined;
  if (IS_CLOUD) return { accountId: assignee };
  return { name: assignee };
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// --- Projects ---
app.get("/api/projects", async (req, res) => {
  try {
    if (IS_CLOUD) {
      // Cloud: paginated endpoint
      const q = buildQuery(pick(req.query, ["maxResults", "startAt"]));
      const r = await jiraFetch(`${API_BASE}/project/search${q}`);
      if (r.status === 200 && Array.isArray(r.data.values)) {
        res.json({
          total: r.data.total,
          projects: r.data.values.map(summarizeProject),
        });
      } else {
        res.status(r.status).json(r.data);
      }
    } else {
      // Server: returns flat array of all projects
      const r = await jiraFetch(`${API_BASE}/project`);
      if (r.status === 200 && Array.isArray(r.data)) {
        res.json({
          total: r.data.length,
          projects: r.data.map(summarizeProject),
        });
      } else {
        res.status(r.status).json(r.data);
      }
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/projects/:projectKeyOrId", async (req, res) => {
  try {
    const r = await jiraFetch(`${API_BASE}/project/${encodeURIComponent(req.params.projectKeyOrId)}`);
    res.status(r.status).json(r.status === 200 ? summarizeProject(r.data) : r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Search (JQL) ---
app.get("/api/search", async (req, res) => {
  try {
    const q = buildQuery({
      jql: req.query.jql,
      maxResults: req.query.maxResults || 20,
      startAt: req.query.startAt || 0,
      fields: "summary,status,issuetype,priority,assignee,reporter,labels,created,updated,description",
    });
    const r = await jiraFetch(`${API_BASE}/search${q}`);
    if (r.status === 200 && Array.isArray(r.data.issues)) {
      res.json({
        total: r.data.total,
        startAt: r.data.startAt,
        maxResults: r.data.maxResults,
        issues: r.data.issues.map(summarizeIssue),
      });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Issues ---
app.get("/api/issues/:issueKeyOrId", async (req, res) => {
  try {
    const r = await jiraFetch(`${API_BASE}/issue/${encodeURIComponent(req.params.issueKeyOrId)}`);
    res.status(r.status).json(r.status === 200 ? summarizeIssue(r.data) : r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/issues", async (req, res) => {
  try {
    const { projectKey, summary, description, issueType, priority, assignee, labels } = req.body;
    const fields = {
      project: { key: projectKey },
      summary,
      issuetype: { name: issueType || "Task" },
    };
    const desc = buildDescription(description);
    if (desc !== undefined) fields.description = desc;
    if (priority) fields.priority = { name: priority };
    const assigneeObj = buildAssignee(assignee);
    if (assigneeObj) fields.assignee = assigneeObj;
    if (labels) fields.labels = labels;

    const r = await jiraFetch(`${API_BASE}/issue`, "POST", { fields });
    if (r.status === 201) {
      res.status(201).json({ key: r.data.key, id: r.data.id, self: r.data.self });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/issues/:issueKeyOrId", async (req, res) => {
  try {
    const fields = {};
    const { summary, description, priority, assignee, labels } = req.body;
    if (summary) fields.summary = summary;
    const desc = buildDescription(description);
    if (desc !== undefined) fields.description = desc;
    if (priority) fields.priority = { name: priority };
    const assigneeObj = buildAssignee(assignee);
    if (assigneeObj) fields.assignee = assigneeObj;
    if (labels) fields.labels = labels;

    const r = await jiraFetch(`${API_BASE}/issue/${encodeURIComponent(req.params.issueKeyOrId)}`, "PUT", { fields });
    if (r.status === 204) {
      res.json({ success: true, message: `Issue ${req.params.issueKeyOrId} updated` });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Comments ---
app.get("/api/issues/:issueKeyOrId/comments", async (req, res) => {
  try {
    const r = await jiraFetch(`${API_BASE}/issue/${encodeURIComponent(req.params.issueKeyOrId)}/comment`);
    if (r.status === 200 && Array.isArray(r.data.comments)) {
      res.json({
        total: r.data.total,
        comments: r.data.comments.map(summarizeComment),
      });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/issues/:issueKeyOrId/comments", async (req, res) => {
  try {
    const bodyText = req.body.body || "";
    // Server (API v2): plain text body; Cloud (API v3): ADF
    const commentBody = IS_CLOUD
      ? { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }] } }
      : { body: bodyText };

    const r = await jiraFetch(
      `${API_BASE}/issue/${encodeURIComponent(req.params.issueKeyOrId)}/comment`,
      "POST",
      commentBody
    );
    if (r.status === 201) {
      res.status(201).json(summarizeComment(r.data));
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Transitions ---
app.get("/api/issues/:issueKeyOrId/transitions", async (req, res) => {
  try {
    const r = await jiraFetch(`${API_BASE}/issue/${encodeURIComponent(req.params.issueKeyOrId)}/transitions`);
    if (r.status === 200 && Array.isArray(r.data.transitions)) {
      res.json({
        transitions: r.data.transitions.map((t) => ({
          id: t.id,
          name: t.name,
          to: t.to ? { id: t.to.id, name: t.to.name } : null,
        })),
      });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/issues/:issueKeyOrId/transitions", async (req, res) => {
  try {
    const { transitionId } = req.body;
    const r = await jiraFetch(
      `${API_BASE}/issue/${encodeURIComponent(req.params.issueKeyOrId)}/transitions`,
      "POST",
      { transition: { id: transitionId } }
    );
    if (r.status === 204) {
      res.json({ success: true, message: `Issue ${req.params.issueKeyOrId} transitioned` });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Boards (Agile API) ---
app.get("/api/boards", async (req, res) => {
  try {
    const q = buildQuery(pick(req.query, ["projectKeyOrId", "type", "maxResults", "startAt"]));
    const r = await jiraFetch(`/rest/agile/1.0/board${q}`);
    if (r.status === 200 && Array.isArray(r.data.values)) {
      res.json({
        total: r.data.total,
        boards: r.data.values.map(summarizeBoard),
      });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Sprints ---
app.get("/api/boards/:boardId/sprints", async (req, res) => {
  try {
    const q = buildQuery(pick(req.query, ["state", "maxResults", "startAt"]));
    const r = await jiraFetch(`/rest/agile/1.0/board/${req.params.boardId}/sprint${q}`);
    if (r.status === 200 && Array.isArray(r.data.values)) {
      res.json({
        total: r.data.total,
        sprints: r.data.values.map(summarizeSprint),
      });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Current user ---
app.get("/api/myself", async (_req, res) => {
  try {
    const r = await jiraFetch(`${API_BASE}/myself`);
    if (r.status === 200) {
      res.json({
        // Cloud uses accountId, Server uses name/key
        accountId: r.data.accountId || r.data.key,
        username: r.data.name,
        displayName: r.data.displayName,
        emailAddress: r.data.emailAddress,
        active: r.data.active,
        timeZone: r.data.timeZone,
      });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Jira Tool Server running on port ${PORT}`);
  console.log(`  Mode: ${IS_CLOUD ? "Cloud (API v3, Basic Auth)" : "Server/Data Center (API v2, Bearer Token)"}`);
  console.log(`  Jira URL: ${JIRA_BASE_URL}`);
  if (IS_CLOUD) console.log(`  Email: ${JIRA_EMAIL}`);
  console.log(`  Token configured: ${JIRA_API_TOKEN ? "yes" : "NO — set JIRA_API_TOKEN"}`);
  console.log(`  Plugin manifest: http://localhost:${PORT}/.well-known/ai-plugin.json`);
  console.log(`  OpenAPI spec:    http://localhost:${PORT}/openapi.json`);
});
