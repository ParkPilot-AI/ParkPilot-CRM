import "server-only";
import { headers } from "next/headers";
import { resolvePublicOrigin } from "@/lib/http/origin";

/** Public origin for the current request (Server Components / Server Actions). */
export async function requestOrigin(): Promise<string> {
  return resolvePublicOrigin(await headers());
}
