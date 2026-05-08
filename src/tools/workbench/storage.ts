import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import type { WorkbenchCheckpoint } from "./types"

const ROOT = ".opencode/workbench"
const CHECKPOINTS = ".opencode/workbench/checkpoints"
const REPORTS = ".opencode/workbench/reports"
const LATEST = ".opencode/workbench/latest.json"

export interface StoredCheckpoint {
  id: string
  path: string
  checkpoint: WorkbenchCheckpoint
}

function read(path: string): WorkbenchCheckpoint | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as WorkbenchCheckpoint
  } catch {
    return undefined
  }
}

export function getLatest(project: string): StoredCheckpoint | undefined {
  const path = join(project, LATEST)
  if (!existsSync(path)) return
  const checkpoint = read(path)
  if (!checkpoint) return
  return { id: "latest", path, checkpoint }
}

export function list(project: string): StoredCheckpoint[] {
  const dir = join(project, CHECKPOINTS)
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const path = join(dir, file)
      const checkpoint = read(path)
      if (!checkpoint) return
      return { id: file, path, checkpoint }
    })
    .filter((item): item is StoredCheckpoint => Boolean(item))
    .sort((a, b) => b.checkpoint.timestamp.localeCompare(a.checkpoint.timestamp))
}

export function get(project: string, id: string): StoredCheckpoint | undefined {
  if (id === "latest") return getLatest(project)
  const safe = basename(id)
  const path = join(project, CHECKPOINTS, safe)
  if (!existsSync(path)) return
  const checkpoint = read(path)
  if (!checkpoint) return
  return { id: safe, path, checkpoint }
}

export function writeReport(project: string, title: string, body: string): string {
  const dir = join(project, REPORTS)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const safe = title.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "workbench-report"
  const path = join(dir, `${stamp}-${safe}.md`)

  writeFileSync(path, body)
  return path
}

export function ensureRoot(project: string): string {
  const root = join(project, ROOT)
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}
