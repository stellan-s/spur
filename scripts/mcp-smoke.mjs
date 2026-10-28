import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/server";

const spurRoot = process.cwd();
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Run `spur migrate` before the MCP smoke test.");
}
const childEnvironment = {
  ...process.env,
  SPUR_REPOSITORY_ROOT: path.join(spurRoot, "fixture-repo"),
  SPUR_ORGANIZATION_SLUG: `mcp-smoke-${randomUUID()}`,
  SPUR_ORGANIZATION_NAME: "MCP smoke test",
  SPUR_CODE_SEARCH: "ask",
};
delete childEnvironment.SPUR_MODEL_PROVIDER;
delete childEnvironment.SPUR_SYNTHESIS_PROVIDER;

const child = spawn(
  process.execPath,
  ["--import", "tsx", path.join(spurRoot, "src/mcp/server.ts")],
  {
    cwd: path.join(spurRoot, "fixture-repo"),
    env: childEnvironment,
    stdio: ["pipe", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";
let complete = false;
let repositorySearch;
let managedMemoryId;

const timeout = setTimeout(() => finish(new Error("MCP smoke test timed out.")), 10_000);

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function finish(error) {
  if (complete) return;
  complete = true;
  clearTimeout(timeout);
  child.stdin.end();
  child.kill();
  if (error) {
    console.error(error.message);
    if (stderr) console.error(stderr.trim());
    process.exitCode = 1;
    return;
  }
  console.log("MCP smoke test passed: modeling and ISMS tools work without a Spur model provider, and security-finding questions return no evidence.");
}

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  const lines = stdout.split("\n");
  stdout = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      finish(new Error(`MCP stdout contained non-protocol text: ${line}`));
      return;
    }

    if (message.result?.structuredContent !== undefined && !message.result?.isError) {
      const notice = message.result.content?.find((item) => item.type === "text" && item.text?.includes("Spur and the model are in BETA"));
      if (!notice?.text?.includes("Double-check the answer against the original sources")) {
        finish(new Error("MCP tool response is missing the beta verification notice."));
        return;
      }
    }

    if (message.id === 1) {
      if (
        !message.result?.instructions?.includes("**Spur**") ||
        !message.result.instructions.includes("non-technical business reader") ||
        !message.result.instructions.includes("2–4 sentences") ||
        !message.result.instructions.includes("End every user-facing answer")
      ) {
        finish(new Error("MCP initialization did not advertise the business-facing Spur reply style."));
        return;
      }
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    } else if (message.id === 2) {
      const tools = message.result?.tools ?? [];
      const names = tools.map((tool) => tool.name);
      const expected = [
        "list_isms_controls",
        "search_isms_controls",
        "get_isms_control",
        "propose_isms_control",
        "edit_isms_control",
        "approve_isms_control",
        "archive_isms_control",
        "get_modeling_schema",
        "begin_source_analysis",
        "propose_memory_objects",
        "propose_relationships",
        "complete_source_analysis",
        "investigate",
        "search_repository",
        "search_memory",
        "get_memory",
        "edit_memory",
        "promote_memory",
        "merge_memory",
        "archive_memory",
        "trace_relationships",
        "record_decision",
      ];
      if (!expected.every((name) => names.includes(name))) {
        finish(new Error(`MCP server is missing tools: ${expected.filter((name) => !names.includes(name)).join(", ")}`));
        return;
      }
      if (
        tools.find((tool) => tool.name === "investigate")?.title !== "Answer a question" ||
        !tools.find((tool) => tool.name === "search_memory")?.description?.includes("raw records")
      ) {
        finish(new Error("MCP question and lookup tools do not expose their intended roles."));
        return;
      }
      if (names.includes("explain_business_rule")) {
        finish(new Error("Provider-only synthesis tool was exposed without a Spur model provider."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: "entity-schema",
        method: "tools/call",
        params: { name: "get_modeling_schema", arguments: {} },
      });
    } else if (message.id === "entity-schema") {
      const result = message.result?.structuredContent;
      if (
        message.result?.isError ||
        !result?.object_kinds?.includes("entity") ||
        !result?.entity_modeling?.entity_definition_fields?.includes("information_classification") ||
        !result?.entity_modeling?.entity_definition_fields?.includes("data_locations") ||
        !result?.entity_modeling?.relationship_cardinalities?.includes("one_to_many")
      ) {
        finish(new Error("MCP modeling schema does not expose the entity model."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "search_repository",
          arguments: {
            query: "shipping address dispatch",
          },
        },
      });
    } else if (message.id === 3) {
      const result = message.result?.structuredContent;
      if (
        message.result?.isError ||
        !Array.isArray(result?.candidates) ||
        result.candidates.length < 1
      ) {
        finish(new Error("MCP repository search returned no source evidence."));
        return;
      }
      repositorySearch = result;
      send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "begin_source_analysis",
          arguments: {
            commit_sha: result.repositories[0].commit_sha,
            idempotency_key: "mcp-smoke-modeling-run-v1",
            client_name: "spur-smoke-test",
            client_version: "0.1.0",
          },
        },
      });
    } else if (message.id === 4) {
      const run = message.result?.structuredContent;
      if (message.result?.isError || run?.status !== "active") {
        finish(new Error("MCP source analysis did not start."));
        return;
      }
      const evidence = repositorySearch.candidates[0];
      send({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "propose_memory_objects",
          arguments: {
            run_id: run.id,
            objects: [
              {
                external_id: "process.shipping-address-update",
                kind: "process",
                title: "Shipping address update",
                statement: "The order workflow contains behavior for changing a shipping address.",
                confidence: 0.85,
                subjects: ["shipping", "orders"],
                evidence: [{
                  kind: evidence.kind === "test" ? "test" : "code",
                  path: evidence.path,
                  start_line: evidence.startLine,
                  end_line: evidence.endLine,
                  excerpt: evidence.excerpt,
                }],
              },
              {
                external_id: "control.shipping-address-change",
                kind: "control",
                title: "Shipping address change control",
                statement: "A repository-backed control governs when a shipping address may change.",
                confidence: 0.85,
                subjects: ["shipping", "orders"],
                evidence: [{
                  kind: evidence.kind === "test" ? "test" : "code",
                  path: evidence.path,
                  start_line: evidence.startLine,
                  end_line: evidence.endLine,
                  excerpt: evidence.excerpt,
                }],
              },
              {
                external_id: "entity.customer",
                kind: "entity",
                title: "Customer",
                statement: "A customer owns orders and provides shipping information.",
                confidence: 0.9,
                subjects: ["customer", "orders"],
                evidence: [{
                  kind: evidence.kind === "test" ? "test" : "code",
                  path: evidence.path,
                  start_line: evidence.startLine,
                  end_line: evidence.endLine,
                  excerpt: evidence.excerpt,
                }],
                entity_definition: {
                  technical_name: "Customer",
                  information_classification: "confidential",
                  attributes: [{
                    name: "id",
                    data_type: "string",
                    required: true,
                    identifier: true,
                    unique: true,
                  }],
                  data_locations: [{
                    system: "Order service",
                    storage_type: "database table",
                    locator: "customers",
                  }],
                },
              },
              {
                external_id: "entity.order",
                kind: "entity",
                title: "Order",
                statement: "An order records its customer and shipping address.",
                confidence: 0.92,
                subjects: ["shipping", "orders"],
                evidence: [{
                  kind: evidence.kind === "test" ? "test" : "code",
                  path: evidence.path,
                  start_line: evidence.startLine,
                  end_line: evidence.endLine,
                  excerpt: evidence.excerpt,
                }],
                entity_definition: {
                  technical_name: "Order",
                  information_classification: "confidential",
                  attributes: [{
                    name: "customerId",
                    data_type: "string",
                    required: true,
                    identifier: false,
                    unique: false,
                    information_classification: "confidential",
                  }],
                  data_locations: [{
                    system: "Order service",
                    storage_type: "database table",
                    locator: "orders",
                    environment: "production",
                  }],
                },
              },
            ],
          },
        },
      });
    } else if (message.id === 5) {
      const result = message.result?.structuredContent;
      const orderEntity = result?.items?.find((item) => item.kind === "entity" && item.title === "Order");
      if (
        message.result?.isError ||
        result?.items?.length !== 4 ||
        orderEntity?.metadata?.entity_definition?.information_classification !== "confidential" ||
        orderEntity?.metadata?.entity_definition?.data_locations?.[0]?.locator !== "orders"
      ) {
        finish(new Error("MCP candidate memory ingestion failed."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "propose_relationships",
          arguments: {
            run_id: result.run.id,
            relationships: [
              {
                from_external_id: "process.shipping-address-update",
                predicate: "constrained_by",
                to_external_id: "control.shipping-address-change",
              },
              {
                from_external_id: "entity.customer",
                predicate: "has_orders",
                to_external_id: "entity.order",
                cardinality: "one_to_many",
                source_attribute: "id",
                target_attribute: "customerId",
              },
            ],
          },
        },
      });
    } else if (message.id === 6) {
      const result = message.result?.structuredContent;
      const entityRelationship = result?.relationships?.find((relationship) => relationship.predicate === "has_orders");
      if (
        message.result?.isError ||
        result?.relationships?.length !== 2 ||
        entityRelationship?.metadata?.cardinality !== "one_to_many" ||
        entityRelationship?.metadata?.source_attribute !== "id" ||
        entityRelationship?.metadata?.target_attribute !== "customerId"
      ) {
        finish(new Error("MCP relationship ingestion failed."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "complete_source_analysis",
          arguments: { run_id: result.run.id },
        },
      });
    } else if (message.id === 7) {
      const result = message.result?.structuredContent;
      if (
        message.result?.isError ||
        result?.status !== "completed" ||
        result?.object_count !== 4 ||
        result?.relationship_count !== 2
      ) {
        finish(new Error("MCP source analysis completion returned incorrect counts."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "search_memory",
          arguments: { query: "order customer shipping", kinds: ["entity"], limit: 10 },
        },
      });
    } else if (message.id === 8) {
      const result = message.result?.structuredContent;
      if (message.result?.isError || !Array.isArray(result?.items) || result.items.length < 1) {
        finish(new Error("MCP memory search did not return modeled candidate knowledge."));
        return;
      }
      managedMemoryId = result.items.find((item) => item.kind === "entity" && item.title === "Order")?.id;
      if (!managedMemoryId) {
        finish(new Error("MCP memory search did not return a candidate to manage."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: "entity-trace",
        method: "tools/call",
        params: {
          name: "trace_relationships",
          arguments: { query: "order customer shipping" },
        },
      });
    } else if (message.id === "entity-trace") {
      const result = message.result?.structuredContent;
      const entityRelationship = result?.relationships?.find((relationship) => relationship.predicate === "has_orders");
      if (
        message.result?.isError ||
        entityRelationship?.metadata?.cardinality !== "one_to_many"
      ) {
        finish(new Error("MCP relationship trace did not return entity cardinality."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "investigate",
          arguments: {
            question: "Why can't a shipping address change after dispatch?",
          },
        },
      });
    } else if (message.id === 9) {
      const result = message.result?.structuredContent;
      if (
        message.result?.isError ||
        result?.code_search?.mode !== "ask" ||
        result.code_search.searched !== false ||
        !Array.isArray(result?.recalled_memory) ||
        result.recalled_memory.length < 1 ||
        !Array.isArray(result?.answering_instructions) ||
        !result.answering_instructions.some((instruction) => instruction.includes("**Spur**")) ||
        !result.answering_instructions.some((instruction) => instruction.includes("business reader")) ||
        !result.answering_instructions.some((instruction) => instruction.includes("2–4 sentences"))
      ) {
        finish(new Error("MCP investigate did not return a provider-independent evidence packet."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "edit_memory",
          arguments: {
            id: managedMemoryId,
            kind: "entity",
            title: "Order",
            statement: "An order records its customer and classified shipping information.",
            subjects: ["shipping", "orders", "verification"],
            entity_definition: {
              technical_name: "Order",
              information_classification: "restricted",
              attributes: [{
                name: "customerId",
                data_type: "string",
                required: true,
                identifier: false,
                unique: false,
                information_classification: "confidential",
              }],
              data_locations: [{
                system: "Order service",
                storage_type: "database table",
                locator: "orders",
                environment: "production",
              }],
            },
          },
        },
      });
    } else if (message.id === 10) {
      const result = message.result?.structuredContent;
      if (
        message.result?.isError ||
        result?.id !== managedMemoryId ||
        result?.kind !== "entity" ||
        result?.metadata?.entity_definition?.information_classification !== "restricted" ||
        result?.metadata?.entity_definition?.data_locations?.[0]?.locator !== "orders"
      ) {
        finish(new Error("MCP memory edit failed."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "promote_memory",
          arguments: { id: managedMemoryId, confirmation: managedMemoryId },
        },
      });
    } else if (message.id === 11) {
      const result = message.result?.structuredContent;
      if (
        message.result?.isError ||
        result?.id !== managedMemoryId ||
        result?.state !== "accepted" ||
        result?.authority !== "person"
      ) {
        finish(new Error("MCP memory promotion failed."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "archive_memory",
          arguments: { id: managedMemoryId, confirmation: managedMemoryId },
        },
      });
    } else if (message.id === 12) {
      const result = message.result?.structuredContent;
      if (
        message.result?.isError ||
        result?.id !== managedMemoryId ||
        typeof result?.metadata?.deleted_at !== "string"
      ) {
        finish(new Error("MCP memory archival failed."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: { name: "get_memory", arguments: { id: managedMemoryId } },
      });
    } else if (message.id === 13) {
      const result = message.result?.structuredContent;
      if (message.result?.isError || result?.item !== null) {
        finish(new Error("Archived MCP memory remained visible."));
        return;
      }
      send({
        jsonrpc: "2.0",
        id: "security-investigation",
        method: "tools/call",
        params: {
          name: "investigate",
          arguments: { question: "Which authorization checks are missing?" },
        },
      });
    } else if (message.id === "security-investigation") {
      const result = message.result?.structuredContent;
      if (
        message.result?.isError ||
        result?.recalled_memory?.length !== 0 ||
        result?.repository_evidence?.length !== 0 ||
        !result?.answering_instructions?.[0]?.includes("does not disclose security findings")
      ) {
        finish(new Error("MCP investigation disclosed security findings."));
        return;
      }
      finish();
    }
  }
});

child.on("error", finish);
child.on("exit", (code) => {
  if (!complete && code !== 0) {
    finish(new Error(`MCP server exited with code ${code}.`));
  }
});

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "spur-smoke-test", version: "0.1.0" },
  },
});
