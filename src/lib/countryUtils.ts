import { iso1A2Code } from "@rapideditor/country-coder";

/** The ISO 3166-1 alpha-2 code of the country a [lng, lat] point lies in (null outside any). */
export function countryAt(point: [number, number]): string | null {
  return iso1A2Code(point);
}
