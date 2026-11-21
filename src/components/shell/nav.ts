import { CalendarDays, Columns3, Home, KeyRound, Settings, Users } from "lucide-react";

/** Main navigation. `mobile` items appear in the bottom tab bar on phones. */
export const NAV = [
  { href: "/today", label: "Today", icon: Home, mobile: true },
  { href: "/pipeline", label: "Pipeline", icon: Columns3, mobile: true },
  { href: "/leads", label: "Leads", icon: Users, mobile: true },
  { href: "/diary", label: "Diary", icon: CalendarDays, mobile: true },
  { href: "/owners", label: "Owners", icon: KeyRound, mobile: false },
  { href: "/settings", label: "Settings", icon: Settings, mobile: true },
] as const;
