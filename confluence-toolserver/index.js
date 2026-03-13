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

const PORT = process.env.PORT || 3104;
const PUBLIC_URL = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, "") : null;
const CONFLUENCE_BASE_URL = (process.env.CONFLUENCE_BASE_URL || "").replace(/\/+$/, "").trim();
const CONFLUENCE_EMAIL = (process.env.CONFLUENCE_EMAIL || "").trim();
const CONFLUENCE_API_TOKEN = (process.env.CONFLUENCE_API_TOKEN || "").trim();

// Auto-detect: Cloud (.atlassian.net) vs Server/Data Center
const IS_CLOUD = CONFLUENCE_BASE_URL.includes(".atlassian.net");

// Cloud API base: /wiki/rest/api  |  Server API base: /rest/api
const API_BASE = IS_CLOUD ? "/wiki/rest/api" : "/rest/api";

// Auth:  Cloud → Basic base64(email:token)  |  Server → Bearer <PAT>
function getAuthHeader() {
  if (IS_CLOUD) {
    return `Basic ${Buffer.from(`${CONFLUENCE_EMAIL}:${CONFLUENCE_API_TOKEN}`).toString("base64")}`;
  }
  return `Bearer ${CONFLUENCE_API_TOKEN}`;
}

// ---------------------------------------------------------------------------
// Helper – call Confluence REST API
// ---------------------------------------------------------------------------

