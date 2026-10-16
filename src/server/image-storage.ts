import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "./domain";

// Local-disk product photo storage for the demo backend. To be replaced by a Supabase
// Storage bucket; callers only use saveProductImage / deleteProductImage.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads");
const URL_PREFIX = "/api/uploads/";
const NAME_RE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

const CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
type Ext = keyof typeof CONTENT_TYPES;

/** Identify the format from the file's magic bytes; the browser-reported type is not trusted. */
function detectImageType(bytes: Uint8Array): Ext | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

export async function saveProductImage(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new DomainError("VALIDATION", "imageTooLarge");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = detectImageType(bytes);
  if (!ext) throw new DomainError("VALIDATION", "imageType");

  const name = `${randomUUID()}.${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), bytes);
  return `${URL_PREFIX}${name}`;
}

export async function deleteProductImage(url: string | null): Promise<void> {
  if (!url?.startsWith(URL_PREFIX)) return;
  const name = url.slice(URL_PREFIX.length);
  if (!NAME_RE.test(name)) return;
  await unlink(path.join(UPLOAD_DIR, name)).catch(() => {});
}

export async function readProductImage(name: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const match = NAME_RE.exec(name);
  if (!match) return null;
  try {
    const bytes = await readFile(path.join(UPLOAD_DIR, name));
    return { bytes, contentType: CONTENT_TYPES[match[1] as Ext] };
  } catch {
    return null;
  }
}
