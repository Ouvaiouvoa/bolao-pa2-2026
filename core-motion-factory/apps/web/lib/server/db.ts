import "server-only";
import { getDb } from "@cmf/db";

export const db = () => getDb();
