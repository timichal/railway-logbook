import fs from "fs";

const mergeGeoJSONFilesSynchronously = (inputFiles, outputFile) => {
  try {
    // Open the output file for writing
    const outputStream = fs.openSync(outputFile, 'w');

    // Write the GeoJSON header
    fs.writeSync(outputStream, '{"type": "FeatureCollection", "features": [');

    // Process each input file
    inputFiles.forEach((filePath, fileIndex) => {
      const data = fs.readFileSync(filePath, { encoding: 'utf8' });
      const geojson = JSON.parse(data);

      // Ensure the file has "FeatureCollection" type
      if (geojson.type !== 'FeatureCollection') {
        throw new Error(`File ${filePath} must have a "FeatureCollection" type.`);
      }

      // Write features from the current file
      geojson.features.forEach((feature, index) => {
        if (fileIndex === 0 && index === 0) fs.writeSync(outputStream, JSON.stringify(feature));
        else fs.writeSync(outputStream, ',' + JSON.stringify(feature)); // Add a comma before new features
      });
    });

    // Write the GeoJSON footer
    fs.writeSync(outputStream, ']}');

    // Close the output file
    fs.closeSync(outputStream);

    console.log(`Merged GeoJSON saved to ${outputFile}`);
  } catch (error) {
    console.error('Error merging GeoJSON files:', error.message);
  }
};

mergeGeoJSONFilesSynchronously(['at-pruned.geojson', 'cz-pruned.geojson'], 'merged.geojson');
