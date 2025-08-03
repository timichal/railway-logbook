import MapWrapper from '@/components/MapWrapper';
import { getRailwayDataAsGeoJSON } from '@/lib/railway-actions';

export default async function Home() {
  // Fetch railway data from database
  const geoJsonData = await getRailwayDataAsGeoJSON(1); // User ID 1

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
        <MapWrapper className="w-full h-full" geoJsonData={geoJsonData} />
      </main>
    </div>
  );
}
