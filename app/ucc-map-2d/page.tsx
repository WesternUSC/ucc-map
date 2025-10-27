// /app/ucc-map-2d/page.tsx (Next.js App Router)
// Local-only 2D SVG viewer that:
//  - loads one floor SVG from /public/floors/floor1.svg
//  - loads room metadata from /public/data/rooms.json
//  - attaches click handlers to <path>/<rect>/<polygon> with an id
//  - shows a popup with name + external link
//  - supports search+highlight and a (stub) floor switcher

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORY_SHORTCUTS } from "./category-icons";

// Types
type RoomMeta = {
  id: string;            // e.g., "UCC146"
  name: string;          // e.g., "Meeting Room"
  link?: string;         // external URL
  floor?: number;        // In use since we have many floors
  description?: string;  // optional longer text
  category?: string | string[]; // e.g., "bathroom" or ["lab", "classroom"]
  categories?: string[]; 
};

type ViewTransform = {scale: number; x: number; y: number};

// Keep this set updated for other non-interactive shapes
const INERT_IDS = new Set([
  "Atrium", // hallway outlines
  "UCC144"  // Unused room?
]);

const isInertId = (id: string | null | undefined) => !!id && INERT_IDS.has(id);

const DEFAULT_TRANSFORM: ViewTransform = { scale: 1, x: 0, y: 0 };
const createDefaultTransform = (): ViewTransform => ({ ...DEFAULT_TRANSFORM });

