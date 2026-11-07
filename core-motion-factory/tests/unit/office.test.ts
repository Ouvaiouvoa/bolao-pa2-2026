import { describe, expect, it } from "vitest";
import { deriveOfficeState, type EventEnvelope } from "@cmf/schemas";

let id = 0;
const ev = (eventType: string, payload: Record<string, unknown>): EventEnvelope => ({ id: ++id, organizationId: "o", projectId: "p", actorType: "agent", actorId: "a", eventType: eventType as EventEnvelope["eventType"], payload, traceId: null, createdAt: new Date(1_700_000_000_000 + id * 1000).toISOString() });

describe("Live Office reflects only persisted events (section 13.4)", () => {
  const events = [
    ev("project.state.changed", { from: "DRAFT", to: "INGESTING" }),
    ev("agent.run.started", { agentType: "ingest", runId: "run_1", phase: "reading_inputs" }),
    ev("agent.run.progress", { agentType: "ingest", runId: "run_1", progress: 0.5, task: "gerando proxy" }),
    ev("agent.artifact.created", { agentRunId: "run_1", artifactId: "art_1", type: "media_manifest", version: 1 }),
    ev("agent.run.completed", { agentType: "ingest", runId: "run_1", costCents: 0 }),
    ev("project.state.changed", { from: "INGESTING", to: "TRANSCRIBING" }),
    ev("agent.run.started", { agentType: "transcript", runId: "run_2" }),
    ev("agent.run.failed", { agentType: "transcript", runId: "run_2", message: "modelo ausente" }),
    ev("agent.run.blocked", { agentType: "compliance", runId: "run_3", message: "alerta alto" }),
  ];
  const office = deriveOfficeState(events);
  it("derives states from the event stream", () => {
    expect(office.ingest.state).toBe("done");
    expect(office.ingest.artifacts).toHaveLength(1);
    expect(office.transcript.state).toBe("failed");
    expect(office.compliance.state).toBe("blocked");
    expect(office.writer.state).toBe("idle");
  });
  it("every non-idle state carries the id of a persisted event", () => {
    const ids = new Set(events.map((e) => e.id));
    for (const s of Object.values(office)) {
      if (s.state === "idle") expect(s.evidenceEventId).toBeNull();
      else expect(ids.has(s.evidenceEventId!)).toBe(true);
    }
  });
  it("is order independent (sorted by event id)", () => {
    const shuffled = [...events].reverse();
    expect(deriveOfficeState(shuffled)).toEqual(office);
  });
});
