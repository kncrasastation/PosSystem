import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

const ROOT = path.resolve(__dirname, "../..");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export default async function setup(project: TestProject) {
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: await mkdtemp(path.join(tmpdir(), "fcpos-pg-")),
    port,
    user: "postgres",
    password: "postgres",
    persistent: false,
    onLog: () => {},
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("fcpos_test");

  const client = pg.getPgClient("fcpos_test");
  await client.connect();
  try {
    await client.query(await readFile(path.join(ROOT, "tests/db/supabase-shim.sql"), "utf8"));
    const migrationsDir = path.join(ROOT, "supabase/migrations");
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      try {
        await client.query(await readFile(path.join(migrationsDir, file), "utf8"));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }

  project.provide("dbUrl", `postgres://postgres:postgres@localhost:${port}/fcpos_test`);

  return async () => {
    await pg.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}
