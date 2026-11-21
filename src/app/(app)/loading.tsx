import { RippleLoader } from "@/components/brand/ripple";

export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <RippleLoader label="Loading" />
    </div>
  );
}
