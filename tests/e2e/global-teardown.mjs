import { cleanupE2eData, disconnectCleanupPrisma } from "../../scripts/cleanup-e2e-data.mjs";

export default async function globalTeardown() {
  try {
    await cleanupE2eData();
  } finally {
    await disconnectCleanupPrisma();
  }
}
