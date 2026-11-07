import { TEMPLATES } from "@cmf/templates";
import { route } from "@/lib/server/api";

export const GET = route(null, async () => TEMPLATES);