function confluenceFetch(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const separator = path.startsWith("/") ? "" : "/";
    const fullUrl = `${CONFLUENCE_BASE_URL}${separator}${path}`;
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
    name_for_human: "Confluence",
    name_for_model: "confluence",
    description_for_human: "Interact with Confluence — spaces, pages, search, and comments.",
    description_for_model:
      "Use this plugin to interact with a Confluence instance. You can list spaces, search content using CQL, get page content, create/update pages, get page children, and manage comments.",
    auth: { type: "none" },
    api: {
      type: "openapi",
      url: PUBLIC_URL ? `${PUBLIC_URL}/openapi.json` : `/openapi.json`,
    },
    logo_url: "https://cdn.worldvectorlogo.com/logos/confluence-1.svg",
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
      title: "Confluence Tool Server",
      description: "Provides Confluence operations as tools for LobeChat",
      version: "1.0.0",
    },
    servers: [{ url: `http://host.docker.internal:${PORT}` }],
    paths: {
      "/api/spaces": {
        get: {
          operationId: "listSpaces",
          summary: "List Confluence spaces",
          parameters: [
            { name: "type", in: "query", schema: { type: "string", enum: ["global", "personal"] }, description: "Space type filter" },
            { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
            { name: "start", in: "query", schema: { type: "integer", default: 0 } },
          ],
          responses: { 200: { description: "List of spaces" } },
        },
      },
      "/api/spaces/{spaceKey}": {
        get: {
          operationId: "getSpace",
          summary: "Get space details",
          parameters: [
            { name: "spaceKey", in: "path", required: true, schema: { type: "string" }, description: "Space key (e.g. DEV, HR)" },
          ],
          responses: { 200: { description: "Space details" } },
        },
      },
      "/api/search": {
        get: {
          operationId: "searchContent",
          summary: "Search content using CQL",
          description: "Search Confluence content using CQL (Confluence Query Language). Examples: type=page AND space=DEV, text~'deployment guide', title='Meeting Notes'",
          parameters: [
            { name: "cql", in: "query", required: true, schema: { type: "string" }, description: "CQL query string" },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "start", in: "query", schema: { type: "integer", default: 0 } },
          ],
          responses: { 200: { description: "Search results" } },
        },
      },
      "/api/content/{pageId}": {
        get: {
          operationId: "getPage",
          summary: "Get page content",
          parameters: [
            { name: "pageId", in: "path", required: true, schema: { type: "string" }, description: "Page ID" },
          ],
          responses: { 200: { description: "Page content" } },
        },
      },
      "/api/content": {
        post: {
          operationId: "createPage",
          summary: "Create a new page",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["spaceKey", "title", "body"],
                  properties: {
                    spaceKey: { type: "string", description: "Space key" },
                    title: { type: "string", description: "Page title" },
                    body: { type: "string", description: "Page body (plain text or HTML)" },
                    parentId: { type: "string", description: "Parent page ID (optional)" },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Created page" } },
        },
      },
      "/api/content/{pageId}": {
        put: {
          operationId: "updatePage",
          summary: "Update an existing page",
          parameters: [
            { name: "pageId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title", "body", "version"],
                  properties: {
                    title: { type: "string", description: "Page title" },
                    body: { type: "string", description: "New page body (plain text or HTML)" },
                    version: { type: "integer", description: "Current version number (will be incremented)" },
                  },
                },
              },
            },
          },
          responses: { 200: { description: "Updated page" } },
        },
      },
      "/api/content/{pageId}/children": {
        get: {
          operationId: "getPageChildren",
          summary: "Get child pages of a page",
          parameters: [
            { name: "pageId", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
            { name: "start", in: "query", schema: { type: "integer", default: 0 } },
          ],
          responses: { 200: { description: "List of child pages" } },
        },
      },
      "/api/content/{pageId}/comments": {
        get: {
          operationId: "listPageComments",
          summary: "List comments on a page",
          parameters: [
            { name: "pageId", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
            { name: "start", in: "query", schema: { type: "integer", default: 0 } },
          ],
          responses: { 200: { description: "List of comments" } },
        },
        post: {
          operationId: "addPageComment",
          summary: "Add a comment to a page",
          parameters: [
            { name: "pageId", in: "path", required: true, schema: { type: "string" } },
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
          responses: { 200: { description: "Comment added" } },
        },
      },
      "/api/spaces/{spaceKey}/pages": {
        get: {
          operationId: "listSpacePages",
          summary: "List pages in a space",
          parameters: [
            { name: "spaceKey", in: "path", required: true, schema: { type: "string" } },
            { name: "title", in: "query", schema: { type: "string" }, description: "Filter by page title" },
            { name: "limit", in: "query", schema: { type: "integer", default: 25 } },
            { name: "start", in: "query", schema: { type: "integer", default: 0 } },
          ],
          responses: { 200: { description: "List of pages" } },
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
        name: "listSpaces",
        description: "List Confluence spaces",
        parameters: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["global", "personal"] },
            limit: { type: "integer", default: 25 },
            start: { type: "integer", default: 0 },
          },
        },
      },
      {
        name: "getSpace",
        description: "Get space details",
        parameters: {
          type: "object",
          required: ["spaceKey"],
          properties: { spaceKey: { type: "string" } },
        },
      },
      {
        name: "searchContent",
        description: "Search content using CQL (Confluence Query Language)",
        parameters: {
          type: "object",
          required: ["cql"],
          properties: {
            cql: { type: "string" },
            limit: { type: "integer", default: 20 },
            start: { type: "integer", default: 0 },
          },
        },
      },
      {
        name: "getPage",
        description: "Get page content by ID",
        parameters: {
          type: "object",
          required: ["pageId"],
          properties: { pageId: { type: "string" } },
        },
      },
      {
        name: "createPage",
        description: "Create a new page in a space",
        parameters: {
          type: "object",
          required: ["spaceKey", "title", "body"],
          properties: {
            spaceKey: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            parentId: { type: "string" },
          },
        },
      },
      {
        name: "updatePage",
        description: "Update an existing page",
        parameters: {
          type: "object",
          required: ["pageId", "title", "body", "version"],
          properties: {
            pageId: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            version: { type: "integer" },
          },
        },
      },
      {
        name: "getPageChildren",
        description: "Get child pages of a page",
        parameters: {
          type: "object",
          required: ["pageId"],
          properties: {
            pageId: { type: "string" },
            limit: { type: "integer", default: 25 },
            start: { type: "integer", default: 0 },
          },
        },
      },
      {
        name: "listPageComments",
        description: "List comments on a page",
        parameters: {
          type: "object",
          required: ["pageId"],
          properties: {
            pageId: { type: "string" },
            limit: { type: "integer", default: 25 },
            start: { type: "integer", default: 0 },
          },
        },
      },
      {
        name: "addPageComment",
        description: "Add a comment to a page",
        parameters: {
          type: "object",
          required: ["pageId", "body"],
          properties: {
            pageId: { type: "string" },
            body: { type: "string" },
          },
        },
      },
      {
        name: "listSpacePages",
        description: "List pages in a space",
        parameters: {
          type: "object",
          required: ["spaceKey"],
          properties: {
            spaceKey: { type: "string" },
            title: { type: "string" },
            limit: { type: "integer", default: 25 },
            start: { type: "integer", default: 0 },
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
      title: "Confluence",
      avatar: "https://cdn.worldvectorlogo.com/logos/confluence-1.svg",
      description: "Interact with Confluence — spaces, pages, search, and comments.",
    },
    type: "default",
    openapi: `${baseUrl}/openapi.json`,
    version: "1",
    homepage: "https://www.atlassian.com/software/confluence",
    settings: { type: "object", properties: {} },
    identifier: "confluence",
    systemRole:
      "Use this plugin to interact with a Confluence instance. You can list spaces, search content using CQL, get page content, create/update pages, list child pages, and manage comments. When searching, use CQL syntax like: type=page AND space=KEY AND text~'keyword'.",
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

function summarizeSpace(s) {
  return {
    id: s.id,
    key: s.key,
    name: s.name,
    type: s.type,
    status: s.status,
    description: s.description?.plain?.value
      ? s.description.plain.value.substring(0, 500)
      : null,
  };
}

function summarizePage(p) {
  const result = {
    id: p.id,
    title: p.title,
    type: p.type,
    status: p.status,
    space: p.space ? { key: p.space.key, name: p.space.name } : null,
    version: p.version ? { number: p.version.number, when: p.version.when, by: p.version.by?.displayName || p.version.by?.username } : null,
    _links: p._links ? { webui: p._links.webui } : null,
  };
  return result;
}

function summarizePageWithBody(p) {
  const result = summarizePage(p);
  // Extract body text — prefer storage format, fallback to view
  const bodyStorage = p.body?.storage?.value || p.body?.view?.value || "";
  // Strip HTML tags for cleaner LLM context
  const plainText = bodyStorage.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  result.body = plainText.length > 5000
    ? plainText.substring(0, 5000) + "... [truncated]"
    : plainText;
  return result;
}

function summarizeComment(c) {
  const bodyHtml = c.body?.storage?.value || c.body?.view?.value || "";
  const plainText = bodyHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return {
    id: c.id,
    author: c.history?.createdBy?.displayName || c.history?.createdBy?.username,
    body: plainText.length > 1000 ? plainText.substring(0, 1000) + "... [truncated]" : plainText,
    created: c.history?.createdDate,
    version: c.version?.number,
  };
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// --- Spaces ---
app.get("/api/spaces", async (req, res) => {
  try {
    const q = buildQuery(pick(req.query, ["type", "limit", "start"]));
    const r = await confluenceFetch(`${API_BASE}/space${q}`);
    if (r.status === 200 && Array.isArray(r.data.results)) {
      res.json({
        total: r.data.size,
        spaces: r.data.results.map(summarizeSpace),
      });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/spaces/:spaceKey", async (req, res) => {
  try {
    const r = await confluenceFetch(`${API_BASE}/space/${encodeURIComponent(req.params.spaceKey)}?expand=description.plain`);
    res.status(r.status).json(r.status === 200 ? summarizeSpace(r.data) : r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Search (CQL) ---
app.get("/api/search", async (req, res) => {
  try {
    const q = buildQuery({
      cql: req.query.cql,
      limit: req.query.limit || 20,
      start: req.query.start || 0,
    });
    const r = await confluenceFetch(`${API_BASE}/content/search${q}`);
    if (r.status === 200 && Array.isArray(r.data.results)) {
      res.json({
        total: r.data.totalSize || r.data.size,
        results: r.data.results.map(summarizePage),
      });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Pages ---
app.get("/api/content/:pageId", async (req, res) => {
  try {
    const r = await confluenceFetch(
      `${API_BASE}/content/${req.params.pageId}?expand=body.storage,version,space`
    );
    res.status(r.status).json(r.status === 200 ? summarizePageWithBody(r.data) : r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/content", async (req, res) => {
  try {
    const { spaceKey, title, body, parentId } = req.body;
    const payload = {
      type: "page",
      title,
      space: { key: spaceKey },
      body: {
        storage: {
          value: body,
          representation: "storage",
        },
      },
    };
    if (parentId) {
      payload.ancestors = [{ id: parentId }];
    }

    const r = await confluenceFetch(`${API_BASE}/content`, "POST", payload);
    if (r.status === 200 || r.status === 201) {
      res.status(201).json(summarizePage(r.data));
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/content/:pageId", async (req, res) => {
  try {
    const { title, body, version } = req.body;
    const payload = {
      type: "page",
      title,
      version: { number: version + 1 },
      body: {
        storage: {
          value: body,
          representation: "storage",
        },
      },
    };

    const r = await confluenceFetch(`${API_BASE}/content/${req.params.pageId}`, "PUT", payload);
    if (r.status === 200) {
      res.json(summarizePage(r.data));
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Children ---
app.get("/api/content/:pageId/children", async (req, res) => {
  try {
    const q = buildQuery(pick(req.query, ["limit", "start"]));
    const r = await confluenceFetch(`${API_BASE}/content/${req.params.pageId}/child/page${q}`);
    if (r.status === 200 && Array.isArray(r.data.results)) {
      res.json({
        total: r.data.size,
        pages: r.data.results.map(summarizePage),
      });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Comments ---
app.get("/api/content/:pageId/comments", async (req, res) => {
  try {
    const q = buildQuery({ ...pick(req.query, ["limit", "start"]), expand: "body.storage,history,version" });
    const r = await confluenceFetch(`${API_BASE}/content/${req.params.pageId}/child/comment${q}`);
    if (r.status === 200 && Array.isArray(r.data.results)) {
      res.json({
        total: r.data.size,
        comments: r.data.results.map(summarizeComment),
      });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/content/:pageId/comments", async (req, res) => {
  try {
    const bodyText = req.body.body || "";
    const payload = {
      type: "comment",
      container: { id: req.params.pageId, type: "page" },
      body: {
        storage: {
          value: `<p>${bodyText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
          representation: "storage",
        },
      },
    };

    const r = await confluenceFetch(`${API_BASE}/content`, "POST", payload);
    if (r.status === 200 || r.status === 201) {
      res.status(201).json({ id: r.data.id, title: r.data.title, type: r.data.type });
    } else {
      res.status(r.status).json(r.data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- List pages in space ---
app.get("/api/spaces/:spaceKey/pages", async (req, res) => {
  try {
    const params = {
      spaceKey: req.params.spaceKey,
      type: "page",
      limit: req.query.limit || 25,
      start: req.query.start || 0,
    };
    if (req.query.title) params.title = req.query.title;
    const q = buildQuery(params);
    const r = await confluenceFetch(`${API_BASE}/content${q}`);
    if (r.status === 200 && Array.isArray(r.data.results)) {
      res.json({
        total: r.data.totalSize || r.data.size,
        pages: r.data.results.map(summarizePage),
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
    // Server: /rest/api/user/current  |  Cloud: same endpoint works
    const endpoint = IS_CLOUD ? `${API_BASE}/user/current` : "/rest/api/user/current";
    const r = await confluenceFetch(endpoint);
    if (r.status === 200) {
      res.json({
        username: r.data.username || r.data.name,
        displayName: r.data.displayName,
        email: r.data.email,
        userKey: r.data.userKey || r.data.accountId,
        type: r.data.type,
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
  console.log(`Confluence Tool Server running on port ${PORT}`);
  console.log(`  Mode: ${IS_CLOUD ? "Cloud (Basic Auth)" : "Server/Data Center (Bearer Token)"}`);
  console.log(`  Confluence URL: ${CONFLUENCE_BASE_URL}`);
  console.log(`  Token configured: ${CONFLUENCE_API_TOKEN ? "yes" : "NO — set CONFLUENCE_API_TOKEN"}`);
  console.log(`  Plugin manifest: http://localhost:${PORT}/.well-known/ai-plugin.json`);
  console.log(`  OpenAPI spec:    http://localhost:${PORT}/openapi.json`);
});
