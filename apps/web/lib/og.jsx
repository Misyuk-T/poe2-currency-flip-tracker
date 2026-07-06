import { ImageResponse } from "next/og";

// Standard Open Graph card size.
export const OG_SIZE = { width: 1200, height: 630 };

// A dark, gold-accented social card matching the site aesthetic. No live
// numbers — branding + title only — so nothing is fabricated and the route
// needs no database.
export function ogImageResponse({ eyebrow, title, tagline }) {
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 76,
          background: "linear-gradient(135deg, #0b0d10 0%, #131519 60%, #0a0c0e 100%)",
          color: "#eee5d5",
          fontFamily: "sans-serif",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -240,
            right: -160,
            width: 680,
            height: 680,
            borderRadius: 9999,
            background: "radial-gradient(circle, rgba(240,169,59,0.20), rgba(240,169,59,0) 60%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 9999,
              border: "2px solid rgba(214,179,122,0.55)",
              background: "rgba(214,179,122,0.10)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#d6b37a",
              position: "relative",
            }}
          >
            <div style={{ position: "absolute", width: 2, height: 34, top: 10, left: 27, background: "#d6b37a", borderRadius: 999 }} />
            <div style={{ position: "absolute", width: 34, height: 2, top: 18, left: 11, background: "#d6b37a", borderRadius: 999 }} />
            <div style={{ position: "absolute", width: 18, height: 7, top: 32, left: 6, border: "2px solid #d6b37a", borderTop: "0", borderRadius: "0 0 12px 12px" }} />
            <div style={{ position: "absolute", width: 18, height: 7, top: 32, right: 6, border: "2px solid #d6b37a", borderTop: "0", borderRadius: "0 0 12px 12px" }} />
            <div style={{ position: "absolute", width: 20, height: 2, top: 44, left: 18, background: "#d6b37a", borderRadius: 999 }} />
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#d6b37a" }}>PoE2 Flip Helper</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: 5,
              textTransform: "uppercase",
              color: "#f0a93b",
              marginBottom: 18,
            }}
          >
            {eyebrow}
          </div>
          <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.02, color: "#f3ede3" }}>{title}</div>
          <div style={{ fontSize: 30, lineHeight: 1.4, color: "#c8bda7", marginTop: 24, maxWidth: 900 }}>{tagline}</div>
        </div>

        <div style={{ display: "flex", height: 6, width: 200, borderRadius: 9999, background: "#f0a93b" }} />
      </div>
    ),
    OG_SIZE,
  );
}
