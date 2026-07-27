import { ogImageResponse, OG_SIZE } from "../lib/og.jsx";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Exile Radar — hourly PoE currency market data";

export default function Image() {
  return ogImageResponse({
    eyebrow: "Path of Exile 2",
    title: "Currency market radar",
    tagline: "Hourly market ranges, your verified price, and conservative flip planning — honest, sample-labelled data.",
  });
}