export default function UCCSvgMapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const svgElementRef = useRef<SVGSVGElement | null>(null);
  const [floor, setFloor] = useState(1); // active floor
  const [metaById, setMetaById] = useState<Record<string, RoomMeta>>({});
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectionHistory, setSelectionHistory] = useState<
    Array<{ id: string; name: string; link?: string; description?: string }>
  >([]);
    const [viewTransform, setViewTransform] = useState<ViewTransform>(
    createDefaultTransform()
  );

  const transformRef = useRef<ViewTransform>(viewTransform);
  const activePointers = useRef(
    new Map<number, { x: number; y: number }>()
  );
  const applyHighlightsRef = useRef<() => void>(() => {});
  const panState = useRef<
    | {
        pointerId: number;
        start: { x: number; y: number };
        origin: ViewTransform;
      }
    | null
  >(null);
  const pinchState = useRef<
    | {
        initialDistance: number;
        midpointContent: { x: number; y: number };
        origin: ViewTransform;
      }
    | null
  >(null);

  const clampScale = (value: number) => Math.min(3, Math.max(0.75, value));

  const applyTransform = (svg: SVGSVGElement | null, transform: ViewTransform) => {
    if (!svg) return;
    svg.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  };

  const zoomAt = (factor: number, focal?: { x: number; y: number }) => {
    const host = svgHostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const point = focal ?? { x: rect.width / 2, y: rect.height / 2 };
    setViewTransform((prev) => {
      const nextScale = clampScale(prev.scale * factor);
      if (nextScale === prev.scale) return prev;
      const contentPoint = {
        x: (point.x - prev.x) / prev.scale,
        y: (point.y - prev.y) / prev.scale,
      };
      return {
        scale: nextScale,
        x: point.x - contentPoint.x * nextScale,
        y: point.y - contentPoint.y * nextScale,
      };
    });
  };

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

    setSelectionHistory([]);
    host.innerHTML = "";

    const url = `/floors/floor${floor}.svg`;
    let cleanupFns: Array<() => void> = [];

    fetch(url)
      .then((r) => r.text())
      .then((svgText) => {
        host.innerHTML = svgText;

        const svg = host.querySelector("svg");
        if (!svg) return;

        svg.setAttribute("id", "floor-svg");
        Object.assign(svg.style, {
          width: "100%",
          height: "100%",
          display: "block",
          userSelect: "none",
          background: "#fff",
          transformOrigin: "0 0",
          touchAction: "none",
        });

        svgElementRef.current = svg;
        const initial = createDefaultTransform();
        transformRef.current = initial;
        setViewTransform(initial);
        applyTransform(svg, initial);

        // Helper: is this element inert?
        const isDecorative = (el: Element | null) =>
          !!el && (el.closest(".decorative") !== null);

        // Helper: avoid selecting the floor wrapper or svg root
        const isContainerId = (id: string) =>
          /^floor\b/i.test(id) || /^layer\b/i.test(id) || id === "Layer_1";

        // CLICK: attach to id-bearing features (but skip decorative)
        const clickable = svg.querySelectorAll<SVGElement>("g[id], path[id], rect[id], polygon[id]");
        const clickHandlers = new Map<SVGElement, (ev: Event) => void>();

        clickable.forEach((el) => {
          if (isDecorative(el)) return; // skip inert groups/shapes
          if (isInertId(el.id)) {
            el.classList.add("ucc-inert");
            return; // skip configured inert ids
          }
          el.classList.add("ucc-clickable");

          const handler = (ev: Event) => {
            ev.stopPropagation();
            const target = ev.target as Element | null;
            const hit = target?.closest<SVGElement>("[id]") ?? el;
            if (!hit || hit.tagName.toLowerCase() === "svg") return;
            if (isDecorative(hit)) return;
            if (isInertId(hit.id)) return;
            if (isContainerId(hit.id)) return; // ignore wrapper like "floor1", "Layer_1"

            const id = hit.id;
            const info = metaById[id] || { id, name: id };

            setSelectionHistory((prev) => {
              const without = prev.filter((item) => item.id !== id);
              return [
                {
                  id,
                  name: info.name || id,
                  link: info.link,
                  description: info.description,
                },
                ...without,
              ].slice(0, 5); // Stores up to 5 rooms in history
            });

            // selection styling
            svg
              .querySelectorAll(".ucc-selected")
              .forEach((n) => n.classList.remove("ucc-selected"));
            hit.classList.add("ucc-selected");
          };

          el.addEventListener("click", handler);
          clickHandlers.set(el, handler);
        });

        cleanupFns.push(() => {
          clickHandlers.forEach((fn, el) => el.removeEventListener("click", fn));
          clickHandlers.clear();
        });

        // Close popup on background click
        const bgClick = () => {
          svg
            .querySelectorAll(".ucc-selected")
            .forEach((n) => n.classList.remove("ucc-selected"));
        };
        svg.addEventListener("click", bgClick);
        cleanupFns.push(() => svg.removeEventListener("click", bgClick));

        // JS-DRIVEN HOVER
        let hovered: SVGElement | null = null;
        const onOver = (ev: MouseEvent) => {
          const hit = (ev.target as Element | null)?.closest<SVGElement>("[id]") ?? null;
          if (!hit || hit.tagName.toLowerCase() === "svg") return;
          if (isDecorative(hit)) return;
          if (isContainerId(hit.id)) return; // don't hover whole floor wrapper

          if (hovered !== hit) {
            hovered?.classList.remove("ucc-hover");
            hovered = hit;
            hovered.classList.add("ucc-hover");
          }
        };
        const onOut = (ev: MouseEvent) => {
          const to = (ev.relatedTarget as Element | null)?.closest?.<SVGElement>("[id]") ?? null;
          if (to === hovered) return;
          hovered?.classList.remove("ucc-hover");
          hovered = null;
        };
        svg.addEventListener("mouseover", onOver);
        svg.addEventListener("mouseout", onOut);
        cleanupFns.push(() => {
          svg.removeEventListener("mouseover", onOver);
          svg.removeEventListener("mouseout", onOut);
        });
        // Re-apply any active highlights now that the SVG is ready
        applyHighlightsRef.current();
      })
      
      .catch((e) => console.error(`SVG load error (${url})`, e));

      return () => {
        cleanupFns.forEach((fn) => fn());
        cleanupFns = [];
        svgElementRef.current = null;
      };
  }, [floor, metaById]);

     
  useEffect(() => {
    transformRef.current = viewTransform;
    applyTransform(svgElementRef.current, viewTransform);
  }, [viewTransform]);

  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    host.style.touchAction = "none";

    const getRelativePoint = (ev: { clientX: number; clientY: number }) => {
      const rect = host.getBoundingClientRect();
      return {
        x: ev.clientX - rect.left,
        y: ev.clientY - rect.top,
      };
    };

    const onWheel = (ev: WheelEvent) => {
      if (!svgElementRef.current) return;
      ev.preventDefault();
      const focal = getRelativePoint(ev);
      const direction = ev.deltaY > 0 ? 1 / 1.2 : 1.2;
      zoomAt(direction, focal);
    };

    const onPointerDown = (ev: PointerEvent) => {
      if (!svgElementRef.current) return;
      const point = getRelativePoint(ev);
      activePointers.current.set(ev.pointerId, point);

      if (activePointers.current.size === 1) {
        panState.current = {
          pointerId: ev.pointerId,
          start: point,
          origin: transformRef.current,
        };
        pinchState.current = null;
      } else if (activePointers.current.size === 2) {
        const points = Array.from(activePointers.current.values());
        const [p1, p2] = points;
        const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const origin = transformRef.current;
        pinchState.current = {
          initialDistance: distance,
          midpointContent: {
            x: (midpoint.x - origin.x) / origin.scale,
            y: (midpoint.y - origin.y) / origin.scale,
          },
          origin,
        };
        panState.current = null;
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (!activePointers.current.has(ev.pointerId)) return;
      const point = getRelativePoint(ev);
      activePointers.current.set(ev.pointerId, point);

      if (activePointers.current.size === 2 && pinchState.current) {
        const points = Array.from(activePointers.current.values());
        const [p1, p2] = points;
        const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const midpoint = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const pinch = pinchState.current;
        if (pinch.initialDistance === 0) return;
        const scaleFactor = distance / pinch.initialDistance;
        const targetScale = clampScale(pinch.origin.scale * scaleFactor);
        setViewTransform((prev) => {
          const contentPoint = pinch.midpointContent;
          return {
            scale: targetScale,
            x: midpoint.x - contentPoint.x * targetScale,
            y: midpoint.y - contentPoint.y * targetScale,
          };
        });
        return;
      }

      if (
        activePointers.current.size === 1 &&
        panState.current &&
        panState.current.pointerId === ev.pointerId
      ) {
        const pan = panState.current;
        const dx = point.x - pan.start.x;
        const dy = point.y - pan.start.y;
        setViewTransform({
          scale: pan.origin.scale,
          x: pan.origin.x + dx,
          y: pan.origin.y + dy,
        });
      }
    };

    const clearPointer = (ev: PointerEvent) => {
      activePointers.current.delete(ev.pointerId);
      if (panState.current?.pointerId === ev.pointerId) {
        panState.current = null;
      }
      if (activePointers.current.size < 2) {
        pinchState.current = null;
      }
    };

    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", clearPointer);
    host.addEventListener("pointercancel", clearPointer);
    host.addEventListener("pointerleave", clearPointer);

    return () => {
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", clearPointer);
      host.removeEventListener("pointercancel", clearPointer);
      host.removeEventListener("pointerleave", clearPointer);
    };
  }, []);

  const handleZoomIn = () => {
    zoomAt(1.2);
  };

  const handleZoomOut = () => {
    zoomAt(1 / 1.2);
  };

  const handleResetZoom = () => {
    const reset = createDefaultTransform();
    transformRef.current = reset;
    setViewTransform(reset);
  };

  // Apply search/category highlight by toggling a CSS class on matching ids
  const applyHighlights = useCallback(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const svg = host.querySelector("svg");
    if (!svg) return;

    svg
      .querySelectorAll(".ucc-highlight")
      .forEach((n) => n.classList.remove("ucc-highlight"));

    const matches = new Set<string>();

    if (search.trim()) {
      const q = search.toLowerCase();
      Object.keys(metaById).forEach((id) => {
        if (isInertId(id)) return;
        if (
          id.toLowerCase().includes(q) ||
          (metaById[id].name || "").toLowerCase().includes(q)
        ) {
          matches.add(id);
        }
      });
    }

    if (activeCategory) {
      Object.entries(metaById).forEach(([id, meta]) => {
        if (isInertId(id)) return;
        const value = meta.categories ?? meta.category;
        const normalized = Array.isArray(value)
          ? value
          : typeof value === "string" && value
          ? [value]
          : [];
        if (normalized.includes(activeCategory)) {
          matches.add(id);
        }
      });
    }

    matches.forEach((id) => {
      const el = svg.querySelector<SVGElement>(`#${CSS.escape(id)}`);
      if (el) el.classList.add("ucc-highlight");
    });
  }, [activeCategory, metaById, search]);

  useEffect(() => {
    applyHighlightsRef.current = applyHighlights;
  }, [applyHighlights]);

  useEffect(() => {
    applyHighlights();
  }, [applyHighlights]);

  return (
    <div ref={containerRef} className="w-full h-[calc(100vh-80px)] flex">
      {/* Sidebar */}
      <div className="w-80 border-r border-neutral-200 p-3 bg-white flex flex-col">
        <div className="space-y-4">
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
            <div className="mt-1 text-xs text-neutral-500">
              Matches get highlighted on the map. Use the shortcuts below for quick filters.
            </div>
            <div className="mt-3 flex items-center gap-2">
              {CATEGORY_SHORTCUTS.map(({ id, label, Icon }) => {
                const isActive = activeCategory === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveCategory((prev) => (prev === id ? null : id))}
                    aria-pressed={isActive}
                    aria-label={label}
                    title={label}
                    className={`group relative flex aspect-square min-w-0 flex-1 max-w-[3.5rem] items-center justify-center rounded-full border-2 border-transparent p-1 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                      isActive
                        ? "border-violet-500 bg-white shadow-[0_10px_24px_rgba(99,102,241,0.35)]"
                        : "bg-transparent hover:border-neutral-200"
                    }`}
                  >
                    <span className="sr-only">{label}</span>
                    <Icon active={isActive} className="h-full w-full" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="text-xs text-neutral-500">
            Click any room to add it to the history. Selecting the same room again moves it to the top.
          </div>
        </div>

        <div className="relative mt-4 flex-1 min-h-[120px]">
          <div className="absolute inset-0 overflow-y-auto pr-1 space-y-3">
            {selectionHistory.length === 0 && (
              <div className="text-sm text-neutral-500">
                Selected rooms will appear here in a stack of up to three recent results.
              </div>
            )}
            {selectionHistory.map((room) => (
              <div
                key={room.id}
                className="relative w-full rounded-2xl border border-neutral-200 bg-white/95 backdrop-blur p-3 shadow-xl"
              >
                <div className="text-base font-semibold text-neutral-900">{room.name}</div>
                {room.description && (
                  <div className="mt-1 text-sm text-neutral-600">{room.description}</div>
                )}
                {room.link && (
                  <a
                    href={room.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-violet-700 text-sm hover:underline inline-block mt-2"
                  >
                    Open details ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SVG host */}
      <div className="relative flex-1 bg-white">
        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleZoomIn}
            className="h-10 w-10 rounded-full bg-violet-600 text-white shadow-lg border border-violet-500 text-lg font-semibold hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-300"
            aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          className="h-10 w-10 rounded-full bg-violet-600 text-white shadow-lg border border-violet-500 text-lg font-semibold hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-300"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={handleResetZoom}
          className="h-10 w-10 rounded-full bg-violet-100 text-violet-700 shadow border border-violet-300 text-base font-semibold hover:bg-violet-200 focus:outline-none focus:ring-2 focus:ring-violet-300"
          aria-label="Reset zoom"
        >
            <span aria-hidden>⌂</span>
          </button>
        </div>
        <div
          ref={svgHostRef}
          className="relative w-full h-full overflow-hidden p-6"
        />
      </div>

      {/* Minimal styles for interactivity (scoped to #floor-svg) */}
      <style>{`
        /* Clickable: cursor only */
        #floor-svg .ucc-clickable { cursor: pointer; }
        
        /* Inert ids: force default cursor + disable pointer events */
        #floor-svg .ucc-inert,
        #floor-svg .ucc-inert * {
          cursor: default !important;
          pointer-events: none !important;
        }

        /* Make decorative groups and ALL their children inert */
        #floor-svg .decorative,
        #floor-svg .decorative * {
          pointer-events: none !important;
        }

        /* Search highlight: tint the room surface so overlapping walls stay crisp */
        #floor-svg .ucc-highlight {
          filter: drop-shadow(0 0 0.45rem rgba(124,58,237,0.55));
        }
        #floor-svg g.ucc-highlight > *:not(.decorative):not(.bg),
        #floor-svg path.ucc-highlight,
        #floor-svg rect.ucc-highlight,
        #floor-svg polygon.ucc-highlight {
          fill: rgba(196, 181, 253, 0.72) !important; /* lavender tint distinct from hover */
          transition: fill 0.18s ease;
        }

        /* Clicked selection: render on top of shortcut/search tint */
        #floor-svg .ucc-selected {
          filter: drop-shadow(0 0 0.35rem rgba(99,102,241,0.55))
                  drop-shadow(0 0 0.4rem rgba(67,56,202,0.4));
        }
        #floor-svg g.ucc-selected > *:not(.decorative):not(.bg),
        #floor-svg path.ucc-selected,
        #floor-svg rect.ucc-selected,
        #floor-svg polygon.ucc-selected {
          fill: rgba(129, 140, 248, 0.95) !important; /* bolder indigo for clicked rooms */
          transition: fill 0.18s ease;
        }
        
        /* JS-driven hover: defined after highlight so it visually sits on top when both apply */
        #floor-svg .ucc-hover {
          filter: drop-shadow(0 0 0.35rem rgba(59,130,246,0.55));
        }
        #floor-svg g.ucc-hover > *:not(.decorative):not(.bg),
        #floor-svg path.ucc-hover,
        #floor-svg rect.ucc-hover,
        #floor-svg polygon.ucc-hover {
          fill: rgba(191, 219, 254, 0.92) !important; /* cool blue so hover stands out */
          transition: fill 0.12s ease;
        }

        /* When a shortcut/search highlight is hovered, layer the two glows for clarity */
        #floor-svg .ucc-highlight.ucc-hover {
          filter: drop-shadow(0 0 0.45rem rgba(124,58,237,0.55))
                  drop-shadow(0 0 0.35rem rgba(59,130,246,0.55));
        }

        /* Combine selection with hover so hover still wins */
        #floor-svg .ucc-selected.ucc-hover {
          filter: drop-shadow(0 0 0.35rem rgba(99,102,241,0.55))
                  drop-shadow(0 0 0.35rem rgba(59,130,246,0.55));
        }
      `}</style>
    </div>
  );
}