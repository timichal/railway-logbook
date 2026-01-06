'use client';

import React from 'react';

interface HowToUseArticleProps {
  onClose: () => void;
}

export default function HowToUseArticle({ onClose }: HowToUseArticleProps) {
  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6 border-b border-gray-200 pb-4">
        <h2 className="text-2xl font-bold text-gray-900">How To Use</h2>
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
          <b>This app is a work in progress!</b> Your stored data will probably be safe, but use at your own risk.
        </p>
        <p className="mb-4">
          You can use this app to log your trips on the European railway network. In the app, the railway network is made of line parts, all of which have been defined by hand, based on data from OpenStreetMaps. So far, only a part of Europe is mapped out, with plans to cover at least the European countries where Interrail is valid.
        </p>
        <p className="mb-4">
          Only lines that are in regular use and available in timetables are displayed. Some heritage or otherwise non-regular lines are marked as <i>special lines</i>, available by ticking the <b>Show special lines</b> box - however, some of them may be missing and some may be without any traffic at the moment.
        </p>
        <p className="mb-4">
          If you're an unregistered user, the app stores your data in your browser, with a limit of 50 logged line parts. To be able to access your data from multiple devices, you can create an account and log in. Trips saved in your browser can then be transferred to your account.
        </p>
        <p className="mb-4">
          There are two ways to log a trip. While in the <b>Route Logger</b> mode, you can click on individual line parts and then log them together with a date and note. Editing logs for a line part is currently done by clicking on the edit button in the selection list.
        </p>
        <p className="mb-4">
          The <b>Journey Planner</b> allows you to select all the parts between two stations. While having the tab open, you can click on the stations on the map or enter their names and select them from the dropdown. The planner is not selecting the actually used long-distance routes at the moment, but you can customize the route by adding <i>via</i> stations. The <b>Add Routes to Selection</b> button then moves you back to the Route Logger tab.
        </p>
        <p className="mb-4">
          In the <b>Country Settings & Stats</b> tab, you can choose to display or hide railways by each country. Croos-border lines are shown only when both countries are enabled. The stats section shows your progress per country and for the whole network. The special lines are not counted in the stats.
        </p>
        <p className="mb-4">
          Made by Michal Zlatkovský with a lot of help from the Claude Code AI tool. The code is <a href="http://github.com/timichal/osm-trains" target="_blank" className="underline">available on GitHub</a>.
        </p>
      </div>
    </div>
  );
}
