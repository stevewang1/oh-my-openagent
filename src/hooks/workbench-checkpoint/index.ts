import type { PluginInput } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { stripSystemInstructionPrefix } from "../memory-system/extractor"
import { getMainSessionID, subagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"

const HOOK_NAME = "workbench-checkpoint"
const CHECKPOINT_DIR = ".opencode/workbench/checkpoints"
const LATEST_FILE = ".opencode/workbench/latest.json"
const SAVE_GRACE_PERIOD_MS = 8_000

interface MessagePart {
  type: string
  text?: string
}

interface MessageInfo {
  role: string
  id: string
  sessionID?: string
}

interface MessageWrapper {
  info: MessageInfo
  parts: MessagePart[]
}

interface SessionState {
  hash?: string
  saving: boolean
  saveTimer?: ReturnType<typeof setTimeout>
}

interface WorkbenchCheckpoint {
  version: 1
  source: "auto"
  timestamp: string
  session_id: string
  title: string
  status: "in_progress" | "resolved"
  active_skill?: string
  used_skills: string[]
  stage: string
  decisions: string[]
  rejected: string[]
  next_skill?: string
  next_step?: string
  memory_hint: string
}

function text(parts: MessagePart[]): string {
  return parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text!)
    .join("\n")
    .trim()
}

function clean(message: MessageWrapper): string {
  const raw = text(message.parts)
  if (message.info.role !== "user") return raw
  return stripSystemInstructionPrefix(raw)
}

function short(line: string, max = 120): string {
  const normalized = line.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return normalized.slice(0, max - 3) + "..."
}

function lines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line.length > 0)
}

function unique(items: string[], limit: number): string[] {
  return Array.from(new Set(items.map((item) => short(item)).filter(Boolean))).slice(0, limit)
}

function extractSkills(raw: string): string[] {
  const found: string[] = []
  for (const match of raw.matchAll(/skill\s*\(\s*\{\s*name:\s*["']([^"']+)["']/g)) {
    if (match[1]) found.push(match[1])
  }
  for (const match of raw.matchAll(/## Skill:\s*([a-zA-Z0-9_-]+)/g)) {
    if (match[1]) found.push(match[1])
  }
  return found
}

function findLine(raw: string, patterns: RegExp[]): string | undefined {
  return lines(raw).find((line) => patterns.some((pattern) => pattern.test(line)))
}

function pickTitle(messages: MessageWrapper[]): string {
  const user = messages
    .filter((message) => message.info.role === "user")
    .map(clean)
    .filter(Boolean)
    .at(-1)

  return short(user || "Untitled task", 80)
}

function buildCheckpoint(sessionID: string, messages: MessageWrapper[]): WorkbenchCheckpoint | undefined {
  const prepared = messages
    .map((message) => ({ role: message.info.role, text: clean(message) }))
    .filter((message) => message.text.length > 0)

  const userCount = prepared.filter((message) => message.role === "user").length
  const assistantCount = prepared.filter((message) => message.role === "assistant").length
  if (userCount === 0 || assistantCount === 0) return

  const all = prepared.map((message) => message.text).join("\n\n")
  const assistant = prepared
    .filter((message) => message.role === "assistant")
    .map((message) => message.text)
    .at(-1) ?? ""
  const used = unique(extractSkills(all), 12)
  const active = [...used].reverse().find((skill) => skill !== "super-workbench") ?? used.at(-1)
  const next = extractSkills(assistant).find((skill) => skill !== active)
  const nextLine = findLine(assistant, [/下一步/, /接下来/, /现在(需要|可以|继续)/, /next step/i])
  const stageLine = findLine(assistant, [/当前/, /阶段/, /做到这里/, /已完成/, /进度/])
  const decisionLines = lines(assistant).filter((line) => /已确定|结论|决定|选择|目标|受众|标准/.test(line))
  const rejectedLines = lines(all).filter((line) => /已否决|否决|不走|不写|不要|放弃/.test(line))
  const resolved = /完成|已交付|resolved|done/i.test(assistant)
  const timestamp = new Date().toISOString()

  return {
    version: 1,
    source: "auto",
    timestamp,
    session_id: sessionID,
    title: pickTitle(messages),
    status: resolved ? "resolved" : "in_progress",
    active_skill: active,
    used_skills: used,
    stage: short(stageLine || nextLine || lines(assistant)[0] || "In progress", 160),
    decisions: unique(decisionLines, 8),
    rejected: unique(rejectedLines, 8),
    next_skill: next,
    next_step: nextLine ? short(nextLine, 160) : undefined,
    memory_hint: `.opencode/memory/full/${sessionID.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`,
  }
}

function digest(messages: MessageWrapper[]): string {
  return createHash("sha256")
    .update(messages.map((message) => `${message.info.role}:${clean(message)}`).join("\n---\n"))
    .digest("hex")
}

function save(project: string, checkpoint: WorkbenchCheckpoint): void {
  const dir = join(project, CHECKPOINT_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const stamp = checkpoint.timestamp.replace(/[:.]/g, "-")
  const file = join(dir, `${stamp}-${checkpoint.session_id.slice(0, 12)}.json`)
  const latest = join(project, LATEST_FILE)
  const body = JSON.stringify(checkpoint, null, 2) + "\n"

  writeFileSync(file, body)
  writeFileSync(latest, body)
}

export function createWorkbenchCheckpointHook(ctx: PluginInput) {
  const states = new Map<string, SessionState>()

  function state(sessionID: string): SessionState {
    const current = states.get(sessionID)
    if (current) return current
    const created = { saving: false }
    states.set(sessionID, created)
    return created
  }

  function cancel(sessionID: string): void {
    const current = states.get(sessionID)
    if (!current?.saveTimer) return
    clearTimeout(current.saveTimer)
    current.saveTimer = undefined
  }

  async function checkpoint(sessionID: string): Promise<void> {
    const current = state(sessionID)
    if (current.saving) return
    current.saving = true

    try {
      const resp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      const messages = (resp.data ?? resp) as MessageWrapper[]
      const hash = digest(messages)
      if (current.hash === hash) return

      const item = buildCheckpoint(sessionID, messages)
      if (!item) return

      save(ctx.directory, item)
      current.hash = hash
      log(`[${HOOK_NAME}] checkpoint saved`, {
        sessionID,
        activeSkill: item.active_skill,
        usedSkills: item.used_skills,
      })
    } catch (error) {
      log(`[${HOOK_NAME}] checkpoint failed`, { sessionID, error: String(error) })
    } finally {
      current.saving = false
    }
  }

  function schedule(sessionID: string): void {
    const current = state(sessionID)
    cancel(sessionID)
    current.saveTimer = setTimeout(() => {
      current.saveTimer = undefined
      checkpoint(sessionID)
    }, SAVE_GRACE_PERIOD_MS)
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const props = event.properties as Record<string, unknown> | undefined

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        if (!sessionID) return

        const main = getMainSessionID()
        if (subagentSessions.has(sessionID)) return
        if (main && sessionID !== main) return

        schedule(sessionID)
      }

      if (event.type === "message.updated") {
        const info = props?.info as MessageInfo | undefined
        if (info?.sessionID) cancel(info.sessionID)
      }

      if (event.type === "session.deleted") {
        const info = props?.info as { id?: string } | undefined
        if (!info?.id) return
        cancel(info.id)
        await checkpoint(info.id)
        states.delete(info.id)
      }
    },
  }
}
