"use client";

/** Reached only through the hamburger menu, which supplies the title and the way back. */
export default function HowToUseArticle() {
  return (
    <div className="p-6">
      <div className="text-gray-700">
        <p className="mb-4">
          <b>This app is a work in progress!</b> Your stored data will probably be safe, but use at
          your own risk.
        </p>
        <p className="mb-4">
          You can use this app to log your trips on the European and Japanese railway networks. In
          the app, the railway network is made of line parts, all of which have been defined by
          hand, based on data from OpenStreetMaps. So far, only a part of Europe is mapped out, with
          plans to cover at least the European countries where Interrail is valid.
        </p>
        <p className="mb-4">
          The two networks are separate views, switched with the <b>🇪🇺 / 🇯🇵</b> buttons at the top
          of the menu, behind the <b>☰</b> button. The map is locked to whichever one you pick, and
          everything beside it - the station search, the journey planner, your journey list and the
          statistics - covers that region alone. Your log is one log: journeys appear under the
          region they were ridden in.
        </p>
        <p className="mb-4">
          Only lines that are in regular use and available in official timetables are displayed.
          Non-regular lines come in two flavours, each with its own toggle.{" "}
          <i>Heritage &amp; tourist</i> lines (lines of their own, outside the national timetable
          and published through the operator's own channels - museum and preserved railways, but
          also tourist lines such as rack railways and funiculars, some of which run daily) are
          revealed by the <b>Heritage &amp; tourist lines</b> switch under <b>Show on map</b> in the
          menu, and drawn as dotted lines. <i>Special</i> services (regular national tracks used
          only irregularly by passenger trains - diversions during engineering works, festival or
          anniversary runs, occasional tourist trains) are revealed by the <b>Special services</b>{" "}
          switch there, and drawn as dashed lines. Some of these may be missing and some may be
          without any traffic at the moment.
        </p>
        <p className="mb-4">
          While in the <b>Route Logger</b> mode, you can either click on individual line parts or
          use the <b>Journey Planner</b> to find a route between two stations. You can then save the
          result as a journey - a basic unit of your log. Saved journeys are added to the{" "}
          <b>My Trips</b> tab where you can edit them or organize them into multi-journey trips.
        </p>
        <p className="mb-4">
          Without an account, the app stores your data in your browser, with a limit of 5 journeys.
          To reach it from more than one device, create an account and sign in — both are in the
          menu behind the <b>☰</b> button. Journeys saved in your browser can then be transferred to
          your account.
        </p>
        <p className="mb-4">
          The <b>Journey Planner</b> allows you to select all parts between two stations. You can
          select stations by clicking them on the map or enter their names and select them from the
          dropdown. The planner is not always following the routes used in reality, just trying to
          find the most sensible path - but you can customize the route by adding <i>via</i>{" "}
          stations.
        </p>
        <p className="mb-4">
          In the <b>Countries</b> tab, you can choose to display or hide railways by each country.
          Croos-border lines are shown only when both countries are enabled. The stats section shows
          your progress per country and for the whole network. Heritage &amp; tourist lines and
          special services are not counted in the stats.
        </p>
        <p className="mb-4">
          Made by Michal Zlatkovský with a lot of help from the Claude Code AI tool. The code is{" "}
          <a
            href="http://github.com/timichal/osm-trains"
            target="_blank"
            className="underline"
            rel="noopener"
          >
            available on GitHub
          </a>
          .
        </p>
      </div>
    </div>
  );
}
