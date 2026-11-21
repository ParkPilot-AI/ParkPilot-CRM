import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

/** The CRM has no public homepage: the product is described on parkpilot.uk. */
export default async function Home() {
  redirect((await getSessionUser()) ? "/today" : "/login");
}
