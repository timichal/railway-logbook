import RailwayMap from '@/components/RailwayMap';

export default function Home() {
  return (
    <div className="h-screen flex flex-col bg-white">
      <header className="bg-white border-b border-gray-200 p-4 flex-shrink-0">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900">
            OSM Railway Map
          </h1>
          <p className="text-gray-600 mt-1">
            Interactive railway map of Czech Republic and Austria
          </p>
        </div>
      </header>
      
      <main className="flex-1 overflow-hidden">
        <RailwayMap className="w-full h-full" />
      </main>
    </div>
  );
}
