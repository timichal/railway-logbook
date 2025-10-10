import fs from "fs";
import mergeCoordinateLists from "./mergeCoordinateLists";
import { Coord, EntryData, Feature, ProcessedFeature, RailwayData } from "../lib/types";

if (process.argv.length !== 3) {
  console.error('Usage: npm run check country_code');
  process.exit(1);
}

const countryCode = process.argv[2];

if (!fs.existsSync(`data/${countryCode}-pruned.geojson`)) {
  console.error(`Missing file: ${countryCode}-pruned.geojson. Generate the geojson first.`);
  process.exit(1);
}

const path = `../definitions/${countryCode}.ts`;

const getRailwayData = async () => {
  const file = await import(path);
  return file.railwayData as RailwayData[];
}

fs.readFile(`data/${countryCode}-pruned.geojson`, async function (err, data) {
  const parsedData: EntryData = JSON.parse(data.toString());
  let prunedFeatures = parsedData.features;

  const railwayData = await getRailwayData();

  let lineFeatures: (Feature | ProcessedFeature)[] = prunedFeatures.filter((f) => f.geometry.type === "LineString");

  console.log(`Total railways: ${railwayData.length}`);

  const indexesToComment: number[] = [];
  const commentedRailways: string[] = [];
  railwayData.forEach((railway, index) => {
    const coordinatesToMerge = lineFeatures
      .filter((f) => (
        typeof f.properties["@id"] === "number"
        && railway.ways.split(";").map(Number).includes(f.properties["@id"]))
      )
      .map((f) => f.geometry.coordinates as Coord[]);

    try {
      mergeCoordinateLists(coordinatesToMerge);
      console.log(`${index + 1}/${railwayData.length}: ${railway.local_number} ${railway.from} - ${railway.to}: OK`);
    } catch (e) {
      console.log(`${index + 1}/${railwayData.length}: ${railway.local_number} ${railway.from} - ${railway.to}: Error!`);
      indexesToComment.push(index);
      commentedRailways.push(`${railway.local_number} ${railway.from} - ${railway.to}`);
    }
  });
  if (indexesToComment.length === 0) {
    console.log("Nothing to fix!");
    process.exit(0);
  }

  console.log(`Found ${indexesToComment.length} railways to fix:\n${commentedRailways.join('\n')}`)
  console.log("Commenting out in the file.")

  const fileContent = fs.readFileSync(path, 'utf-8');
  const railwayDataRegex = /(export const railwayData: RailwayData\[\] = \[)([\s\S]*?)(\];)/;
  const match = fileContent.match(railwayDataRegex);
  const [_, beforeData, dataBody, afterData] = match as RegExpMatchArray;

  // Split the array elements based on the pattern `}, {`
  const elements = dataBody.split(/\},\s*\{/).map((el, idx, arr) => {
    if (idx === 0) return `${el}},`;
    if (idx === arr.length - 1) return `{${el}`
    return `{${el}},`
  });

  indexesToComment.forEach((index) => {
    // Check if the index is valid
    if (index >= 0 && index < elements.length) {
      // Comment out the specific element by wrapping it with `/* ... */`
      const elementToComment = elements[index];
      elements[index] = `${index === 0 ? "\n  " : ""}/* TO FIX\n  ${elementToComment.replace(/(\r\n|\n|\r)/g, '\n').trim()}\n  */${index === elements.length - 1 ? "\n" : ""}`;
    } else {
      console.error(`Index ${index} is out of bounds for the railwayData array.`);
      return;
    }
  })

  // Rebuild the modified content
  const modifiedContent = beforeData + elements.join('\n  ') + afterData;

  // Replace the original `railwayData` with the modified version
  const updatedFileContent = fileContent.replace(railwayDataRegex, modifiedContent);

  // Write back to the file
  fs.writeFileSync(path, updatedFileContent, 'utf-8');
  console.log(`Modified file saved.`);
}); 
