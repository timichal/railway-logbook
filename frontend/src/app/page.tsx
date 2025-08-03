import RailwayMap from '@/components/RailwayMap';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200 p-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-900">
            OSM Railway Map
          </h1>
          <p className="text-gray-600 mt-1">
            Interactive railway map of Czech Republic and Austria
          </p>
        </div>
      </header>
      
      <main className="flex-1">
        <RailwayMap className="h-[calc(100vh-120px)]" />
      </main>
    </div>
  );
}
