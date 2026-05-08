import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { get, getLatest, list, writeReport, type StoredCheckpoint } from "./storage"
import type { WorkbenchArgs, WorkbenchCheckpoint } from "./types"

function includes(item: WorkbenchCheckpoint, query: string): boolean {
  const lower = query.toLowerCase()
  return [
    item.title,
    item.stage,
    item.active_skill,
    item.next_skill,
    item.next_step,
    ...item.used_skills,
    ...item.decisions,
    ...item.rejected,
  ]
    .filter((part): part is string => Boolean(part))
    .some((part) => part.toLowerCase().includes(lower))
}

function line(item: StoredCheckpoint): string {
  const c = item.checkpoint
  const skill = c.active_skill ? ` · ${c.active_skill}` : ""
  const next = c.next_step ? ` · next: ${c.next_step}` : ""
  return `- \`${item.id}\` · ${c.timestamp} · ${c.title}${skill} · ${c.status}${next}`
}

function details(item: StoredCheckpoint): string {
  const c = item.checkpoint
  return [
    `# ${c.title}`,
    "",
    `- id: \`${item.id}\``,
    `- timestamp: ${c.timestamp}`,
    `- status: ${c.status}`,
    c.active_skill ? `- active_skill: ${c.active_skill}` : undefined,
    c.used_skills.length ? `- used_skills: ${c.used_skills.join(", ")}` : undefined,
    c.next_skill ? `- next_skill: ${c.next_skill}` : undefined,
    c.next_step ? `- next_step: ${c.next_step}` : undefined,
    `- memory_hint: \`${c.memory_hint}\``,
    "",
    "## Stage",
    c.stage,
    "",
    "## Decisions",
    ...(c.decisions.length ? c.decisions.map((decision) => `- ${decision}`) : ["(none)"]),
    "",
    "## Rejected",
    ...(c.rejected.length ? c.rejected.map((rejected) => `- ${rejected}`) : ["(none)"]),
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n")
}

function report(items: StoredCheckpoint[]): string {
  const first = items.at(-1)?.checkpoint
  const latest = items[0]?.checkpoint
  return [
    `# Workbench Report`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Checkpoints: ${items.length}`,
    first ? `Range: ${first.timestamp} -> ${latest?.timestamp ?? first.timestamp}` : undefined,
    "",
    "## Current State",
    latest
      ? [
          `- Task: ${latest.title}`,
          `- Status: ${latest.status}`,
          latest.active_skill ? `- Active skill: ${latest.active_skill}` : undefined,
          `- Stage: ${latest.stage}`,
          latest.next_step ? `- Next step: ${latest.next_step}` : undefined,
        ]
          .filter((part): part is string => Boolean(part))
          .join("\n")
      : "(none)",
    "",
    "## Decisions",
    ...Array.from(new Set(items.flatMap((item) => item.checkpoint.decisions))).map((decision) => `- ${decision}`),
    "",
    "## Rejected Directions",
    ...Array.from(new Set(items.flatMap((item) => item.checkpoint.rejected))).map((rejected) => `- ${rejected}`),
    "",
    "## Skill Path",
    ...items
      .slice()
      .reverse()
      .map((item) => {
        const c = item.checkpoint
        return `- ${c.timestamp}: ${c.active_skill ?? "(none)"} · ${c.stage}`
      }),
    "",
    "## Checkpoint Index",
    ...items.map(line),
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n")
}

export const workbench: ToolDefinition = tool({
  description:
    "Read workbench task checkpoints and generate checkpoint-based markdown reports. Use this for resume, task progress, and report requests before falling back to memory.",
  args: {
    action: tool.schema.enum(["latest", "list", "get", "report"]).describe("Action to run"),
    id: tool.schema.string().optional().describe("Checkpoint id for get. Use latest for the latest checkpoint."),
    query: tool.schema.string().optional().describe("Optional keyword filter for list/report"),
    limit: tool.schema.number().optional().describe("Maximum checkpoints to read (default 20)"),
  },
  execute: async (args: WorkbenchArgs) => {
    const project = process.cwd()

    if (args.action === "latest") {
      const item = getLatest(project)
      return item ? details(item) : "No workbench checkpoint found."
    }

    if (args.action === "get") {
      if (!args.id) return "Error: id is required for get"
      const item = get(project, args.id)
      return item ? details(item) : `Checkpoint not found: ${args.id}`
    }

    const query = args.query?.trim()
    const limit = args.limit && args.limit > 0 ? args.limit : 20
    const items = list(project)
      .filter((item) => !query || includes(item.checkpoint, query))
      .slice(0, limit)

    if (args.action === "list") {
      if (items.length === 0) return "No matching workbench checkpoints found."
      return ["## Workbench Checkpoints", "", ...items.map(line)].join("\n")
    }

    if (items.length === 0) return "No matching workbench checkpoints found."
    const body = report(items)
    const path = writeReport(project, query || items[0].checkpoint.title, body)
    return `Report generated: ${path}\n\n${body}`
  },
})
