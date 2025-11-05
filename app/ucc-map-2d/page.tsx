import type { Metadata } from "next";
import MapView from "../_components/MapView";
export const metadata: Metadata = {
  title: "UCC Interactive Map",
  description: "Explore Western USC's University Community Centre",
};

export default function UccMap2DPage() {
  return <MapView />;
}