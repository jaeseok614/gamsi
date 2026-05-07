import { spawnSync } from "node:child_process";
import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();

async function main() {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log(`Seed skipped: ${userCount} user(s) already exist.`);
    return;
  }

  console.log("Seed required: database has no users.");
  const child = spawnSync("npm", ["run", "db:seed"], {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (child.status !== 0) {
    throw new Error(`db:seed failed with exit code ${child.status ?? "unknown"}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
