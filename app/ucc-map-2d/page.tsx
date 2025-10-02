// /app/ucc-map-2d/page.tsx (Next.js App Router)
// Local-only 2D SVG viewer that:
//  - loads one floor SVG from /public/floors/floor1.svg
//  - loads room metadata from /public/data/rooms.json
//  - attaches click handlers to <path>/<rect>/<polygon> with an id
//  - shows a popup with name + external link
//  - supports search+highlight and a (stub) floor switcher

"use client";

import React, { useEffect, useRef, useState } from "react";

// Types
type RoomMeta = {
  id: string;      // e.g., "UCC146"
  name: string;    // e.g., "Meeting Room"
  link?: string;   // external URL
  floor?: number;  // optional (useful when you have many floors)
  category?: string;
};

export default function UCCSvgMapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const [floor, setFloor] = useState(1); // active floor
  const [metaById, setMetaById] = useState<Record<string, RoomMeta>>({});
  const [search, setSearch] = useState("");
  const [popup, setPopup] = useState<{
    id: string;
    name: string;
    link?: string;
    x: number;
    y: number;
  } | null>(null);

  // Load metadata once
  useEffect(() => {
    fetch("/data/rooms.json")
      .then((r) => r.json())
      .then((arr: RoomMeta[]) => {
        const byId: Record<string, RoomMeta> = {};
        for (const r of arr) if (r.id) byId[r.id] = r;
        setMetaById(byId);
      })
      .catch((e) => console.error("rooms.json load error", e));
  }, []);

  // Load SVG for active floor
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    setPopup(null);
    host.innerHTML = ""; // clear old

    const url = `/floors/floor${floor}.svg`;
    fetch(url)
      .then((r) => r.text())
      .then((svgText) => {
        // Inject SVG inline so we can add listeners & style it
        host.innerHTML = svgText;

        const svg = host.querySelector("svg");
        if (!svg) return;
        svg.setAttribute("id", "floor-svg");
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.style.display = "block";
        svg.style.userSelect = "none";
        svg.style.background = "#fff";

        // Attach click handlers to every element that has an id
        const clickable = svg.querySelectorAll("path[id], rect[id], polygon[id]");
        clickable.forEach((el) => {
          el.classList.add("ucc-clickable");
          el.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const id = (el as SVGElement).id;
            const info = metaById[id] || { id, name: id };
            // Get element's center on screen for popup anchor
            const bbox = (el as SVGGraphicsElement).getBBox();
            const pt = svg.createSVGPoint();
            pt.x = bbox.x + bbox.width / 2;
            pt.y = bbox.y + bbox.height / 2;
            const ctm = (el as SVGGraphicsElement).getScreenCTM();
            const screen = ctm ? pt.matrixTransform(ctm) : { x: 0, y: 0 } as any;
            setPopup({ id, name: info.name || id, link: info.link, x: screen.x, y: screen.y });

            // Highlight selection
            svg.querySelectorAll(".ucc-selected").forEach((n) => n.classList.remove("ucc-selected"));
            el.classList.add("ucc-selected");
          });
        });

        // Dismiss popup on background click
        svg.addEventListener("click", () => setPopup(null));
      })
      .catch((e) => console.error(`SVG load error (${url})`, e));
  }, [floor, metaById]);

  // Apply search highlight by toggling a CSS class on matching ids
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const svg = host.querySelector("svg");
    if (!svg) return;

    svg.querySelectorAll(".ucc-highlight").forEach((n) => n.classList.remove("ucc-highlight"));
    if (!search) return;

    const q = search.toLowerCase();
    const matches = Object.keys(metaById).filter((id) => id.toLowerCase().includes(q) || (metaById[id].name || "").toLowerCase().includes(q));
    for (const id of matches) {
      const el = svg.querySelector(`#${CSS.escape(id)}`);
      if (el) el.classList.add("ucc-highlight");
    }
  }, [search, metaById]);

  return (
    <div ref={containerRef} className="w-full h-[calc(100vh-80px)] flex">
      {/* Sidebar */}
      <div className="w-72 border-r border-neutral-200 p-3 space-y-4 bg-white">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">Floor</div>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((f) => (
              <button
                key={f}
                onClick={() => setFloor(f)}
                className={`px-3 py-1.5 rounded-xl border text-sm ${floor===f?"bg-violet-700 text-white border-violet-700":"bg-white text-neutral-800 border-neutral-300 hover:border-neutral-400"}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">Search</div>
          <input
            type="text"
            placeholder="Room id or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <div className="mt-1 text-xs text-neutral-500">Matches get highlighted on the map.</div>
        </div>

        <div className="text-xs text-neutral-500">Click any room to open its popup. Click blank space to close.</div>
      </div>

      {/* SVG host */}
      <div className="relative flex-1 bg-white">
        <div ref={svgHostRef} className="w-full h-full" />

        {/* Popup (screen-anchored) */}
        {popup && (
          <div
            className="absolute z-10"
            style={{ left: popup.x, top: popup.y, transform: "translate(-50%, -120%)" }}
          >
            <div className="w-64 rounded-2xl border border-neutral-200 bg-white/95 backdrop-blur p-3 shadow-xl">
              <div className="text-xs text-neutral-500">{popup.id}</div>
              <div className="text-base font-semibold text-neutral-900">{popup.name}</div>
              {popup.link && (
                <a href={popup.link} target="_blank" rel="noreferrer" className="text-violet-700 text-sm hover:underline inline-block mt-2">
                  Open details ↗
                </a>
              )}
              <button onClick={() => setPopup(null)} className="mt-3 w-full rounded-xl bg-neutral-900 text-white text-sm py-1.5 hover:bg-neutral-800">Close</button>
            </div>
          </div>
        )}
      </div>

      {/* Minimal styles for interactivity */}
      <style>{`
        /* make clickable targets clear */
        #floor-svg .ucc-clickable { cursor: pointer; transition: filter .15s ease, opacity .15s ease; }
        #floor-svg .ucc-clickable:hover { filter: brightness(0.92); }
        #floor-svg .ucc-selected { outline: 3px solid #7c3aed; outline-offset: 2px; }
        #floor-svg .ucc-highlight { opacity: 0.9; filter: drop-shadow(0 0 0.35rem rgba(124,58,237,0.7)); }
        /* optional: make non-clickables ignore pointer events */
        #floor-svg .decorative { pointer-events: none; }
      `}</style>
    </div>
  );
}