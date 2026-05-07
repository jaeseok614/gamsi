import { spawn } from "node:child_process";

const mode = process.env.BACKUP_MODE === "production" || process.env.NODE_ENV === "production"
  ? "production"
  : "local";

if (mode === "production" && process.env.ALLOW_PRODUCTION_RESET !== "true") {
  console.error("Demo reset is blocked in production. Set ALLOW_PRODUCTION_RESET=true only after confirming data loss.");
  process.exit(1);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${code ?? 1}`));
    });
  });
}

await run("npx", ["prisma", "db", "push", "--force-reset", "--accept-data-loss"]);
await run("npm", ["run", "db:seed"]);
console.log("Demo database has been reset and seeded.");
