import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/main/infrastructure/storage/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
