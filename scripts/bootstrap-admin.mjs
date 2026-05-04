import { randomBytes, scryptSync } from "node:crypto";

import { PrismaClient, Role } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();
const PASSWORD_KEY_LENGTH = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, PASSWORD_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  });

  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("hex"),
    Buffer.from(derivedKey).toString("hex")
  ].join("$");
}

async function main() {
  const [email, password, name = "초기 관리자", companyName = "워크가드"] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: node scripts/bootstrap-admin.mjs <email> <password> [name] [companyName]");
    process.exit(1);
  }

  let company = await prisma.company.findFirst({
    orderBy: {
      createdAt: "asc"
    }
  });

  if (!company) {
    company = await prisma.company.create({
      data: {
        name: companyName,
        timezone: "Asia/Seoul"
      }
    });
  }

  const passwordHash = hashPassword(password);
  const user = await prisma.user.upsert({
    where: {
      email
    },
    update: {
      companyId: company.id,
      name,
      role: Role.ADMIN,
      isActive: true,
      passwordHash
    },
    create: {
      companyId: company.id,
      name,
      email,
      role: Role.ADMIN,
      isActive: true,
      passwordHash
    }
  });

  console.log(`Bootstrap admin ready: ${user.email} (${user.id}) in ${company.name}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
