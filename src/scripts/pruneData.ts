import fs from "fs";
import { createReadStream, createWriteStream } from "fs";
import { EntryData, Feature } from "../lib/types";

if (process.argv.length < 3) {
  console.error('Usage: npm run prune country_code1 [country_code ...]');
  process.exit(1);
}

const countryCodes = process.argv.slice(2);

console.log(`Processing ${countryCodes.length} files...`);

function filterFeature(feat: Feature): boolean {
  if (feat.geometry.type === "Point") {
    if (!["station", "halt"].includes(feat.properties.railway) || feat.properties.subway) return false;
    return true;
  }
  if (feat.geometry.type === "LineString") {
    if (["rail", "narrow_gauge", "light_rail"].includes(feat.properties.railway)) return true;
    return false;
  }
  return false;
}

function pruneFeatureProperties(feat: Feature): Feature {
  return {
    ...feat,
    properties: Object.fromEntries(Object.entries(feat.properties)
      .filter(([key]) => {
        if (key === "@id") return true;
        if (feat.geometry.type === "Point") {
          if (["name", "railway"].includes(key)) return true;
        }
        if (feat.geometry.type === "LineString") {
          if (["name", "railway", "usage"].includes(key)) return true;
        }
        return false;
      })
    ),
  };
}

async function processFile(countryCode: string, index: number) {
  const inputFilePath = `data/${countryCode}-rail.tmp.geojson`;
  const outputFilePath = `data/${countryCode}-pruned.geojson`;

  if (!fs.existsSync(inputFilePath)) {
    console.error(`Missing file: ${inputFilePath}. Generate the geojson first. Exitting.`);
    process.exit(1);
  }

  // Check file size
  const stats = fs.statSync(inputFilePath);
  const fileSizeMB = stats.size / (1024 * 1024);
  console.log(`Processing ${countryCode} (${fileSizeMB.toFixed(1)}MB)...`);

  if (fileSizeMB > 500) {
    console.log(`Using streaming parser for large file...`);
    await processLargeFile(inputFilePath, outputFilePath);
  } else {
    console.log(`Using in-memory parser...`);
    processSmallFile(inputFilePath, outputFilePath);
  }

  console.log(`(${index + 1}/${countryCodes.length}) Pruned data written to ${outputFilePath}.`);
}

function processSmallFile(inputFilePath: string, outputFilePath: string) {
  const data = fs.readFileSync(inputFilePath, 'utf8');
  const parsedData: EntryData = JSON.parse(data);

  const prunedFeatures = parsedData.features
    .filter(filterFeature)
    .map(pruneFeatureProperties) as Feature[];

  fs.writeFileSync(outputFilePath, JSON.stringify({
    "type": "FeatureCollection",
    "features": prunedFeatures,
  }), 'utf8');
}

async function processLargeFile(inputFilePath: string, outputFilePath: string) {
  const writeStream = createWriteStream(outputFilePath, 'utf8');
  writeStream.write('{"type":"FeatureCollection","features":[');
  
  let isFirstFeature = true;
  let buffer = '';
  let featureCount = 0;
  let processedCount = 0;

  const readStream = createReadStream(inputFilePath, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  
  for await (const chunk of readStream) {
    buffer += chunk;
    
    // Process complete features in buffer
    let startIndex = 0;
    while (true) {
      const featureStart = buffer.indexOf('{"type":"Feature"', startIndex);
      if (featureStart === -1) break;
      
      // Find the end of this feature
      let braceCount = 0;
      let featureEnd = -1;
      
      for (let i = featureStart; i < buffer.length; i++) {
        if (buffer[i] === '{') braceCount++;
        else if (buffer[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            featureEnd = i;
            break;
          }
        }
      }
      
      if (featureEnd === -1) break; // Incomplete feature, wait for more data
      
      const featureJson = buffer.substring(featureStart, featureEnd + 1);
      try {
        const feature: Feature = JSON.parse(featureJson);
        featureCount++;
        
        if (filterFeature(feature)) {
          const prunedFeature = pruneFeatureProperties(feature);
          if (!isFirstFeature) writeStream.write(',');
          writeStream.write(JSON.stringify(prunedFeature));
          isFirstFeature = false;
          processedCount++;
        }
        
        if (featureCount % 10000 === 0) {
          console.log(`  Processed ${featureCount} features, kept ${processedCount}`);
        }
      } catch (e) {
        // Skip malformed features
      }
      
      startIndex = featureEnd + 1;
    }
    
    // Keep unprocessed part of buffer
    buffer = buffer.substring(startIndex);
  }
  
  writeStream.write(']}');
  writeStream.end();
  
  return new Promise<void>((resolve, reject) => {
    writeStream.on('finish', () => {
      console.log(`  Final: processed ${featureCount} features, kept ${processedCount}`);
      resolve();
    });
    writeStream.on('error', reject);
  });
}

// Process files sequentially to avoid memory issues
async function main() {
  for (let i = 0; i < countryCodes.length; i++) {
    await processFile(countryCodes[i], i);
  }
}

main().catch(console.error);