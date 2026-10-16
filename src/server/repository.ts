import "server-only";
import type { Repository } from "./domain";
import { createMemoryRepository } from "./memory-repository";

// Single swap point: replace with the Supabase-backed repository once the database is connected.
// Kept on globalThis so dev hot-reloads don't wipe the in-memory data.
const globalForRepo = globalThis as unknown as { fcposRepo?: Repository };

export const repo: Repository = (globalForRepo.fcposRepo ??= createMemoryRepository());
