'use client';

import React, { useState } from 'react';
import { getCountryFlag } from '@/lib/countryUtils';

interface CollapsibleSectionProps {
  countryCode: string;
  countryName: string;
  openSections: Set<string>;
  setOpenSections: React.Dispatch<React.SetStateAction<Set<string>>>;
  children: React.ReactNode;
}

function CollapsibleSection({ countryCode, countryName, openSections, setOpenSections, children }: CollapsibleSectionProps) {
  const isOpen = openSections.has(countryCode);

  const handleToggle = () => {
    setOpenSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(countryCode)) {
        newSet.delete(countryCode);
      } else {
        newSet.add(countryCode);
      }
      return newSet;
    });
  };

  return (
    <div className="mb-4">
      <h3
        className="text-xl font-bold text-gray-900 flex items-center gap-2 cursor-pointer hover:text-gray-700 select-none mb-4"
        onClick={handleToggle}
      >
        <span className="text-sm">
          {isOpen ? '▼' : '▶'}
        </span>
        <span className="text-2xl">{getCountryFlag(countryCode)}</span>
        {countryName}
      </h3>
      {isOpen && (
        <div className="ml-6 mb-8">
          {children}
        </div>
      )}
    </div>
  );
}

interface RailwayNotesArticleProps {
  onClose: () => void;
}

export default function RailwayNotesArticle({ onClose }: RailwayNotesArticleProps) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set([]));

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6 border-b border-gray-200 pb-4">
        <h2 className="text-2xl font-bold text-gray-900">Railway Notes</h2>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 text-2xl font-bold w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100"
          title="Close"
        >
          ×
        </button>
      </div>

      <div className="text-gray-700">
        <p className="mb-4">
          For the prospective railway enthusiast, here are some notes on the European railway network as represented in this app. The general state of railway lines and timetabling is mentioned along with basic information about Interrail usage by country.
        </p>

        <CollapsibleSection
          countryCode="CZ"
          countryName="Czechia"
          openSections={openSections}
          setOpenSections={setOpenSections}
        >
          <p className="mb-4">
            Czechia has a very dense railway network that has avoided large-scale closures, meaning trains run to many small towns and villages. Even low-demand lines are often served at least seasonally by scheduled tourist trains. Trains mostly run on a German-style <a href="https://en.wikipedia.org/wiki/Clock-face_scheduling" target="_blank" className="underline">clock-face schedule</a>.
          </p>
          <p className="mb-4">
            The government railway operator is <a href="https://www.cd.cz/" target="_blank" className="underline">České dráhy</a>, however, as Czech railways have undergone thorough liberalization, many regional and long-distance services are run by private operators, resulting in somewhat complicated operator- and region- based ticketing. However, tickets are comparatively cheap and <a href="https://en.wikipedia.org/wiki/Dynamic_pricing" target="_blank" className="underline">dynamic pricing</a> is limited.
          </p>
          <p className="mb-4">
            Czech (and many European) timetables are available in the local <a href="https://idos.cz/vlaky/" target="_blank" className="underline">IDOS</a> app and website.
          </p>
          <h4 className="text-lg font-bold text-gray-900 mb-2">Interrail</h4>
          <p className="mb-4">
            <a href="https://www.interrail.eu/en/plan-your-trip/tips-and-tricks/trains-europe/railway-companies" target="_blank" className="underline">Passes are valid</a> with České dráhy and about half of private operators, the main exception being Arriva.
          </p>
          <p>
            Seat reservations are rarely necessary, except on the Praha-Ostrava route and some international trains. However, they are cheap and, especially on the busy main lines, useful.
          </p>
        </CollapsibleSection>
      </div>
    </div>
  );
}
