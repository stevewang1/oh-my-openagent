export interface WorkbenchArgs {
  action: "latest" | "list" | "get" | "report"
  id?: string
  query?: string
  limit?: number
}

export interface WorkbenchCheckpoint {
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
