import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "./tabs";

export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your park, your sales team and connections to ParkPilot AI and ecco."
      />
      <SettingsTabs />
      <div className="mt-6">{children}</div>
    </>
  );
}
