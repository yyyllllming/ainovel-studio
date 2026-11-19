import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./migrations",
  breakpoints: true,
  dbCredentials: {
    url: "./data/app.db",
  },
});
