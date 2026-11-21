import { cn } from "@/lib/utils";

function Separator({ className }: { className?: string }) {
  return <hr className={cn("my-4 border-0 border-t border-border", className)} />;
}

export { Separator };
