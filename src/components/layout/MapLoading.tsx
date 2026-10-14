/** What a map shows while its client-only module loads (`dynamic(…, { loading })`). */
export default function MapLoading() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="text-gray-600">Loading map...</div>
    </div>
  );
}
