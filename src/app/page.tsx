import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { homePathFor } from "@/lib/constants";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(homePathFor(user.role, user.status));
}
