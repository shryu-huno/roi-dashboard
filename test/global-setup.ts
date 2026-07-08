import { config } from "dotenv";
config({ path: ".env.test" });

import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set — is .env.test missing?");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
