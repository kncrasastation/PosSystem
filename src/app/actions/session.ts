"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { repo } from "@/server/repository";
import { SESSION_COOKIE, homePath } from "@/server/session";

export async function loginAs(userId: string) {
  const user = await repo.getUser(userId);
  if (!user || !user.isActive) redirect("/login?error=invalid");
  (await cookies()).set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  redirect(await homePath({ id: user.id, name: user.name, role: user.role }));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
