import { AGENT_TYPES, AGENTS, STAGE_AGENTS, type AgentType } from "./agents";
import type { EventEnvelope } from "./events";
import type { JobState } from "./job-state";

/**
 * Live Office (section 13.4): visual state of each agent derived ONLY from persisted events.
 * Every non-idle state carries the id of the event that justifies it (evidenceEventId), so the
 * UI can never show work that the backend did not record.
 */

export const OFFICE_STATES = ["idle", "reading_brief", "processing", "waiting_dependency", "blocked", "reviewing", "done", "failed"] as const;
export type OfficeState = (typeof OFFICE_STATES)[number];

export const OFFICE_STATE_LABELS: Record<OfficeState, string> = {
  idle: "Aguardando",
  reading_brief: "Lendo briefing",
  processing: "Processando",
  waiting_dependency: "Aguardando dependência",
  blocked: "Bloqueado",
  reviewing: "Revisando",
  done: "Concluído",
  failed: "Falhou",
};

export interface OfficeAgentState {
  agent: AgentType;
  state: OfficeState;
  evidenceEventId: number | null;
  runId: string | null;
  task: string | null;
  progress: number;
  costCents: number;
  artifacts: { id: string; type: string; version: number; eventId: number }[];
  message: string | null;
  updatedAt: string | null;
  runs: number;
}

const REVIEWER_AGENTS = new Set<AgentType>(["brand", "compliance", "qa"]);

export function initialOffice(): Record<AgentType, OfficeAgentState> {
  const out = {} as Record<AgentType, OfficeAgentState>;
  for (const a of AGENT_TYPES)
    out[a] = { agent: a, state: "idle", evidenceEventId: null, runId: null, task: null, progress: 0, costCents: 0, artifacts: [], message: null, updatedAt: null, runs: 0 };
  return out;
}

function agentOf(ev: EventEnvelope): AgentType | null {
  const a = ev.payload?.agentType;
  return typeof a === "string" && (AGENT_TYPES as readonly string[]).includes(a) ? (a as AgentType) : null;
}

/** Pure reducer: apply one persisted event. */
export function reduceOffice(state: Record<AgentType, OfficeAgentState>, ev: EventEnvelope, runToAgent: Map<string, AgentType>): Record<AgentType, OfficeAgentState> {
  const next = { ...state };
  const set = (a: AgentType, patch: Partial<OfficeAgentState>) => {
    next[a] = { ...next[a], ...patch, evidenceEventId: ev.id, updatedAt: ev.createdAt };
  };
  const p = ev.payload ?? {};
  switch (ev.eventType) {
    case "project.state.changed": {
      const to = p.to as JobState;
      const agents = STAGE_AGENTS[to] ?? [];
      for (const a of agents) set(a, { state: "waiting_dependency", task: `aguardando etapa ${to}`, progress: 0, message: null });
      break;
    }
    case "agent.run.started": {
      const a = agentOf(ev);
      if (!a) break;
      if (typeof p.runId === "string") runToAgent.set(p.runId, a);
      set(a, {
        state: p.phase === "reading_inputs" ? "reading_brief" : REVIEWER_AGENTS.has(a) ? "reviewing" : "processing",
        runId: (p.runId as string) ?? null,
        task: (p.task as string) ?? null,
        progress: 0,
        message: null,
        runs: next[a].runs + 1,
      });
      break;
    }
    case "agent.run.progress": {
      const a = agentOf(ev);
      if (!a) break;
      set(a, {
        state: p.phase === "reading_inputs" ? "reading_brief" : REVIEWER_AGENTS.has(a) ? "reviewing" : "processing",
        progress: typeof p.progress === "number" ? p.progress : next[a].progress,
        task: (p.task as string) ?? next[a].task,
      });
      break;
    }
    case "agent.run.blocked": {
      const a = agentOf(ev);
      if (a) set(a, { state: "blocked", message: (p.message as string) ?? "bloqueado" });
      break;
    }
    case "agent.run.failed": {
      const a = agentOf(ev);
      if (a) set(a, { state: "failed", message: (p.message as string) ?? "falha" });
      break;
    }
    case "agent.run.completed":
    case "agent.run.cached": {
      const a = agentOf(ev);
      if (a)
        set(a, {
          state: "done",
          progress: 1,
          costCents: next[a].costCents + (typeof p.costCents === "number" ? p.costCents : 0),
          message: ev.eventType === "agent.run.cached" ? "reutilizado do cache (mesmas entradas)" : ((p.summary as string) ?? null),
          runs: ev.eventType === "agent.run.cached" ? next[a].runs + 1 : next[a].runs,
        });
      break;
    }
    case "agent.artifact.created": {
      const runId = p.agentRunId as string | null;
      const a = runId ? runToAgent.get(runId) : undefined;
      if (a)
        next[a] = {
          ...next[a],
          artifacts: [...next[a].artifacts, { id: String(p.artifactId), type: String(p.type), version: Number(p.version), eventId: ev.id }],
        };
      break;
    }
    default:
      break;
  }
  return next;
}

export function deriveOfficeState(events: EventEnvelope[]): Record<AgentType, OfficeAgentState> {
  const runToAgent = new Map<string, AgentType>();
  return [...events].sort((a, b) => a.id - b.id).reduce((s, ev) => reduceOffice(s, ev, runToAgent), initialOffice());
}

/** Static dependency graph for the office drawer. */
export function agentDependencies(agent: AgentType): AgentType[] {
  return AGENTS[agent].dependsOn;
}
