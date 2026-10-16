import { afterAll, describe, expect, it } from "vitest";
import { deleteProductImage, readProductImage, saveProductImage } from "./image-storage";

const saved: string[] = [];
const file = (bytes: number[], size = bytes.length) =>
  new File([new Uint8Array([...bytes, ...new Array(Math.max(0, size - bytes.length)).fill(0)])], "upload.bin");

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBP = [..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0)));

afterAll(async () => {
  await Promise.all(saved.map(deleteProductImage));
});

describe("image storage", () => {
  it("accepts JPEG, PNG and WebP by magic bytes, and serves them back", async () => {
    for (const [bytes, ext, type] of [
      [JPEG, "jpg", "image/jpeg"],
      [PNG, "png", "image/png"],
      [WEBP, "webp", "image/webp"],
    ] as const) {
      const url = await saveProductImage(file([...bytes], 64));
      saved.push(url);
      expect(url).toMatch(new RegExp(`^/api/uploads/[0-9a-f-]{36}\\.${ext}$`));
      const image = await readProductImage(url.split("/").pop()!);
      expect(image?.contentType).toBe(type);
    }
  });

  it("rejects non-images even if named like one", async () => {
    const svg = new File(['<svg onload="alert(1)"/>'], "evil.jpg", { type: "image/jpeg" });
    await expect(saveProductImage(svg)).rejects.toMatchObject({ key: "imageType" });
  });

  it("rejects files over 2 MB", async () => {
    await expect(saveProductImage(file(JPEG, 2 * 1024 * 1024 + 1))).rejects.toMatchObject({ key: "imageTooLarge" });
  });

  it("refuses path traversal when reading or deleting", async () => {
    expect(await readProductImage("../../package.json")).toBeNull();
    await deleteProductImage("/api/uploads/../../package.json"); // must be a no-op
    expect(await readProductImage("not-a-uuid.jpg")).toBeNull();
  });
});
