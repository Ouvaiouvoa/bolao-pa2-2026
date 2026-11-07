import { z } from "zod";
import { BriefContentSchema } from "./brief";
import { BrandTokensSchema, ComplianceRulesSchema, ToneRulesSchema } from "./brand";
import { CostPolicySchema } from "./cost";
import { Role } from "./roles";

/** Request payload schemas for section 15. Every route validates input with these. */

export const SignupRequest = z.strictObject({
  organizationName: z.string().min(2).max(80),
  name: z.string().min(2).max(80),
  email: z.string().email().max(200),
  password: z.string().min(10, "senha deve ter ao menos 10 caracteres").max(200),
});

export const LoginRequest = z.strictObject({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const CreateUserRequest = z.strictObject({
  name: z.string().min(2).max(80),
  email: z.string().email().max(200),
  role: Role,
  password: z.string().min(10).max(200),
});

export const CreateBrandRequest = z.strictObject({
  name: z.string().min(2).max(80),
  brandTokens: BrandTokensSchema,
  toneRules: ToneRulesSchema.default(ToneRulesSchema.parse({})),
  complianceRules: ComplianceRulesSchema.default(ComplianceRulesSchema.parse({})),
  defaultTemplateId: z.string().min(1).max(64).default("tpl_authority_001"),
});

export const UpdateBrandRequest = CreateBrandRequest.partial();

export const CreateProjectRequest = z.strictObject({
  brandId: z.string().min(1),
  title: z.string().min(2).max(120),
  templateId: z.string().min(1).max(64).optional(),
  brief: BriefContentSchema,
  costPolicy: CostPolicySchema.default(CostPolicySchema.parse({})),
  aiMode: z.enum(["deterministic", "llm_assisted"]).default("deterministic"),
});

export const UpdateProjectRequest = z.strictObject({
  title: z.string().min(2).max(120).optional(),
  templateId: z.string().min(1).max(64).optional(),
  costPolicy: CostPolicySchema.optional(),
});

export const CreateBriefRequest = z.strictObject({ content: BriefContentSchema });

export const UploadInitRequest = z.strictObject({
  projectId: z.string().min(1).optional(),
  brandId: z.string().min(1).optional(),
  purpose: z.enum(["project_media", "brand_logo", "brand_font", "brand_music"]).default("project_media"),
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().min(1).max(20 * 1024 * 1024 * 1024),
  mimeType: z.string().min(3).max(120),
});

export const COMMENT_KINDS = ["note", "cut", "text_fix", "remove_motion"] as const;
export const CommentKind = z.enum(COMMENT_KINDS);
export type CommentKind = z.infer<typeof CommentKind>;

export const CreateCommentRequest = z.strictObject({
  timecodeMs: z.number().min(0),
  body: z.string().min(1).max(2000),
  kind: CommentKind.default("note"),
  /** For "cut": end of the range to remove (timeline ms). */
  endTimecodeMs: z.number().min(0).nullable().default(null),
  /** For "text_fix": the replacement text for the caption at timecode. */
  replacement: z.string().max(200).nullable().default(null),
  parentId: z.string().nullable().default(null),
});

export const UpdateCommentRequest = z.strictObject({
  status: z.enum(["open", "resolved", "wont_fix"]).optional(),
  body: z.string().min(1).max(2000).optional(),
});

export const APPROVAL_ARTIFACT_TYPES = ["brief", "script", "render_preview", "render_master", "compliance_report", "budget"] as const;
export const ApprovalArtifactType = z.enum(APPROVAL_ARTIFACT_TYPES);
export type ApprovalArtifactType = z.infer<typeof ApprovalArtifactType>;

export const CreateApprovalRequest = z.strictObject({
  projectId: z.string().min(1),
  artifactType: ApprovalArtifactType,
  artifactId: z.string().min(1),
  decision: z.enum(["granted", "rejected"]),
  reason: z.string().max(1000).default(""),
  /** For script approvals: which variant is approved. */
  variant: z.enum(["A", "B"]).optional(),
  /** For budget approvals: new limits. */
  costPolicy: CostPolicySchema.optional(),
});

export const TranscriptPatchRequest = z.strictObject({
  assetId: z.string().min(1),
  edits: z
    .array(z.strictObject({ wordIndex: z.number().int().min(0), text: z.string().min(1).max(60) }))
    .min(1)
    .max(500),
});

export const RenderRequest = z.strictObject({ editPlanId: z.string().min(1).optional() });

export const AgentRetryRequest = z.strictObject({ reason: z.string().max(500).default("retry manual") });
