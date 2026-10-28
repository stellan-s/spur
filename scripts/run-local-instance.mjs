import { spawn } from "node:child_process";
import process from "node:process";

const [envFile, distDir, port] = process.argv.slice(2);
if (!envFile || !distDir || !port || !/^\d+$/.test(port)) {
  console.error("Usage: node scripts/run-local-instance.mjs <env-file> <dist-dir> <port>");
  process.exit(1);
}

process.loadEnvFile(envFile);
process.env.SPUR_NEXT_DIST_DIR = distDir;

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--webpack", "--port", port],
  { env: process.env, stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
