const express = require("express");
const cors = require("cors");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3105;
const PUBLIC_URL = process.env.PUBLIC_URL
  ? process.env.PUBLIC_URL.replace(/\/+$/, "")
  : null;
// INTERNAL_URL is used for OpenAPI server URL (plugin calls from within Docker)
const INTERNAL_URL = process.env.INTERNAL_URL
  ? process.env.INTERNAL_URL.replace(/\/+$/, "")
  : null;

// LLM API endpoint — defaults to Ollama's OpenAI-compatible API
const LLM_API_URL = (
  process.env.LLM_API_URL || "http://192.168.3.7:11434/v1/chat/completions"
).replace(/\/+$/, "");
const LLM_API_KEY = process.env.LLM_API_KEY || "ollama";
const LLM_MODEL = process.env.LLM_MODEL || "qwen3.5:latest";
const LLM_TEMPERATURE = parseFloat(process.env.LLM_TEMPERATURE || "0.7");
const LLM_MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS || "8192", 10);

// Output directory for generated code
const OUTPUT_DIR = process.env.OUTPUT_DIR || "/output";

// Per-agent model overrides (optional — falls back to LLM_MODEL)
const AGENT_MODELS = {
  product_manager: process.env.LLM_MODEL_PM || LLM_MODEL,
  architect: process.env.LLM_MODEL_ARCHITECT || LLM_MODEL,
  engineer: process.env.LLM_MODEL_ENGINEER || process.env.LLM_MODEL_CODER || LLM_MODEL,
  qa_engineer: process.env.LLM_MODEL_QA || LLM_MODEL,
  task_decomposer: process.env.LLM_MODEL_PM || LLM_MODEL,
};

// ---------------------------------------------------------------------------
// Persistent workflow storage (survives container restart)
// ---------------------------------------------------------------------------

const WORKFLOW_DB = path.join(OUTPUT_DIR, ".workflows.json");

// Load existing workflows from disk
function loadWorkflows() {
  const map = new Map();
  try {
    if (fs.existsSync(WORKFLOW_DB)) {
      const data = JSON.parse(fs.readFileSync(WORKFLOW_DB, "utf-8"));
      for (const [k, v] of Object.entries(data)) map.set(k, v);
    }
  } catch (e) {
    console.error("Failed to load workflows:", e.message);
  }
  return map;
}

