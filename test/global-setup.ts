import { config } from "dotenv";
config({ path: ".env.test" });

import { execSync } from "node:child_process";

export default function setup() {
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
}
