export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="mb-4 bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">{message}</div>
  );
}
