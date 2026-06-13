import http from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addProjectGlobalRef, capabilitiesPayload, loadEditableConfig, removeProjectGlobalRef, saveEditableResource, saveEditableSections } from "./config-editor.mjs";
import { resolveBackend } from "./backends/index.mjs";
import { supportedResourceKinds, supportedRuntimes } from "./model.mjs";
import { addTask, archiveBoard, createBoard, editTask, getBoard, listBoards, moveTask, repairBoard, syncBoardFromGsdRoadmap, updateBoardMilestone, validateBoards, writeBoardIndex } from "./boards.mjs";
import { answerTaskExecutionGate, assignTaskToAgent, isGsdExecutionConfigured, listBoardAgents, readTaskExecution, readTaskExecutionEvents, recordGsdSessionEvent, subscribeTaskExecutionEvents, takeOverTaskExecution, updateTaskExecution } from "./board-execution.mjs";
import { continueGsdMilestone } from "./gsd-runtime-fallback.mjs";

const MAX_BODY_BYTES = 1_000_000;
const VALID_CONFIG_KINDS = new Set(supportedResourceKinds());
const VALID_RUNTIMES = new Set(supportedRuntimes());
const VALID_CATALOG_KINDS = new Set(["skill", "agent"]);

export async function serveSetupUi(catalog, options = {}) {
  const port = Number.parseInt(options.port ?? "4177", 10);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const uiRoot = path.join(repoRoot, "ui");
  const projectDir = path.resolve(options.projectDir ?? process.cwd());

  const server = http.createServer(async (request, response) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      sendApiError(response, 400, "Invalid request URL.", "invalid-url");
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/config") {
      try {
        sendJson(response, 200, await loadEditableConfig(projectDir, editorOptions(options, "project")));
      } catch (error) {
        sendApiError(response, 400, error.message, "config-load-failed");
      }
      return;
    }

    const scopedConfigMatch = requestUrl.pathname.match(/^\/api\/config\/(project|global)$/);
    if (request.method === "GET" && scopedConfigMatch) {
      try {
        sendJson(response, 200, await loadEditableConfig(projectDir, editorOptions(options, scopedConfigMatch[1])));
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "config-load-failed");
      }
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/capabilities") {
      sendJson(response, 200, capabilitiesPayload());
      return;
    }

    if (request.method === "PUT" && requestUrl.pathname === "/api/config/sections") {
      try {
        const sections = await readJsonBody(request);
        const result = await saveEditableSections(projectDir, sections, editorOptions(options, "project"));
        sendJson(response, result.ok ? 200 : 400, result);
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed");
      }
      return;
    }

    const resourceMatch = requestUrl.pathname.match(/^\/api\/config\/resources\/([^/]+)\/([^/]+)$/);
    if (request.method === "PUT" && resourceMatch) {
      try {
        await handleResourceSave(request, response, projectDir, options, "project", resourceMatch[1], resourceMatch[2]);
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed");
      }
      return;
    }

    const scopedResourceMatch = requestUrl.pathname.match(/^\/api\/config\/(project|global)\/resources\/([^/]+)\/([^/]+)$/);
    if (request.method === "PUT" && scopedResourceMatch) {
      try {
        await handleResourceSave(request, response, projectDir, options, scopedResourceMatch[1], scopedResourceMatch[2], scopedResourceMatch[3]);
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed");
      }
      return;
    }

    const refMatch = requestUrl.pathname.match(/^\/api\/config\/project\/global-refs\/([^/]+)\/([^/]+)$/);
    if ((request.method === "PUT" || request.method === "DELETE") && refMatch) {
      try {
        const routeKind = decodeRoutePart(refMatch[1]);
        const routeId = decodeRoutePart(refMatch[2]);
        const update = request.method === "PUT" ? addProjectGlobalRef : removeProjectGlobalRef;
        const result = await update(projectDir, { kind: routeKind, id: routeId }, editorOptions(options, "project"));
        sendJson(response, result.ok ? 200 : 400, result);
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed");
      }
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/boards") {
      try {
        sendJson(response, 200, { ok: true, boards: await listBoards(projectDir, { includeArchived: requestUrl.searchParams.get("archived") === "true" }) });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    if (request.method === "PUT" && requestUrl.pathname === "/api/boards/index") {
      try {
        const result = await writeBoardIndex(projectDir);
        sendJson(response, 200, { ok: true, index: result.index, indexPath: result.indexPath });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/boards/validate") {
      try {
        const diagnostics = await validateBoards(projectDir);
        const errors = diagnostics.filter((item) => item.severity === "error");
        const warnings = diagnostics.filter((item) => item.severity === "warning");
        sendJson(response, 200, { ok: true, valid: errors.length === 0, errors: errors.length, warnings: warnings.length, diagnostics });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/boards/agents") {
      try {
        sendJson(response, 200, { ok: true, agents: await listBoardAgents(projectDir, options) });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    if (request.method === "PUT") {
      const boardCreateMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)$/);
      if (boardCreateMatch) {
        try {
          const routeId = decodeRoutePart(boardCreateMatch[1]);
          const item = await readJsonBody(request);
          if (item.id !== undefined && item.id !== routeId) {
            sendApiError(response, 400, "Board id in payload does not match request path.", "route-payload-mismatch");
            return;
          }
          const gsdConfigured = await isGsdExecutionConfigured(projectDir, options);
          const result = await createBoard(projectDir, {
            ...item,
            id: routeId,
            executionProvider: gsdConfigured ? "gsd" : item.executionProvider,
            defaultExecutionRuntime: item.defaultExecutionRuntime ?? "codex"
          }, { force: Boolean(item.force) });
          let board = result.board;
          let runtime = null;
          sendJson(response, 200, { ok: true, board, runtime });
        } catch (error) {
          sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
        }
        return;
      }
    }

    const boardShowMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)$/);
    if (request.method === "GET" && boardShowMatch) {
      try {
        const routeId = decodeRoutePart(boardShowMatch[1]);
        sendJson(response, 200, { ok: true, board: await getBoard(projectDir, routeId) });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    const boardArchiveMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)\/archive$/);
    if (request.method === "PUT" && boardArchiveMatch) {
      try {
        sendJson(response, 200, { ok: true, board: await archiveBoard(projectDir, decodeRoutePart(boardArchiveMatch[1])) });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    const boardSyncMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)\/sync$/);
    if (request.method === "PUT" && boardSyncMatch) {
      try {
        const item = await readJsonBody(request);
        const result = await syncBoardFromGsdRoadmap(projectDir, decodeRoutePart(boardSyncMatch[1]), {
          milestoneId: item.milestone ?? item.milestoneId
        });
        sendJson(response, 200, { ok: true, board: result.board, phases: result.phases, created: result.created, updated: result.updated ?? [], actions: result.actions });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    const boardRepairMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)\/repair$/);
    if (request.method === "PUT" && boardRepairMatch) {
      try {
        const item = await readOptionalJsonBody(request);
        const result = await repairBoard(projectDir, decodeRoutePart(boardRepairMatch[1]), {
          defaultExecutionRuntime: item.defaultExecutionRuntime
        });
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    const boardMilestoneAnswerMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)\/milestone\/answer$/);
    if (request.method === "PUT" && boardMilestoneAnswerMatch) {
      try {
        const item = await readJsonBody(request);
        const answer = typeof item.text === "string" ? item.text : item.answer;
        if (typeof answer !== "string" || answer.trim() === "") {
          throw new Error("Milestone answer text is required.");
        }
        const board = await getBoard(projectDir, decodeRoutePart(boardMilestoneAnswerMatch[1]));
        if (!board.executionProvider || resolveBackend(board.executionProvider).kind !== "gsd") throw new Error(`Board ${board.id} is not backed by GSD.`);
        const runtime = await continueGsdMilestone(projectDir, board, { answer: answer.trim() });
        const updated = await updateBoardMilestone(projectDir, board.id, runtime, { answer: answer.trim() });
        sendJson(response, 200, { ok: true, board: updated, runtime });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    const taskMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)\/tasks\/([^/]+)$/);
    if (request.method === "PUT" && taskMatch) {
      try {
        const boardId = decodeRoutePart(taskMatch[1]);
        const taskId = decodeRoutePart(taskMatch[2]);
        const item = await readJsonBody(request);
        if (item.id !== undefined && item.id !== taskId) {
          sendApiError(response, 400, "Task id in payload does not match request path.", "route-payload-mismatch");
          return;
        }
        const result = await addTask(projectDir, boardId, { ...item, id: taskId }, { force: Boolean(item.force) });
        sendJson(response, 200, { ok: true, task: result.task });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    if (request.method === "PATCH" && taskMatch) {
      try {
        const boardId = decodeRoutePart(taskMatch[1]);
        const taskId = decodeRoutePart(taskMatch[2]);
        const item = await readJsonBody(request);
        if (item.id !== undefined && item.id !== taskId) {
          sendApiError(response, 400, "Task id in payload does not match request path.", "route-payload-mismatch");
          return;
        }
        const task = await editTask(projectDir, boardId, taskId, item);
        sendJson(response, 200, { ok: true, task });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    const taskStatusMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)\/tasks\/([^/]+)\/status$/);
    if (request.method === "PUT" && taskStatusMatch) {
      try {
        const item = await readJsonBody(request);
        if (!item.status) {
          sendApiError(response, 400, "Task status is required.", "validation-failed");
          return;
        }
        const task = await moveTask(projectDir, decodeRoutePart(taskStatusMatch[1]), decodeRoutePart(taskStatusMatch[2]), item.status);
        sendJson(response, 200, { ok: true, task });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    const taskAssignmentMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)\/tasks\/([^/]+)\/assignment$/);
    if (request.method === "PUT" && taskAssignmentMatch) {
      try {
        const item = await readJsonBody(request);
        if (!item.agentId) {
          sendApiError(response, 400, "Agent id is required.", "validation-failed");
          return;
        }
        const result = await assignTaskToAgent(projectDir, decodeRoutePart(taskAssignmentMatch[1]), decodeRoutePart(taskAssignmentMatch[2]), item.agentId, {
          ...options,
          provider: item.provider,
          backgroundExecution: true,
          interactiveGates: true
        });
        sendJson(response, 200, { ok: true, task: result.task, execution: result.execution, executionPath: result.executionPath });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    const taskExecutionMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)\/tasks\/([^/]+)\/execution$/);
    if (request.method === "GET" && taskExecutionMatch) {
      try {
        const result = await readTaskExecution(projectDir, decodeRoutePart(taskExecutionMatch[1]), decodeRoutePart(taskExecutionMatch[2]));
        sendJson(response, 200, { ok: true, execution: result.execution, executionPath: result.executionPath });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed");
      }
      return;
    }

    const taskExecutionEventsMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)\/tasks\/([^/]+)\/execution\/events$/);
    if (request.method === "GET" && taskExecutionEventsMatch) {
      try {
        const boardId = decodeRoutePart(taskExecutionEventsMatch[1]);
        const taskId = decodeRoutePart(taskExecutionEventsMatch[2]);
        if (requestUrl.searchParams.get("stream") === "true" || request.headers.accept?.includes("text/event-stream")) {
          await streamTaskExecutionEvents(response, projectDir, boardId, taskId);
        } else {
          sendJson(response, 200, { ok: true, events: await readTaskExecutionEvents(projectDir, boardId, taskId) });
        }
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed");
      }
      return;
    }

    const taskExecutionHostConsoleMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)\/tasks\/([^/]+)\/execution\/host-console$/);
    if (request.method === "POST" && taskExecutionHostConsoleMatch) {
      try {
        const result = await openTaskExecutionHostConsole(projectDir, decodeRoutePart(taskExecutionHostConsoleMatch[1]), decodeRoutePart(taskExecutionHostConsoleMatch[2]));
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }

    const taskExecutionGateMatch = requestUrl.pathname.match(/^\/api\/boards\/([^/]+)\/tasks\/([^/]+)\/execution\/gate$/);
    if (request.method === "PUT" && taskExecutionGateMatch) {
      try {
        const item = await readJsonBody(request);
        const result = await answerTaskExecutionGate(projectDir, decodeRoutePart(taskExecutionGateMatch[1]), decodeRoutePart(taskExecutionGateMatch[2]), item);
        sendJson(response, 200, { ok: true, task: result.task, execution: result.execution, executionPath: result.executionPath });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed", undefined, error);
      }
      return;
    }
    if (request.method === "PUT" && taskExecutionMatch) {
      try {
        const item = await readJsonBody(request);
        if (!item.status) {
          sendApiError(response, 400, "Execution status is required.", "validation-failed");
          return;
        }
        const result = await updateTaskExecution(projectDir, decodeRoutePart(taskExecutionMatch[1]), decodeRoutePart(taskExecutionMatch[2]), item);
        sendJson(response, 200, { ok: true, task: result.task, execution: result.execution, executionPath: result.executionPath });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed");
      }
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/items" && catalog) {
      sendJson(response, 200, catalog.listItems());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/items" && catalog) {
      try {
        const item = await readJsonBody(request);
        const diagnostics = validateCatalogItem(item);
        if (diagnostics.length > 0) {
          sendApiError(response, 400, "Catalog item is invalid.", "validation-failed", diagnostics);
          return;
        }
        catalog.upsertItem(item);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendApiError(response, error.status ?? 400, error.message, error.code ?? "request-failed");
      }
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      sendApiError(response, 404, "API route not found.", "not-found");
      return;
    }

    const filePath = safeStaticPath(uiRoot, requestUrl.pathname);
    if (!filePath) {
      send(response, 404, "text/plain", "Not found");
      return;
    }

    readFile(filePath).then((content) => {
      send(response, 200, contentType(filePath), content);
    }).catch(() => {
      send(response, 404, "text/plain", "Not found");
    });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function handleResourceSave(request, response, projectDir, serverOptions, scope, kindPart, idPart) {
  const routeKind = decodeRoutePart(kindPart);
  const routeId = decodeRoutePart(idPart);
  if (!VALID_CONFIG_KINDS.has(routeKind)) {
    sendApiError(response, 400, `Unsupported resource kind "${routeKind}".`, "invalid-kind");
    return;
  }
  if (!routeId) {
    sendApiError(response, 400, "Resource id is required.", "invalid-id");
    return;
  }

  const item = await readJsonBody(request);
  if (item.kind !== undefined && item.kind !== routeKind) {
    sendApiError(response, 400, "Resource kind in payload does not match request path.", "route-payload-mismatch");
    return;
  }
  if (item.id !== undefined && item.id !== routeId) {
    sendApiError(response, 400, "Resource id in payload does not match request path.", "route-payload-mismatch");
    return;
  }
  const result = await saveEditableResource(projectDir, {
    ...item,
    kind: routeKind,
    id: routeId
  }, editorOptions(serverOptions, scope));
  sendJson(response, result.ok ? 200 : 400, result);
}

function editorOptions(serverOptions, scope) {
  return {
    scope,
    ...(serverOptions.env ? { env: serverOptions.env } : {}),
    ...(serverOptions.platform ? { platform: serverOptions.platform } : {}),
    ...(serverOptions.homedir ? { homedir: serverOptions.homedir } : {})
  };
}

function sendJson(response, status, payload) {
  send(response, status, "application/json", JSON.stringify(payload));
}

function sendApiError(response, status, message, code, diagnostics, error) {
  sendJson(response, status, {
    ok: false,
    error: message,
    code,
    ...structuredErrorDetails(error),
    ...(diagnostics ? { diagnostics } : {})
  });
}

function structuredErrorDetails(error) {
  if (!error || typeof error.toJSON !== "function") return {};
  const details = error.toJSON();
  return {
    ...(details.expected !== undefined ? { expected: details.expected } : {}),
    ...(details.actual !== undefined ? { actual: details.actual } : {}),
    ...(details.next !== undefined ? { next: details.next } : {})
  };
}

function send(response, status, contentTypeValue, body) {
  response.writeHead(status, { "content-type": contentTypeValue });
  response.end(body);
}

async function streamTaskExecutionEvents(response, projectDir, boardId, taskId) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  const sendEvent = (event) => {
    response.write(`event: execution\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  for (const event of await readTaskExecutionEvents(projectDir, boardId, taskId)) {
    sendEvent(event);
  }
  const unsubscribe = subscribeTaskExecutionEvents(projectDir, boardId, taskId, sendEvent);
  response.on("close", unsubscribe);
}

async function openTaskExecutionHostConsole(projectDir, boardId, taskId) {
  const result = await readTaskExecution(projectDir, boardId, taskId);
  const execution = result.execution;
  const executionPath = path.resolve(projectDir, result.executionPath);
  const eventsPath = executionPath.replace(/\.json$/u, ".events.jsonl");
  const events = await readTaskExecutionEvents(projectDir, boardId, taskId);
  for (const item of events) {
    if (item.type === "gsd_event") await recordGsdSessionEvent(projectDir, boardId, taskId, executionPath, item.event);
  }
  let refreshed = (await readTaskExecution(projectDir, boardId, taskId)).execution;
  if (refreshed.status === "running") {
    throw httpError(
      `Task ${boardId}/${taskId} is actively running in the web execution runner. Host takeover is available once the execution reaches user input, fails, or stops.`,
      "TASK_EXECUTION_RESUME_ACTIVE",
      409
    );
  }
  if (refreshed.status === "waiting_for_user" && refreshed.resume?.owner?.current !== "host") {
    refreshed = (await takeOverTaskExecution(projectDir, boardId, taskId, { reason: "host-console" })).execution;
  }
  const session = latestResumeSession(refreshed, events);
  if (!session?.id) {
    throw httpError(`No resumable session id is recorded for ${boardId}/${taskId}.`, "TASK_EXECUTION_SESSION_MISSING", 409);
  }
  const resume = resumeCommandForSession(refreshed, session.id);
  const transcriptPath = path.join(projectDir, ".aof", "cache", "boards", "host-console", `${escapeFilePart(boardId)}-${escapeFilePart(taskId)}-${escapeFilePart(session.id)}.transcript.txt`);
  const script = [
    `$Host.UI.RawUI.WindowTitle = 'AOF resume ${escapePowerShellSingleQuoted(boardId)}/${escapePowerShellSingleQuoted(taskId)}'`,
    `Set-Location -LiteralPath '${escapePowerShellSingleQuoted(projectDir)}'`,
    `$AofEventsPath = '${escapePowerShellSingleQuoted(eventsPath)}'`,
    `$AofTranscriptPath = '${escapePowerShellSingleQuoted(transcriptPath)}'`,
    `$AofSessionId = '${escapePowerShellSingleQuoted(session.id)}'`,
    `$AofRuntime = '${escapePowerShellSingleQuoted(resume.runtime)}'`,
    `$AofCommand = '${escapePowerShellSingleQuoted(resume.display)}'`,
    "function Add-AofEvent { param([string]$Type, [string]$Message, [hashtable]$Extra = @{}) $event = @{ at = (Get-Date).ToUniversalTime().ToString('o'); type = $Type; message = $Message; sessionId = $AofSessionId; runtime = $AofRuntime }; foreach ($key in $Extra.Keys) { $event[$key] = $Extra[$key] }; ($event | ConvertTo-Json -Compress -Depth 10) | Add-Content -LiteralPath $AofEventsPath -Encoding utf8 }",
    `Write-Host 'AOF resume ${escapePowerShellSingleQuoted(boardId)}/${escapePowerShellSingleQuoted(taskId)}' -ForegroundColor Cyan`,
    `Write-Host 'status: ${escapePowerShellSingleQuoted(refreshed.status ?? "unknown")}'`,
    `Write-Host 'agent: ${escapePowerShellSingleQuoted(refreshed.assignedAgent?.id ?? "unassigned")}'`,
    `Write-Host 'phase: ${escapePowerShellSingleQuoted(refreshed.phase ?? "unknown")}'`,
    `Write-Host 'session: ${escapePowerShellSingleQuoted(session.id)}'`,
    `Write-Host 'execution: ${escapePowerShellSingleQuoted(executionPath)}' -ForegroundColor DarkGray`,
    `Write-Host ''`,
    `Write-Host 'Running: ${escapePowerShellSingleQuoted(resume.display)}' -ForegroundColor Yellow`,
    "Add-AofEvent 'host_resume_started' 'Host resume process started.' @{ command = $AofCommand }",
    "Start-Transcript -LiteralPath $AofTranscriptPath -Force | Out-Null",
    "$tailJob = Start-Job -ArgumentList $AofTranscriptPath,$AofEventsPath,$AofSessionId,$AofRuntime -ScriptBlock { param($TranscriptPath,$EventsPath,$SessionId,$Runtime) $offset = 0; while ($true) { if (Test-Path -LiteralPath $TranscriptPath) { $text = Get-Content -LiteralPath $TranscriptPath -Raw -ErrorAction SilentlyContinue; if ($null -ne $text -and $text.Length -gt $offset) { $chunk = $text.Substring($offset); $offset = $text.Length; if ($chunk.Trim().Length -gt 0) { $event = @{ at = (Get-Date).ToUniversalTime().ToString('o'); type = 'host_resume_output'; message = $chunk; sessionId = $SessionId; runtime = $Runtime }; ($event | ConvertTo-Json -Compress -Depth 10) | Add-Content -LiteralPath $EventsPath -Encoding utf8 } } }; Start-Sleep -Milliseconds 750 } }",
    "try {",
    `  & '${escapePowerShellSingleQuoted(resume.executable)}' ${resume.args.map((arg) => `'${escapePowerShellSingleQuoted(arg)}'`).join(" ")}`,
    "  $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }",
    "} catch {",
    "  $exitCode = 1",
    "  Add-AofEvent 'host_resume_output' $_.Exception.Message",
    "} finally {",
    "  try { Stop-Transcript | Out-Null } catch {}",
    "  if ($tailJob) { Stop-Job $tailJob -ErrorAction SilentlyContinue; Remove-Job $tailJob -Force -ErrorAction SilentlyContinue }",
    "  Add-AofEvent 'host_resume_exited' 'Host resume process exited.' @{ exitCode = $exitCode }",
    "}"
  ].filter(Boolean).join("\r\n");
  const scriptPath = path.join(projectDir, ".aof", "cache", "boards", "host-console", `${escapeFilePart(boardId)}-${escapeFilePart(taskId)}-resume.ps1`);
  await mkdir(path.dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, script, "utf8");

  const launcherCommand = [
    `$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','${escapePowerShellSingleQuoted(scriptPath)}') -WorkingDirectory '${escapePowerShellSingleQuoted(projectDir)}' -WindowStyle Normal -PassThru`,
    "Start-Sleep -Milliseconds 300",
    "$alive = [bool](Get-Process -Id $process.Id -ErrorAction SilentlyContinue)",
    "@{ pid = $process.Id; alive = $alive } | ConvertTo-Json -Compress"
  ].join("; ");
  const launch = await runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", launcherCommand], {
    cwd: projectDir,
    windowsHide: true
  });
  if (launch.code !== 0) {
    throw httpError(`Failed to launch resume console: ${launch.stderr || launch.stdout || `exit ${launch.code}`}`, "TASK_EXECUTION_RESUME_LAUNCH_FAILED", 500);
  }
  const launched = parseLauncherOutput(launch.stdout);
  if (!launched.pid) {
    throw httpError(`Resume console launcher did not return a process id. Output: ${launch.stdout || "(empty)"}`, "TASK_EXECUTION_RESUME_LAUNCH_FAILED", 500);
  }
  return {
    pid: launched.pid,
    alive: launched.alive,
    sessionId: session.id,
    runtime: resume.runtime,
    command: resume.display,
    scriptPath: relativePath(projectDir, scriptPath),
    transcriptPath: relativePath(projectDir, transcriptPath),
    eventsPath: relativePath(projectDir, eventsPath),
    executionPath: relativePath(projectDir, executionPath)
  };
}

