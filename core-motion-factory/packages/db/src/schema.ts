import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Section 10 — data model. Every tenant-owned row carries organization_id (directly or through its
 * project) and every query in the repositories filters by it.
 */

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("internal"),
  status: text("status").notNull().default("active"),
  /** Provider choices and AI policy (no secrets — keys live in the environment vault). */
  settingsJson: jsonb("settings_json").notNull().default({}),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), index("users_org_idx").on(t.organizationId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const brands = pgTable(
  "brands",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    brandTokensJson: jsonb("brand_tokens_json").notNull(),
    toneRulesJson: jsonb("tone_rules_json").notNull(),
    complianceRulesJson: jsonb("compliance_rules_json").notNull(),
    defaultTemplateId: text("default_template_id").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("brands_org_idx").on(t.organizationId)],
);

export const brandAssets = pgTable(
  "brand_assets",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull().references(() => brands.id),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    type: text("type").notNull(), // logo | font | music | image
    objectKey: text("object_key").notNull(),
    checksum: text("checksum").notNull(),
    metadataJson: jsonb("metadata_json").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("brand_assets_brand_idx").on(t.brandId)],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    brandId: text("brand_id").notNull().references(() => brands.id),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    channel: text("channel").notNull(),
    templateId: text("template_id").notNull(),
    status: text("status").notNull().default("DRAFT"),
    ownerId: text("owner_id").notNull().references(() => users.id),
    aiMode: text("ai_mode").notNull().default("deterministic"),
    costPolicyJson: jsonb("cost_policy_json").notNull(),
    revisionRound: integer("revision_round").notNull().default(0),
    /** Monotonic counter of stage executions (idempotency keys never repeat across visits). */
    stageSeq: integer("stage_seq").notNull().default(0),
    currentEditPlanId: text("current_edit_plan_id"),
    /** Active stage execution marker (stage + attempt) — used for idempotency and checkpoints. */
    stageJson: jsonb("stage_json"),
    lastError: jsonb("last_error"),
    traceId: text("trace_id").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("projects_org_idx").on(t.organizationId), index("projects_status_idx").on(t.status)],
);

export const stateTransitions = pgTable(
  "state_transitions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("state_transitions_project_idx").on(t.projectId)],
);

export const briefs = pgTable(
  "briefs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    version: integer("version").notNull(),
    contentJson: jsonb("content_json").notNull(),
    createdBy: text("created_by").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("briefs_project_version_uq").on(t.projectId, t.version)],
);

export const uploads = pgTable(
  "uploads",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    projectId: text("project_id").references(() => projects.id),
    brandId: text("brand_id").references(() => brands.id),
    purpose: text("purpose").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: doublePrecision("size_bytes").notNull(),
    chunkSize: integer("chunk_size").notNull(),
    totalParts: integer("total_parts").notNull(),
    objectKey: text("object_key").notNull(),
    targetId: text("target_id").notNull(),
    storageUploadId: text("storage_upload_id").notNull(),
    status: text("status").notNull().default("pending"),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("uploads_project_idx").on(t.projectId)],
);

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    type: text("type").notNull(), // video | audio | image | music
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type"),
    objectKey: text("object_key").notNull(),
    proxyKey: text("proxy_key"),
    durationMs: doublePrecision("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    fps: doublePrecision("fps"),
    codec: text("codec"),
    sizeBytes: doublePrecision("size_bytes"),
    checksum: text("checksum"),
    status: text("status").notNull().default("uploaded"), // uploaded | ingesting | ready | failed | rejected
    metadataJson: jsonb("metadata_json").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("assets_project_idx").on(t.projectId), index("assets_org_idx").on(t.organizationId)],
);

