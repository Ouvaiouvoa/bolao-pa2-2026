// npm run dev — web (Next.js dev server) + worker (BullMQ) side by side.
import { spawn } from "node:child_process";

const procs = [
  spawn("npm", ["run", "dev", "-w", "@cmf/web"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "@cmf/worker"], { stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => { if (code) { stop(); process.exit(code); } });