function latestResumeSession(execution, events) {
  const sessions = Array.isArray(execution.resume?.sessions) ? execution.resume.sessions : [];
  const byId = new Map(sessions.map((item) => [item.id, item]));
  for (const item of events) {
    const event = item.type === "gsd_event" ? item.event : item;
    const sessionId = event?.sessionId ?? event?.session_id;
    if (!sessionId) continue;
    byId.set(sessionId, {
      ...(byId.get(sessionId) ?? {}),
      id: sessionId,
      phase: event.phase ?? byId.get(sessionId)?.phase,
      lastEventAt: event.timestamp ?? item.at
    });
  }
  const currentSession = byId.get(execution.resume?.currentSessionId);
  if (currentSession?.id && currentSession.status === "running") return currentSession;
  return [...byId.values()]
    .filter((item) => item?.id)
    .sort((left, right) => String(right.lastEventAt ?? right.startedAt ?? "").localeCompare(String(left.lastEventAt ?? left.startedAt ?? "")))[0] ?? null;
}

function resumeCommandForSession(execution, sessionId) {
  const runtime = execution.assignedAgent?.id === "codex" ? "codex" : "claude";
  if (runtime === "codex") {
    return {
      runtime,
      executable: "codex",
      args: ["resume", sessionId],
      display: `codex resume ${sessionId}`
    };
  }
  return {
    runtime,
    executable: "claude",
    args: ["--resume", sessionId],
    display: `claude --resume ${sessionId}`
  };
}

