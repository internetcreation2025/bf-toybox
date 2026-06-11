import type { MetadataRoute } from "next";

// Web app manifest — lets the app be installed to the Home Screen, which iOS
// requires before it will deliver background push notifications.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sole Decider",
    short_name: "Sole Decider",
    description: "Your private footwear decision-maker.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
