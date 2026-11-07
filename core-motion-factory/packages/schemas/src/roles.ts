import { z } from "zod";

/** Section 4 — user profiles. */
export const ROLES = ["admin", "director", "editor", "reviewer", "client"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  director: "Diretor de conteúdo",
  editor: "Editor",
  reviewer: "Revisor de marca/compliance",
  client: "Cliente aprovador",
};

export const PERMISSIONS = [
  "org.manage",
  "users.manage",
  "providers.manage",
  "brand.manage",
  "brand.view",
  "project.create",
  "project.view",
  "project.update",
  "project.start",
  "brief.edit",
  "brief.approve",
  "script.approve",
  "timeline.edit",
  "transcript.edit",
  "render.preview",
  "render.final",
  "comment.create",
  "comment.resolve",
  "preview.approve",
  "master.approve",
  "compliance.clear",
  "budget.override",
  "agent.retry",
  "cost.view",
  "audit.view",
  "analytics.view",
  "asset.upload",
  "delivery.download",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: ALL,
  director: new Set<Permission>([
    "brand.manage",
    "brand.view",
    "project.create",
    "project.view",
    "project.update",
    "project.start",
    "brief.edit",
    "brief.approve",
    "script.approve",
    "timeline.edit",
    "transcript.edit",
    "render.preview",
    "render.final",
    "comment.create",
    "comment.resolve",
    "preview.approve",
    "master.approve",
    "agent.retry",
    "cost.view",
    "audit.view",
    "analytics.view",
    "asset.upload",
    "delivery.download",
  ]),
  editor: new Set<Permission>([
    "brand.view",
    "project.view",
    "project.update",
    "brief.edit",
    "timeline.edit",
    "transcript.edit",
    "render.preview",
    "comment.create",
    "comment.resolve",
    "agent.retry",
    "cost.view",
    "audit.view",
    "asset.upload",
    "delivery.download",
  ]),
  reviewer: new Set<Permission>([
    "brand.view",
    "project.view",
    "comment.create",
    "comment.resolve",
    "compliance.clear",
    "audit.view",
    "delivery.download",
  ]),
  // Client approver: sees versions, comments, approves — never secrets, costs or technical settings.
  client: new Set<Permission>(["project.view", "comment.create", "preview.approve", "master.approve", "delivery.download"]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