function escapePowerShellSingleQuoted(value) {
  return String(value ?? "").replace(/'/gu, "''");
}

function relativePath(projectDir, filePath) {
  return path.relative(projectDir, filePath).split(path.sep).join("/");
}

function escapeFilePart(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_.-]/gu, "-");
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function parseLauncherOutput(stdout) {
  try {
    return JSON.parse(stdout.trim().split(/\r?\n/u).at(-1) ?? "{}");
  } catch {
    return {};
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        tooLarge = true;
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(httpError("Request body is too large.", "payload-too-large", 413));
        return;
      }
      if (body.trim() === "") {
        reject(httpError("Request body must be JSON.", "empty-json", 400));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(httpError(`Malformed JSON: ${error.message}`, "malformed-json", 400));
      }
    });
    request.on("error", reject);
  });
}

async function readOptionalJsonBody(request) {
  try {
    return await readJsonBody(request);
  } catch (error) {
    if (error.code === "empty-json") return {};
    throw error;
  }
}

function contentType(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".html")) return "text/html";
  return "application/octet-stream";
}

function safeStaticPath(uiRoot, pathname) {
  let relativePath;
  try {
    relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
  if (path.isAbsolute(relativePath)) return null;
  const filePath = path.resolve(uiRoot, relativePath);
  const root = path.resolve(uiRoot);
  return filePath === root || filePath.startsWith(`${root}${path.sep}`) ? filePath : null;
}

function decodeRoutePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    const error = httpError("Invalid URL encoding.", "invalid-url", 400);
    throw error;
  }
}