// Save workflows to disk
function saveWorkflows() {
  try {
    const obj = Object.fromEntries(workflows);
    fs.writeFileSync(WORKFLOW_DB, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save workflows:", e.message);
  }
}

const workflows = loadWorkflows();

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// File extraction — parse Engineer output and write files to disk
// ---------------------------------------------------------------------------

/**
 * Parse code blocks from Engineer output.
 * Supports formats:
 *   ### FILE: path/to/file.ext
 *   ```lang
 *   code
 *   ```
 *
 *   Or: **FILE: path/to/file.ext**
 */
function extractFiles(engineerOutput) {
  const files = [];
  let match;

  // Pre-process: normalize common formatting issues from LLMs
  // 1. Add newline between ### FILE: header and ``` if missing (e.g. "### FILE: foo.py```python")
  engineerOutput = engineerOutput.replace(
    /(###?\s*(?:FILE|File|file)[:\s]*`?[^\n`]+`?)```/g,
    "$1\n```"
  );
  // 2. Add newline after ```python if code starts on same line (e.g. "```python# comment")
  engineerOutput = engineerOutput.replace(
    /```([a-z]*)((?:#|"|'|import |from |def |class |\/\/|\/\*|\{))/g,
    "```$1\n$2"
  );

  // Strategy 1: Standard format — ### FILE: path followed by ```code```
  const pattern = /(?:###?\s*(?:FILE|File|file)[:\s]*`?([^\n`]+)`?|(?:\*\*(?:FILE|File|file)[:\s]*([^\n*]+)\*\*))\s*\n\s*```[^\n]*\n([\s\S]*?)```/g;

  while ((match = pattern.exec(engineerOutput)) !== null) {
    const filePath = (match[1] || match[2]).trim();
    let content = match[3];
    if (filePath && content) {
      // Check if content contains embedded ### FILE: markers (model put all files in one block)
      const embeddedSplit = content.split(/###?\s*(?:FILE|File|file)[:\s]*`?([^\n`]+)`?\s*\n\s*```[^\n]*\n/);

      if (embeddedSplit.length > 1) {
        // First chunk belongs to the current file
        files.push({ path: filePath, content: embeddedSplit[0].trimEnd() });
        // Process remaining embedded files
        for (let i = 1; i < embeddedSplit.length; i += 2) {
          const embPath = embeddedSplit[i] ? embeddedSplit[i].trim() : null;
          const embContent = embeddedSplit[i + 1] || "";
          if (embPath) {
            // Remove trailing ``` if present
            files.push({ path: embPath, content: embContent.replace(/```\s*$/, "").trimEnd() });
          }
        }
      } else {
        files.push({ path: filePath, content });
      }
    }
  }

  // Strategy 2: Fallback — named code blocks like `filename.py`: ```code```
  if (files.length === 0) {
    const simplePattern = /(?:`([^`\n]+\.[a-z]{1,5})`)\s*(?::|\n)\s*```[^\n]*\n([\s\S]*?)```/g;
    while ((match = simplePattern.exec(engineerOutput)) !== null) {
      const filePath = match[1].trim();
      const content = match[2];
      if (filePath && content) {
        files.push({ path: filePath, content });
      }
    }
  }

  // Strategy 3: Fallback — split by ### FILE: markers without requiring ``` wrapper
  if (files.length === 0) {
    const markerPattern = /###?\s*(?:FILE|File|file)[:\s]*`?([^\n`]+)`?\s*\n([\s\S]*?)(?=###?\s*(?:FILE|File|file)[:\s]|$)/g;
    while ((match = markerPattern.exec(engineerOutput)) !== null) {
      const filePath = match[1].trim();
      // Extract code from within ``` blocks, or use raw content
      let content = match[2];
      const codeBlock = content.match(/```[^\n]*\n([\s\S]*?)```/);
      if (codeBlock) {
        content = codeBlock[1];
      }
      if (filePath && content.trim()) {
        files.push({ path: filePath, content: content.trimEnd() });
      }
    }
  }

  return files;
}

/**
 * Write extracted files to OUTPUT_DIR/<workflowId>/
 */
function writeFilesToDisk(workflowId, files) {
  const workflowDir = path.join(OUTPUT_DIR, workflowId);

  for (const file of files) {
    // Sanitize path — prevent directory traversal
    const safePath = file.path.replace(/\.\./g, "").replace(/^\/+/, "");
    const fullPath = path.join(workflowDir, safePath);
    const dir = path.dirname(fullPath);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, file.content, "utf-8");
    console.log(`  📁 Written: ${safePath}`);
  }

  return workflowDir;
}

/**
 * Create a ZIP archive of the workflow output directory.
 * Uses system `zip` or `tar` command (available on Alpine).
 */
function createZipArchive(workflowId) {
  const workflowDir = path.join(OUTPUT_DIR, workflowId);
  const zipPath = path.join(OUTPUT_DIR, `${workflowId}.tar.gz`);

  if (!fs.existsSync(workflowDir)) return null;

  try {
    execSync(`tar -czf "${zipPath}" -C "${OUTPUT_DIR}" "${workflowId}"`, { timeout: 30000 });
    return zipPath;
  } catch (err) {
    console.error("Failed to create archive:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// LLM API Helper — calls OpenAI-compatible endpoint (Ollama / OpenAI / etc.)
// ---------------------------------------------------------------------------

function callLLM(systemPrompt, userMessage, options = {}) {
  const model = options.model || LLM_MODEL;
  const temperature = options.temperature ?? LLM_TEMPERATURE;
  const maxTokens = options.maxTokens ?? LLM_MAX_TOKENS;

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false,
  });

  return new Promise((resolve, reject) => {
    const parsed = new URL(LLM_API_URL);
    const transport = parsed.protocol === "https:" ? https : http;

    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = transport.request(reqOpts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.choices && json.choices[0]) {
            resolve(json.choices[0].message.content);
          } else if (json.error) {
            reject(new Error(`LLM Error: ${json.error.message || JSON.stringify(json.error)}`));
          } else {
            reject(new Error(`Unexpected LLM response: ${data.slice(0, 500)}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse LLM response: ${e.message}\nRaw: ${data.slice(0, 500)}`));
        }
      });
    });

    req.setTimeout(300000); // 5 minutes timeout per LLM call
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("LLM request timed out (5 min)"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Agent Role Definitions (inspired by MetaGPT)
// ---------------------------------------------------------------------------

const AGENTS = {
  product_manager: {
    name: "Product Manager",
    emoji: "📋",
    system_prompt: `You are an expert Product Manager in a software development team.
Your job is to analyze user requirements and produce a clear, structured Product Requirements Document (PRD).

You MUST output your PRD in the following structure:

## 1. Project Overview
Brief description of what needs to be built.

## 2. Goals & Objectives
What the project aims to achieve.

## 3. User Stories
List user stories in the format: "As a [role], I want [feature] so that [benefit]"

## 4. Functional Requirements
Detailed list of features and functionality.

## 5. Non-Functional Requirements
Performance, security, scalability, usability requirements.

## 6. Acceptance Criteria
Clear, testable criteria for each major feature.

## 7. Out of Scope
What is explicitly NOT included.

## 8. Priority
Classify features as P0 (must-have), P1 (should-have), P2 (nice-to-have).

Be thorough, precise, and think from the end-user's perspective.
Respond in the same language as the user's input.`,
  },

  architect: {
    name: "Software Architect",
    emoji: "🏗️",
    system_prompt: `You are a senior Software Architect in a software development team.
You receive a Product Requirements Document (PRD) and must design the system architecture.

You MUST output your architecture design in the following structure:

## 1. Tech Stack
List all technologies, frameworks, and tools with justification for each choice.

## 2. System Architecture
High-level architecture description (monolith, microservices, serverless, etc.) with component diagram in text/ASCII.

## 3. Data Models
Define all data entities, their attributes, and relationships. Use a clear schema format.

## 4. API Design
List all API endpoints with:
- Method (GET/POST/PUT/DELETE)
- Path
- Request/Response format
- Description

## 5. Directory Structure
Proposed project file/folder structure.

## 6. Component Design
Key components/modules and their responsibilities.

## 7. Security Considerations
Authentication, authorization, data protection approach.

## 8. Deployment Architecture
How the system will be deployed (Docker, cloud, etc.)

## 9. Third-Party Dependencies
External libraries, services, and their purposes.

Be practical and choose mature, well-supported technologies.
Respond in the same language as the user's input.`,
  },

  engineer: {
    name: "Senior Software Engineer",
    emoji: "👨‍💻",
    system_prompt: `You are a Senior Software Engineer in a software development team.
You receive a PRD and Architecture Design, and must write production-ready code.

Rules:
1. Write COMPLETE, WORKING code — no placeholders, no "TODO", no "..."
2. Follow the architecture design precisely
3. Use best practices: clean code, proper error handling, input validation
4. Include necessary imports and dependencies
5. Write code that is ready to run
6. Add brief inline comments only where logic is non-obvious
7. Follow the tech stack specified in the architecture

Output format:
For EACH file, use this format:

### FILE: path/to/filename.ext
\`\`\`language
[complete file content]
\`\`\`

Make sure to generate ALL files needed for the project to work.
Respond in the same language as the user's input for comments/docs, but code should use English variable/function names.`,
  },

  qa_engineer: {
    name: "QA Engineer",
    emoji: "🧪",
    system_prompt: `You are a senior QA Engineer in a software development team.
You receive the requirements, architecture, and code, and must provide comprehensive quality assurance.

You MUST output your review in the following structure:

## 1. Code Review Summary
Overall assessment of code quality (score 1-10 with justification).

## 2. Issues Found
List each issue with:
- **Severity**: Critical / Major / Minor / Info
- **Location**: File and line/section
- **Description**: What the issue is
- **Suggestion**: How to fix it

## 3. Security Review
Check for common vulnerabilities (injection, XSS, auth issues, etc.)

## 4. Test Plan
### Unit Tests
List key unit tests that should be written.
### Integration Tests
List integration test scenarios.
### Edge Cases
List edge cases to test.

## 5. Test Code
Write actual test code for the most critical functionality.

### FILE: path/to/test_filename.ext
\`\`\`language
[test code]
\`\`\`

## 6. Performance Concerns
Any performance issues or optimization suggestions.

## 7. Recommendations
Final recommendations for improvement.

Be thorough and critical. Your goal is to ensure quality and reliability.
Respond in the same language as the user's input.`,
  },

  task_decomposer: {
    name: "Task Decomposer",
    emoji: "🔀",
    system_prompt: `You are a project planning expert. Your job is to break down a complex task into smaller, actionable subtasks.

Output format — return a JSON array of subtasks:
\`\`\`json
{
  "project_name": "name",
  "subtasks": [
    {
      "id": 1,
      "title": "Short task title",
      "description": "Detailed description of what needs to be done",
      "role": "product_manager|architect|engineer|qa_engineer",
      "priority": "P0|P1|P2",
      "dependencies": [],
      "estimated_complexity": "low|medium|high"
    }
  ]
}
\`\`\`

Rules:
1. Each subtask should be independently actionable
2. Order by dependencies — tasks with no dependencies first
3. Assign appropriate roles to each task
4. Be specific — avoid vague descriptions
5. Include setup, implementation, testing, and documentation tasks

Respond in the same language as the user's input.`,
  },
};

// ---------------------------------------------------------------------------
// Agent Execution
// ---------------------------------------------------------------------------

async function runAgent(agentKey, userMessage, options = {}) {
  const agent = AGENTS[agentKey];
  if (!agent) throw new Error(`Unknown agent: ${agentKey}`);

  // Use per-agent model if not explicitly overridden in options
  if (!options.model) {
    options.model = AGENT_MODELS[agentKey] || LLM_MODEL;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`${agent.emoji} [${agent.name}] Starting... (model: ${options.model})`);
  console.log(`${"=".repeat(60)}`);

  const startTime = Date.now();
  const result = await callLLM(agent.system_prompt, userMessage, options);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!result) {
    console.log(`${agent.emoji} [${agent.name}] Done in ${elapsed}s (empty/null response)`);
    return `[${agent.name}] No response from model. The model may be overloaded — try again later.`;
  }
  console.log(`${agent.emoji} [${agent.name}] Done in ${elapsed}s (${result.length} chars)`);
  return result;
}

// ---------------------------------------------------------------------------
// Pipeline Orchestration — MetaGPT-style multi-agent workflow
// ---------------------------------------------------------------------------

async function runFullPipeline(requirement, options = {}, existingWorkflowId = null) {
  let workflowId, workflow;

  if (existingWorkflowId && workflows.has(existingWorkflowId)) {
    // Use pre-created workflow from async endpoint
    workflowId = existingWorkflowId;
    workflow = workflows.get(existingWorkflowId);
  } else {
    workflowId = generateId();
    workflow = {
      id: workflowId,
      requirement,
      status: "running",
      current_step: "product_manager",
      steps: {},
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    };
    workflows.set(workflowId, workflow);
    saveWorkflows();
  }

  try {
    // ── Step 1: Product Manager — Analyze Requirements ──
    workflow.current_step = "product_manager";
    saveWorkflows();
    console.log("\n🚀 PIPELINE START — Full Development Workflow");
    console.log(`📝 Requirement: ${requirement.slice(0, 200)}...`);

    const prd = await runAgent(
      "product_manager",
      `Please analyze this requirement and create a detailed PRD:\n\n${requirement}`,
      options
    );
    workflow.steps.product_manager = { output: prd, completed_at: new Date().toISOString() };
    saveWorkflows();

    // ── Step 2: Architect — Design System ──
    workflow.current_step = "architect";
    saveWorkflows();
    const architecture = await runAgent(
      "architect",
      `Based on the following PRD, design the system architecture.\n\n## Product Requirements Document\n${prd}\n\n## Original Requirement\n${requirement}`,
      options
    );
    workflow.steps.architect = { output: architecture, completed_at: new Date().toISOString() };
    saveWorkflows();

    // ── Step 3: Engineer — Write Code ──
    workflow.current_step = "engineer";
    saveWorkflows();
    const code = await runAgent(
      "engineer",
      `Based on the following PRD and Architecture, write the complete production code.\n\n## Product Requirements Document\n${prd}\n\n## Architecture Design\n${architecture}\n\n## Original Requirement\n${requirement}`,
      options
    );
    workflow.steps.engineer = { output: code, completed_at: new Date().toISOString() };
    saveWorkflows();

    // ── Extract and write code files to disk ──
    const extractedFiles = extractFiles(code);
    if (extractedFiles.length > 0) {
      console.log(`\n📦 Extracting ${extractedFiles.length} files to disk...`);
      const outputDir = writeFilesToDisk(workflowId, extractedFiles);
      workflow.output_dir = outputDir;
      workflow.files = extractedFiles.map((f) => f.path);
      console.log(`📦 Files written to: ${outputDir}`);
    } else {
      console.log("\n⚠️ No file markers found in Engineer output — code only in text");
      workflow.files = [];
    }
    saveWorkflows();

    // ── Step 4: QA Engineer — Review & Test ──
    workflow.current_step = "qa_engineer";
    saveWorkflows();
    const review = await runAgent(
      "qa_engineer",
      `Review the following code based on the requirements and architecture.\n\n## Original Requirement\n${requirement}\n\n## Product Requirements Document\n${prd}\n\n## Architecture Design\n${architecture}\n\n## Code Implementation\n${code}`,
      options
    );
    workflow.steps.qa_engineer = { output: review, completed_at: new Date().toISOString() };
    saveWorkflows();

    // ── Extract test files from QA output ──
    const testFiles = extractFiles(review);
    if (testFiles.length > 0) {
      console.log(`\n🧪 Extracting ${testFiles.length} test files...`);
      writeFilesToDisk(workflowId, testFiles);
      workflow.files = [...(workflow.files || []), ...testFiles.map((f) => f.path)];
    }

    // ── Create downloadable archive ──
    const zipPath = createZipArchive(workflowId);
    if (zipPath) {
      workflow.download_url = `/api/workflow/${workflowId}/download`;
      console.log(`📥 Archive created: ${zipPath}`);
    }

    // ── Done ──
    workflow.status = "completed";
    workflow.current_step = null;
    workflow.completed_at = new Date().toISOString();
    saveWorkflows();

    console.log("\n✅ PIPELINE COMPLETE");
    console.log(`📁 Output: ${workflow.output_dir || "text only"}`);
    console.log(`📄 Files: ${(workflow.files || []).join(", ") || "none"}`);
    return workflow;
  } catch (err) {
    workflow.status = "failed";
    workflow.error = err.message;
    saveWorkflows();
    console.error(`\n❌ PIPELINE FAILED at step [${workflow.current_step}]: ${err.message}`);
    return workflow;
  }
}

// ---------------------------------------------------------------------------
// LobeChat Plugin Manifest
// ---------------------------------------------------------------------------

app.get("/.well-known/ai-plugin.json", (_req, res) => {
  res.json({
    schema_version: "v1",
    name_for_human: "MetaGPT Multi-Agent",
    name_for_model: "metagpt",
    description_for_human:
      "Multi-agent software development — simulates a full dev team (PM, Architect, Engineer, QA) to build software from requirements.",
    description_for_model: `Use this plugin to simulate a MetaGPT-style multi-agent software development team.

IMPORTANT — ALWAYS use developFullSync:
When the user asks to build/develop/create something, call developFullSync with the requirement. This runs the ENTIRE pipeline automatically (Product Manager → Architect → Engineer → QA) and returns ALL results in one response including generated code files and download URL.

Available operations:
- **developFullSync**: (RECOMMENDED) Runs the complete pipeline in one call. Returns PRD, architecture, code, review, file list, and download URL. Use this for all development requests.
- **analyzeRequirement**: Product Manager only — creates PRD. Use only if user asks for requirements analysis only.
- **designArchitecture**: Architect only — designs system. Use only if user asks for architecture only.
- **generateCode**: Engineer only — writes code. Use only if user asks for code generation only.
- **reviewCode**: QA only — reviews code. Use only if user asks for code review only.
- **decomposeTask**: Break a complex task into subtasks.

ALWAYS use developFullSync unless the user specifically asks for only one step.`,
    auth: { type: "none" },
    api: {
      type: "openapi",
      url: PUBLIC_URL ? `${PUBLIC_URL}/openapi.json` : "/openapi.json",
    },
    logo_url: "https://raw.githubusercontent.com/geekan/MetaGPT/main/docs/resources/MetaGPT-logo.png",
    contact_email: "admin@localhost",
    legal_info_url: "https://localhost",
  });
});

// ---------------------------------------------------------------------------
// OpenAPI 3.1.0 Specification
// ---------------------------------------------------------------------------

app.get("/openapi.json", (_req, res) => {
  // Use INTERNAL_URL for OpenAPI server (plugin calls from Docker), fallback to PUBLIC_URL
  const serverUrl = INTERNAL_URL || PUBLIC_URL || `http://localhost:${PORT}`;
  res.json({
    openapi: "3.1.0",
    info: {
      title: "MetaGPT Multi-Agent Orchestrator",
      description:
        "Simulates a MetaGPT-style software development team with Product Manager, Architect, Engineer, and QA roles. Orchestrates multi-agent collaboration to go from requirements to working code.",
      version: "1.0.0",
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/api/develop-sync": {
        post: {
          operationId: "developFullSync",
          summary: "Run complete development pipeline and return all results (PM → Architect → Engineer → QA)",
          description:
            "THIS IS THE MAIN TOOL TO USE. Starts the complete MetaGPT development pipeline (Product Manager → Architect → Engineer → QA) and returns immediately with a view_url where the user can see real-time progress and results. The pipeline runs in the background for 5-10 minutes. ALWAYS show the view_url link to the user so they can track progress.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["requirement"],
                  properties: {
                    requirement: {
                      type: "string",
                      description: "The project requirement or feature description to develop",
                    },
                    model: {
                      type: "string",
                      description: "Optional: LLM model to use (default: configured model)",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Pipeline started — show view_url to user for real-time progress",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      workflow_id: { type: "string" },
                      status: { type: "string", description: "Will be 'running'" },
                      message: { type: "string", description: "Status message in Vietnamese" },
                      view_url: { type: "string", description: "IMPORTANT: Show this URL to user — real-time progress page" },
                      download_url: { type: "string", description: "Download URL (available when completed)" },
                      instructions: { type: "string", description: "Instructions for user" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      // NOTE: /api/develop (async) is hidden from OpenAPI spec to prevent model from using it.
      // Use developFullSync (/api/develop-sync) instead.
      "/api/analyze": {
        post: {
          operationId: "analyzeRequirement",
          summary: "Product Manager: Analyze requirements and create PRD",
          description:
            "Uses the Product Manager agent to analyze a requirement and produce a structured Product Requirements Document (PRD) with user stories, functional requirements, and acceptance criteria.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["requirement"],
                  properties: {
                    requirement: {
                      type: "string",
                      description: "The requirement to analyze",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Product Requirements Document",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      agent: { type: "string" },
                      output: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/design": {
        post: {
          operationId: "designArchitecture",
          summary: "Architect: Design system architecture",
          description:
            "Uses the Architect agent to design system architecture including tech stack, data models, API design, and deployment architecture.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["requirement"],
                  properties: {
                    requirement: {
                      type: "string",
                      description: "The requirement or PRD to design architecture for",
                    },
                    prd: {
                      type: "string",
                      description: "Optional: PRD from Product Manager step",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Architecture design document",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      agent: { type: "string" },
                      output: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/implement": {
        post: {
          operationId: "generateCode",
          summary: "Engineer: Generate production code",
          description:
            "Uses the Senior Engineer agent to write complete, production-ready code based on requirements and architecture design.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["requirement"],
                  properties: {
                    requirement: {
                      type: "string",
                      description: "The requirement to implement",
                    },
                    prd: {
                      type: "string",
                      description: "Optional: PRD document",
                    },
                    architecture: {
                      type: "string",
                      description: "Optional: Architecture design document",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Generated code",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      agent: { type: "string" },
                      output: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/review": {
        post: {
          operationId: "reviewCode",
          summary: "QA Engineer: Review code and create test plan",
          description:
            "Uses the QA Engineer agent to review code quality, find issues, check security, and generate test code.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["code"],
                  properties: {
                    requirement: {
                      type: "string",
                      description: "Original requirement for context",
                    },
                    code: {
                      type: "string",
                      description: "The code to review",
                    },
                    architecture: {
                      type: "string",
                      description: "Optional: Architecture design for reference",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Code review and test plan",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      agent: { type: "string" },
                      output: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/decompose": {
        post: {
          operationId: "decomposeTask",
          summary: "Break a complex task into smaller subtasks",
          description:
            "Analyzes a complex task and breaks it into smaller, actionable subtasks with role assignments and priority levels.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["task"],
                  properties: {
                    task: {
                      type: "string",
                      description: "The complex task to decompose",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: "Decomposed subtasks",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      agent: { type: "string" },
                      output: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      // NOTE: /api/workflow/{id} (getWorkflowStatus) hidden from OpenAPI — not needed with sync endpoint.
    },
  });
});

// ---------------------------------------------------------------------------
// API Endpoints
// ---------------------------------------------------------------------------

// Health check
app.get("/healthz", (_req, res) => res.json({ status: "ok", service: "metagpt-toolserver" }));

// ── Full Pipeline — starts background, returns view URL immediately ──
app.post("/api/develop-sync", (req, res) => {
  const { requirement, model } = req.body;
  if (!requirement) {
    return res.status(400).json({ error: "requirement is required" });
  }

  const options = model ? { model } : {};
  const serverUrl = PUBLIC_URL || `http://localhost:${PORT}`;

  // Create workflow entry
  const workflowId = generateId();
  const workflow = {
    id: workflowId,
    requirement,
    status: "running",
    current_step: "product_manager",
    steps: {},
    started_at: new Date().toISOString(),
    completed_at: null,
    error: null,
  };
  workflows.set(workflowId, workflow);
  saveWorkflows();

  // Start pipeline in background
  runFullPipeline(requirement, options, workflowId).catch((err) => {
    console.error("Pipeline error:", err);
  });

  // Return immediately with view URL
  res.json({
    workflow_id: workflowId,
    status: "running",
    message: `Dự án đang được phát triển bởi đội AI (PM → Architect → Engineer → QA). Quá trình mất khoảng 5-10 phút.`,
    view_url: `${serverUrl}/view/${workflowId}`,
    download_url: `${serverUrl}/api/workflow/${workflowId}/download`,
    instructions: `Mở link sau để xem tiến độ và kết quả theo thời gian thực: ${serverUrl}/view/${workflowId}`,
  });
});

// ── Full Pipeline (ASYNC — returns immediately, runs in background) ──
app.post("/api/develop", (req, res) => {
  const { requirement, model } = req.body;
  if (!requirement) {
    return res.status(400).json({ error: "requirement is required" });
  }

  const options = model ? { model } : {};

  // Create workflow entry first
  const workflowId = generateId();
  const workflow = {
    id: workflowId,
    requirement,
    status: "running",
    current_step: "product_manager",
    steps: {},
    started_at: new Date().toISOString(),
    completed_at: null,
    error: null,
  };
  workflows.set(workflowId, workflow);
  saveWorkflows();

  // Start pipeline in background (don't await!)
  runFullPipeline(requirement, options, workflowId).catch((err) => {
    console.error("Background pipeline error:", err);
  });

  // Return immediately with workflow_id
  res.json({
    workflow_id: workflowId,
    status: "running",
    message: "Pipeline started! Use getWorkflowStatus with this workflow_id to check progress and get results. The pipeline runs: Product Manager → Architect → Engineer → QA Engineer. Each step takes 30-90 seconds.",
    current_step: "product_manager",
    steps_order: ["product_manager", "architect", "engineer", "qa_engineer"],
  });
});

// ── Product Manager: Analyze Requirement ──
app.post("/api/analyze", async (req, res) => {
  try {
    const { requirement } = req.body;
    if (!requirement) {
      return res.status(400).json({ error: "requirement is required" });
    }

    const output = await runAgent(
      "product_manager",
      `Please analyze this requirement and create a detailed PRD:\n\n${requirement}`
    );
    res.json({ agent: "Product Manager", output });
  } catch (err) {
    console.error("Analyze error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Architect: Design Architecture ──
app.post("/api/design", async (req, res) => {
  try {
    const { requirement, prd } = req.body;
    if (!requirement) {
      return res.status(400).json({ error: "requirement is required" });
    }

    let prompt = `Design the system architecture for the following requirement:\n\n${requirement}`;
    if (prd) {
      prompt = `Based on the following PRD, design the system architecture.\n\n## PRD\n${prd}\n\n## Original Requirement\n${requirement}`;
    }

    const output = await runAgent("architect", prompt);
    res.json({ agent: "Software Architect", output });
  } catch (err) {
    console.error("Design error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Engineer: Generate Code ──
app.post("/api/implement", async (req, res) => {
  try {
    const { requirement, prd, architecture } = req.body;
    if (!requirement) {
      return res.status(400).json({ error: "requirement is required" });
    }

    let prompt = `Write the complete production code for:\n\n${requirement}`;
    if (prd && architecture) {
      prompt = `Based on the following PRD and Architecture, write the complete production code.\n\n## PRD\n${prd}\n\n## Architecture\n${architecture}\n\n## Original Requirement\n${requirement}`;
    } else if (architecture) {
      prompt = `Based on the following Architecture, write the complete production code.\n\n## Architecture\n${architecture}\n\n## Original Requirement\n${requirement}`;
    } else if (prd) {
      prompt = `Based on the following PRD, write the complete production code.\n\n## PRD\n${prd}\n\n## Original Requirement\n${requirement}`;
    }

    const output = await runAgent("engineer", prompt);

    // Extract and save code files to disk
    const workflowId = generateId();
    const extractedFiles = extractFiles(output);
    let fileInfo = {};
    if (extractedFiles.length > 0) {
      console.log(`📦 Extracting ${extractedFiles.length} files...`);
      const outputDir = writeFilesToDisk(workflowId, extractedFiles);
      const zipPath = createZipArchive(workflowId);
      fileInfo = {
        files: extractedFiles.map((f) => f.path),
        output_dir: outputDir,
        download_url: zipPath ? `/api/workflow/${workflowId}/download` : null,
        download_hint: zipPath ? `Download project: http://localhost:${PORT}/api/workflow/${workflowId}/download` : null,
      };
    }

    // Store as a minimal workflow for download access
    workflows.set(workflowId, {
      id: workflowId,
      requirement,
      status: "completed",
      current_step: null,
      steps: { engineer: { output, completed_at: new Date().toISOString() } },
      files: fileInfo.files || [],
      output_dir: fileInfo.output_dir || null,
      download_url: fileInfo.download_url || null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
    saveWorkflows();

    res.json({ agent: "Senior Software Engineer", output, ...fileInfo });
  } catch (err) {
    console.error("Implement error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── QA Engineer: Review Code ──
app.post("/api/review", async (req, res) => {
  try {
    const { requirement, code, architecture } = req.body;
    if (!code) {
      return res.status(400).json({ error: "code is required" });
    }

    let prompt = `Review the following code:\n\n## Code\n${code}`;
    if (requirement) {
      prompt = `Review the following code based on the requirements.\n\n## Requirement\n${requirement}\n\n## Code\n${code}`;
    }
    if (architecture) {
      prompt += `\n\n## Architecture Reference\n${architecture}`;
    }

    const output = await runAgent("qa_engineer", prompt);
    res.json({ agent: "QA Engineer", output });
  } catch (err) {
    console.error("Review error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Task Decomposition ──
app.post("/api/decompose", async (req, res) => {
  try {
    const { task } = req.body;
    if (!task) {
      return res.status(400).json({ error: "task is required" });
    }

    const output = await runAgent(
      "task_decomposer",
      `Break down the following task into smaller, actionable subtasks:\n\n${task}`
    );
    res.json({ agent: "Task Decomposer", output });
  } catch (err) {
    console.error("Decompose error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Workflow Status ──
app.get("/api/workflow/:id", (req, res) => {
  const workflow = workflows.get(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }

  const response = {
    id: workflow.id,
    status: workflow.status,
    current_step: workflow.current_step,
    requirement: workflow.requirement,
    started_at: workflow.started_at,
    completed_at: workflow.completed_at,
    error: workflow.error,
    files: workflow.files || [],
    output_dir: workflow.output_dir || null,
    download_url: workflow.download_url || null,
    steps: {},
  };

  for (const [step, data] of Object.entries(workflow.steps)) {
    response.steps[step] = {
      completed_at: data.completed_at,
      output_length: data.output ? data.output.length : 0,
      output: data.output,
    };
  }

  res.json(response);
});

// ── Download workflow output as tar.gz ──
app.get("/api/workflow/:id/download", (req, res) => {
  const workflow = workflows.get(req.params.id);
  if (!workflow) {
    return res.status(404).json({ error: "Workflow not found" });
  }
  if (workflow.status !== "completed") {
    return res.status(400).json({ error: "Workflow not yet completed" });
  }

  const zipPath = path.join(OUTPUT_DIR, `${req.params.id}.tar.gz`);
  if (!fs.existsSync(zipPath)) {
    // Try creating it now
    const created = createZipArchive(req.params.id);
    if (!created) {
      return res.status(404).json({ error: "No output files found" });
    }
  }

  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="metagpt-${req.params.id}.tar.gz"`);
  fs.createReadStream(zipPath).pipe(res);
});

// ── Browse files in workflow output ──
app.get("/api/workflow/:id/files", (req, res) => {
  const workflowDir = path.join(OUTPUT_DIR, req.params.id);
  if (!fs.existsSync(workflowDir)) {
    return res.status(404).json({ error: "No output directory found" });
  }

  const files = [];
  function walk(dir, prefix = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else {
        const stat = fs.statSync(path.join(dir, entry.name));
        files.push({ path: rel, size: stat.size });
      }
    }
  }
  walk(workflowDir);
  res.json({ workflow_id: req.params.id, output_dir: workflowDir, files });
});

// ── Read a specific file from workflow output ──
app.get("/api/workflow/:id/file/*", (req, res) => {
  const filePath = req.params[0];
  const safePath = filePath.replace(/\.\./g, "");
  const fullPath = path.join(OUTPUT_DIR, req.params.id, safePath);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: `File not found: ${safePath}` });
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  fs.createReadStream(fullPath).pipe(res);
});

// ── Helper: read actual files from output dir for file tree ──
function getOutputFiles(workflowId) {
  const dir = path.join(OUTPUT_DIR, workflowId);
  if (!fs.existsSync(dir)) return [];
  const results = [];
  function walk(d, prefix = "") {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(d, entry.name), rel);
      } else {
        const stat = fs.statSync(path.join(d, entry.name));
        let content = "";
        if (stat.size < 100000) {
          try { content = fs.readFileSync(path.join(d, entry.name), "utf-8"); } catch {}
        }
        results.push({ path: rel, size: stat.size, content });
      }
    }
  }
  walk(dir);
  return results;
}

// ── Web UI: View workflow results in browser ──
app.get("/view/:id", (req, res) => {
  const workflow = workflows.get(req.params.id);
  if (!workflow) {
    return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title>
<style>body{font-family:system-ui;background:#1a1a2e;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;padding:40px;background:#16213e;border-radius:12px}h1{color:#ff6b6b}a{color:#00d4ff}</style></head>
<body><div class="box"><h1>Workflow not found</h1><p>ID: ${req.params.id}</p><p>Workflow may have been created before a restart.</p>
<a href="/dashboard">View all workflows</a></div></body></html>`);
  }

  const serverUrl = PUBLIC_URL || `http://localhost:${PORT}`;
  const steps = workflow.steps || {};
  const outputFiles = getOutputFiles(req.params.id);

  // Escape HTML helper
  const esc = (s) => s ? s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") : "";

  // Progress bar
  const stepOrder = ["product_manager", "architect", "engineer", "qa_engineer"];
  const completedSteps = stepOrder.filter(s => steps[s]);
  const progress = workflow.status === "completed" ? 100 : Math.round((completedSteps.length / 4) * 100);

  const html = `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MetaGPT — ${esc(workflow.requirement ? workflow.requirement.slice(0, 60) : workflow.id)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Segoe UI',system-ui,sans-serif;margin:0;padding:0;background:#0f0f23;color:#e0e0e0;min-height:100vh}
  .header{background:linear-gradient(135deg,#1a1a3e,#16213e);padding:24px;text-align:center;border-bottom:2px solid #00d4ff30}
  .header h1{color:#00d4ff;margin:0 0 8px 0;font-size:24px}
  .requirement{color:#aaa;font-size:14px;max-width:700px;margin:0 auto}
  .container{max-width:1200px;margin:0 auto;padding:20px;display:grid;grid-template-columns:1fr;gap:20px}
  @media(min-width:900px){.container{grid-template-columns:300px 1fr}}

  /* Status & Progress */
  .status-bar{display:flex;align-items:center;gap:12px;padding:16px;background:#16213e;border-radius:10px;margin-bottom:4px}
  .status-badge{padding:6px 16px;border-radius:20px;font-weight:bold;font-size:13px;text-transform:uppercase}
  .status-badge.completed{background:#1b5e20;color:#a5d6a7}
  .status-badge.running{background:#e65100;color:#ffcc80;animation:pulse 2s infinite}
  .status-badge.failed{background:#b71c1c;color:#ef9a9a}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.6}}
  .progress-wrap{flex:1}
  .progress-bar{height:8px;background:#0f3460;border-radius:4px;overflow:hidden}
  .progress-fill{height:100%;background:linear-gradient(90deg,#00d4ff,#00ff88);border-radius:4px;transition:width 0.5s}
  .progress-text{font-size:12px;color:#888;margin-top:4px}

  /* Pipeline Steps */
  .steps-panel{background:#16213e;border-radius:10px;padding:16px;overflow:hidden}
  .steps-panel h2{color:#00d4ff;margin:0 0 12px 0;font-size:16px;border-bottom:1px solid #ffffff15;padding-bottom:8px}
  .step{border-left:3px solid #333;padding:8px 12px;margin:4px 0;cursor:pointer;border-radius:0 6px 6px 0;transition:all 0.2s}
  .step:hover{background:#1a2744}
  .step.done{border-left-color:#00ff88}
  .step.active{border-left-color:#ffcc80;background:#1a2744}
  .step.pending{border-left-color:#333;opacity:0.5}
  .step-header{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px}
  .step-time{font-size:11px;color:#666;margin-top:2px}
  .step-content{margin-top:10px;display:none}
  .step.expanded .step-content{display:block}
  .step-content pre{white-space:pre-wrap;word-wrap:break-word;background:#0a1628;padding:12px;border-radius:6px;font-size:12px;max-height:400px;overflow-y:auto;line-height:1.5;border:1px solid #ffffff10}

  /* File Browser */
  .files-panel{background:#16213e;border-radius:10px;overflow:hidden;display:flex;flex-direction:column;min-height:500px}
  .files-header{padding:12px 16px;border-bottom:1px solid #ffffff15;display:flex;align-items:center;justify-content:space-between}
  .files-header h2{color:#00d4ff;margin:0;font-size:16px}
  .file-count{color:#888;font-size:13px}
  .files-body{display:flex;flex:1;min-height:0}
  .file-tree{width:260px;min-width:200px;border-right:1px solid #ffffff10;overflow-y:auto;padding:8px 0;max-height:600px}
  .file-item{padding:6px 12px;cursor:pointer;font-size:13px;font-family:'Cascadia Code','Fira Code',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background 0.15s;display:flex;align-items:center;gap:6px}
  .file-item:hover{background:#1a2744}
  .file-item.selected{background:#0f3460;color:#00d4ff}
  .file-item .icon{font-size:14px;flex-shrink:0}
  .file-item .size{color:#555;font-size:11px;margin-left:auto;flex-shrink:0}
  .file-dir{padding:6px 12px;font-size:12px;color:#00d4ff80;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-top:8px}
  .file-preview{flex:1;overflow:auto;max-height:600px}
  .file-preview-header{padding:8px 16px;background:#0a1628;border-bottom:1px solid #ffffff10;font-size:13px;color:#00d4ff;font-family:'Cascadia Code','Fira Code',monospace;position:sticky;top:0;z-index:1;display:flex;justify-content:space-between}
  .file-preview pre{margin:0;padding:16px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-wrap:break-word;font-family:'Cascadia Code','Fira Code',monospace}
  .file-preview .empty{padding:40px;text-align:center;color:#555}
  .line-numbers{color:#444;user-select:none;text-align:right;padding-right:12px;border-right:1px solid #ffffff10;margin-right:12px;display:inline-block}

  /* Download button */
  .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:linear-gradient(135deg,#00d4ff,#0099cc);color:#000;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px;transition:all 0.2s;border:none;cursor:pointer}
  .btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px #00d4ff40}
  .btn-secondary{background:linear-gradient(135deg,#333,#444);color:#e0e0e0}
  .btn-secondary:hover{box-shadow:0 4px 12px #ffffff20}
  .actions{display:flex;gap:8px;flex-wrap:wrap;padding:4px 0}

  /* Meta info */
  .meta-info{display:flex;gap:20px;justify-content:center;color:#666;font-size:12px;padding:16px;flex-wrap:wrap}
  .meta-info span{display:flex;align-items:center;gap:4px}

  /* Tabs */
  .tab-bar{display:flex;border-bottom:1px solid #ffffff15;padding:0 16px}
  .tab{padding:10px 16px;cursor:pointer;color:#888;font-size:13px;border-bottom:2px solid transparent;transition:all 0.2s}
  .tab:hover{color:#e0e0e0}
  .tab.active{color:#00d4ff;border-bottom-color:#00d4ff}
  .tab-content{display:none}
  .tab-content.active{display:block}
</style>
${workflow.status === "running" ? "<script>setTimeout(()=>location.reload(),10000)</script>" : ""}
</head><body>

<div class="header">
  <h1>MetaGPT Development Result</h1>
  <p class="requirement">${esc(workflow.requirement || "")}</p>
</div>

<div style="max-width:1200px;margin:0 auto;padding:16px 20px">
  <div class="status-bar">
    <span class="status-badge ${workflow.status}">${workflow.status === "running" ? "Running..." : workflow.status === "completed" ? "Completed" : "Failed"}</span>
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
      <div class="progress-text">${completedSteps.length}/4 steps completed${workflow.current_step ? " — currently: " + workflow.current_step : ""}</div>
    </div>
  </div>
  <div class="meta-info">
    <span>Started: ${workflow.started_at || "—"}</span>
    ${workflow.completed_at ? `<span>Completed: ${workflow.completed_at}</span>` : ""}
    <span>Files: ${outputFiles.length}</span>
    <span>ID: ${workflow.id}</span>
  </div>
</div>

<div class="container">
  <!-- Left: Pipeline Steps -->
  <div>
    <div class="steps-panel">
      <h2>Pipeline Steps</h2>
      ${[["product_manager", "Product Manager — PRD"], ["architect", "Architect — Design"], ["engineer", "Engineer — Code"], ["qa_engineer", "QA — Review"]].map(([key, title], i) => {
        const step = steps[key];
        const cls = step ? (workflow.current_step === key ? "active" : "done") : (workflow.current_step === key ? "active" : "pending");
        const time = step && step.completed_at ? new Date(step.completed_at).toLocaleTimeString() : "";
        const output = step ? esc(step.output || "") : "";
        return `<div class="step ${cls}" onclick="this.classList.toggle('expanded')">
          <div class="step-header"><span>${["1","2","3","4"][i]}</span> ${title}</div>
          ${time ? `<div class="step-time">Completed: ${time}</div>` : ""}
          ${output ? `<div class="step-content"><pre>${output}</pre></div>` : ""}
        </div>`;
      }).join("")}
    </div>

    <div style="padding:12px 0">
      <div class="actions">
        ${workflow.download_url ? `<a href="${serverUrl}${workflow.download_url}" class="btn">Download .tar.gz</a>` : ""}
        <a href="/dashboard" class="btn btn-secondary">All Projects</a>
      </div>
    </div>
  </div>

  <!-- Right: File Browser -->
  <div class="files-panel">
    <div class="files-header">
      <h2>Project Files</h2>
      <span class="file-count">${outputFiles.length} files</span>
    </div>
    ${outputFiles.length > 0 ? `
    <div class="files-body">
      <div class="file-tree" id="fileTree">
        ${outputFiles.map((f, i) => {
          const ext = path.extname(f.path).toLowerCase();
          const iconMap = { ".js": "JS", ".ts": "TS", ".tsx": "TX", ".py": "PY", ".html": "HT", ".css": "CS", ".json": "{}",  ".md": "MD", ".yml": "YM", ".sh": "SH", ".sql": "SQ", ".txt": "TX" };
          const icon = iconMap[ext] || "..";
          const sizeStr = f.size < 1024 ? f.size + "B" : (f.size / 1024).toFixed(1) + "K";
          return `<div class="file-item${i === 0 ? " selected" : ""}" data-index="${i}" onclick="selectFile(${i})">
            <span class="icon">${icon}</span>
            <span>${f.path.split("/").pop()}</span>
            <span class="size">${sizeStr}</span>
          </div>`;
        }).join("")}
      </div>
      <div class="file-preview" id="filePreview">
        <div class="file-preview-header" id="previewHeader">${outputFiles[0] ? outputFiles[0].path : ""}</div>
        <pre id="previewCode">${outputFiles[0] ? esc(outputFiles[0].content) : ""}</pre>
      </div>
    </div>` : `<div style="padding:40px;text-align:center;color:#555">No files generated yet</div>`}
  </div>
</div>

<script>
const files = [${outputFiles.map(f => `{path:${JSON.stringify(f.path)},content:${JSON.stringify(f.content)},size:${f.size}}`).join(",")}];

function selectFile(idx) {
  const f = files[idx];
  if (!f) return;
  document.getElementById("previewHeader").textContent = f.path;
  document.getElementById("previewCode").textContent = f.content;
  document.querySelectorAll(".file-item").forEach((el, i) => {
    el.classList.toggle("selected", i === idx);
  });
}
</script>

</body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ── Dashboard: List all workflows ──
app.get("/dashboard", (_req, res) => {
  const list = [];
  for (const [id, wf] of workflows) {
    list.push({ id, status: wf.status, requirement: (wf.requirement || "").slice(0, 120), started_at: wf.started_at, completed_at: wf.completed_at, files: (wf.files || []).length });
  }
  list.sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""));

  const rows = list.map(w => {
    const badge = w.status === "completed" ? '<span style="color:#a5d6a7">DONE</span>' : w.status === "running" ? '<span style="color:#ffcc80">RUNNING</span>' : '<span style="color:#ef9a9a">FAILED</span>';
    return `<tr onclick="location.href='/view/${w.id}'" style="cursor:pointer">
      <td>${badge}</td><td>${w.requirement.replace(/</g,"&lt;")}</td><td>${w.files}</td><td>${w.started_at || ""}</td></tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MetaGPT Dashboard</title>
<style>
  body{font-family:system-ui;background:#0f0f23;color:#e0e0e0;margin:0;padding:20px}
  h1{color:#00d4ff;text-align:center}
  table{width:100%;max-width:1000px;margin:20px auto;border-collapse:collapse}
  th{text-align:left;padding:10px;color:#00d4ff;border-bottom:2px solid #00d4ff30;font-size:13px}
  td{padding:10px;border-bottom:1px solid #ffffff10;font-size:13px}
  tr:hover td{background:#16213e}
  .empty{text-align:center;padding:40px;color:#555}
</style></head><body>
<h1>MetaGPT Dashboard</h1>
${list.length > 0 ? `<table><thead><tr><th>Status</th><th>Requirement</th><th>Files</th><th>Started</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">No workflows yet. Start one from LobeChat!</p>'}
</body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ── List all workflows ──
app.get("/api/workflows", (_req, res) => {
  const list = [];
  for (const [id, wf] of workflows) {
    list.push({
      id,
      status: wf.status,
      requirement: wf.requirement.slice(0, 100),
      current_step: wf.current_step,
      started_at: wf.started_at,
      completed_at: wf.completed_at,
    });
  }
  res.json(list);
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  🤖 MetaGPT Multi-Agent Orchestrator`);
  console.log(`  📡 Running on port ${PORT}`);
  console.log(`  🧠 LLM: ${LLM_MODEL} @ ${LLM_API_URL}`);
  console.log(`  📋 Agents: PM, Architect, Engineer, QA`);
  console.log(`${"=".repeat(60)}\n`);
  console.log(`Plugin manifest: http://localhost:${PORT}/.well-known/ai-plugin.json`);
  console.log(`OpenAPI spec:    http://localhost:${PORT}/openapi.json`);
  console.log(`Health check:    http://localhost:${PORT}/healthz\n`);
});
