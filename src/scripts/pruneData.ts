import { createWriteStream } from "fs";
import { Feature } from "../lib/types";

const args = process.argv.slice(2);

if (args.length < 1 || args.length > 2) {
  console.error('Usage: tsx pruneData.ts country_code [version]');
  console.error('  country_code: Single country code (e.g., croatia)');
  console.error('  version: Optional version suffix (e.g., 250101)');
  console.error('');
  console.error('Reads GeoJSON from stdin and writes pruned output to data/{country_code}-pruned[-{version}].geojson');
  process.exit(1);
}

const countryCode = args[0];
const version = args[1] || '';

function filterFeature(feat: Feature): boolean {
  if (feat.geometry.type === "Point") {
    if (!feat.properties.railway || !["station", "halt"].includes(feat.properties.railway) || feat.properties.subway) return false;
    return true;
  }
  if (feat.geometry.type === "LineString") {
    if (feat.properties.railway && ["rail", "narrow_gauge", "light_rail"].includes(feat.properties.railway)) return true;
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


async function processStdin(outputFilePath: string) {
  const writeStream = createWriteStream(outputFilePath, 'utf8');
  writeStream.write('{"type":"FeatureCollection","features":[');

  let isFirstFeature = true;
  let buffer = '';
  let featureCount = 0;
  let processedCount = 0;

  // Read from stdin
  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
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
      } catch (_e) {
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

// Main execution
async function main() {
  const versionSuffix = version ? `-${version}` : '';
  const outputFilePath = `data/${countryCode}-pruned${versionSuffix}.geojson`;

  console.log(`Processing ${countryCode} from stdin...`);
  await processStdin(outputFilePath);
  console.log(`Pruned data written to ${outputFilePath}`);
}

main().catch(console.error);