function validateCatalogItem(item) {
  const diagnostics = [];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return [diagnostic("item", "Catalog item must be a JSON object.")];
  }
  if (typeof item.id !== "string" || item.id.trim() === "") {
    diagnostics.push(diagnostic("id", "Catalog item id is required."));
  }
  if (!VALID_CATALOG_KINDS.has(item.kind)) {
    diagnostics.push(diagnostic("kind", "Only skills and agents are supported in setup for now."));
  }
  if (item.name !== undefined && typeof item.name !== "string") {
    diagnostics.push(diagnostic("name", "Catalog item name must be a string when provided."));
  }
  if (item.body !== undefined && typeof item.body !== "string") {
    diagnostics.push(diagnostic("body", "Catalog item body must be a string when provided."));
  }
  if (item.runtimes !== undefined) {
    if (!Array.isArray(item.runtimes) || item.runtimes.length === 0) {
      diagnostics.push(diagnostic("runtimes", "Catalog item runtimes must be a non-empty array when provided."));
    } else {
      for (const runtime of item.runtimes) {
        if (!VALID_RUNTIMES.has(runtime)) {
          diagnostics.push(diagnostic("runtimes", `Unsupported runtime "${runtime}".`));
        }
      }
    }
  }
  return diagnostics;
}

function diagnostic(pathName, message) {
  return { severity: "error", path: pathName, message, blocking: true };
}

function httpError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