export const transcripts = pgTable(
  "transcripts",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull().references(() => assets.id),
    projectId: text("project_id").notNull().references(() => projects.id),
    version: integer("version").notNull().default(1),
    language: text("language").notNull(),
    segmentsJson: jsonb("segments_json").notNull(),
    wordsJson: jsonb("words_json").notNull(),
    text: text("text").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    confidence: doublePrecision("confidence"),
    editedBy: text("edited_by"),
    createdAt: createdAt(),
  },
  (t) => [index("transcripts_asset_idx").on(t.assetId)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    type: text("type").notNull(),
    version: integer("version").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    objectKey: text("object_key"),
    checksum: text("checksum").notNull(),
    inputHash: text("input_hash").notNull(),
    agentRunId: text("agent_run_id"),
    validated: boolean("validated").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("artifacts_project_type_idx").on(t.projectId, t.type), uniqueIndex("artifacts_project_type_version_uq").on(t.projectId, t.type, t.version)],
);

export const editPlans = pgTable(
  "edit_plans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    version: integer("version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    issuesJson: jsonb("issues_json").notNull().default([]),
    createdByType: text("created_by_type").notNull(), // agent | user
    createdById: text("created_by_id").notNull(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("edit_plans_project_version_uq").on(t.projectId, t.version)],
);

export const renders = pgTable(
  "renders",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    editPlanId: text("edit_plan_id").notNull().references(() => editPlans.id),
    kind: text("kind").notNull(), // preview | final
    status: text("status").notNull().default("queued"),
    objectKey: text("object_key"),
    thumbnailKey: text("thumbnail_key"),
    durationMs: doublePrecision("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    fps: doublePrecision("fps"),
    codec: text("codec"),
    fileSize: doublePrecision("file_size"),
    checksum: text("checksum"),
    costCents: doublePrecision("cost_cents").notNull().default(0),
    progress: doublePrecision("progress").notNull().default(0),
    metricsJson: jsonb("metrics_json").notNull().default({}),
    errorJson: jsonb("error_json"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("renders_project_idx").on(t.projectId)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    agentType: text("agent_type").notNull(),
    stage: text("stage").notNull(),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull(),
    inputHash: text("input_hash"),
    inputRefsJson: jsonb("input_refs_json").notNull().default([]),
    outputRefsJson: jsonb("output_refs_json").notNull().default([]),
    model: text("model"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costCents: doublePrecision("cost_cents").notNull().default(0),
    latencyMs: integer("latency_ms"),
    progress: doublePrecision("progress").notNull().default(0),
    currentTask: text("current_task"),
    logsJson: jsonb("logs_json").notNull().default([]),
    toolCallsJson: jsonb("tool_calls_json").notNull().default([]),
    traceId: text("trace_id").notNull(),
    errorJson: jsonb("error_json"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("agent_runs_project_idx").on(t.projectId), uniqueIndex("agent_runs_idem_uq").on(t.idempotencyKey)],
);

export const reviewComments = pgTable(
  "review_comments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    renderId: text("render_id").notNull().references(() => renders.id),
    authorId: text("author_id").notNull().references(() => users.id),
    timecodeMs: doublePrecision("timecode_ms").notNull(),
    endTimecodeMs: doublePrecision("end_timecode_ms"),
    kind: text("kind").notNull().default("note"),
    replacement: text("replacement"),
    body: text("body").notNull(),
    status: text("status").notNull().default("open"),
    parentId: text("parent_id"),
    appliedInEditPlanId: text("applied_in_edit_plan_id"),
    createdAt: createdAt(),
  },
  (t) => [index("review_comments_project_idx").on(t.projectId)],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    artifactType: text("artifact_type").notNull(),
    artifactId: text("artifact_id").notNull(),
    reason: text("reason").notNull(),
    requestedByType: text("requested_by_type").notNull(),
    requestedById: text("requested_by_id").notNull(),
    status: text("status").notNull().default("open"), // open | resolved | superseded
    resolvedByApprovalId: text("resolved_by_approval_id"),
    createdAt: createdAt(),
  },
  (t) => [index("approval_requests_project_idx").on(t.projectId)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    artifactType: text("artifact_type").notNull(),
    artifactId: text("artifact_id").notNull(),
    decision: text("decision").notNull(), // granted | rejected
    reason: text("reason").notNull(),
    decidedBy: text("decided_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_project_idx").on(t.projectId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    projectId: text("project_id"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: jsonb("payload_json").notNull().default({}),
    traceId: text("trace_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_project_idx").on(t.projectId, t.id), index("audit_events_org_idx").on(t.organizationId, t.id)],
);
