import { redirect } from "next/navigation";
import { getActor, homePath } from "@/server/session";

export default async function Home() {
  const actor = await getActor();
  redirect(actor ? await homePath(actor) : "/login");
}
