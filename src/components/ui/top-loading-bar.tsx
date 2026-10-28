export function TopLoadingBar({ label = "Loading page" }: { label?: string }) {
  return (
    <div className="top-loading-bar" role="progressbar" aria-label={label}>
      <span className="top-loading-bar-indicator" />
    </div>
  );
}
