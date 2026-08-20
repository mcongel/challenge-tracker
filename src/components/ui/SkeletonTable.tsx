export function SkeletonTable() {
  return (
    <div className="bg-surface rounded-lg shadow-lg p-4 space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-8 rounded bg-gray-100 animate-pulse" />
      ))}
    </div>
  );
}
