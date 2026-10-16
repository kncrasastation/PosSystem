import { readProductImage } from "@/server/image-storage";

// Serves menu photos. They are not sensitive, and file names are random and never
// reused, so responses can be cached indefinitely.
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const image = await readProductImage((await params).name);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
