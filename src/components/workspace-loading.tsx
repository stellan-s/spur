import { TopLoadingBar } from "@/components/ui/top-loading-bar";

export function WorkspaceLoading() {
  return (
    <main className="min-h-svh bg-background md:grid md:grid-cols-[220px_minmax(0,1fr)]" aria-busy="true">
      <TopLoadingBar label="Loading organizational memory" />
      <aside className="border-b bg-card px-5 py-4 md:min-h-svh md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">S</span>
          <span className="font-semibold tracking-tight">Spur</span>
        </div>
      </aside>
    </main>
  );
}
