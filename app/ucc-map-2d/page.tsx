// /app/ucc-map-2d/page.tsx (Next.js App Router)
// Local-only 2D SVG viewer that:
//  - loads one floor SVG from /public/floors/floor1.svg
//  - loads room metadata from /public/data/rooms.json
//  - attaches click handlers to <path>/<rect>/<polygon> with an id
//  - shows a popup with name + external link
//  - supports search+highlight and a (stub) floor switcher

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  decorative?: boolean;  // optional flag for non-interactive elements
};

type ViewTransform = {scale: number; x: number; y: number};

const DEFAULT_TRANSFORM: ViewTransform = { scale: 1, x: 0, y: 0 };
const createDefaultTransform = (): ViewTransform => ({ ...DEFAULT_TRANSFORM });

export default function UCCSvgMapPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const svgElementRef = useRef<SVGSVGElement | null>(null);
  const labelLayerRef = useRef<SVGGElement | null>(null);
  const pendingSelectionRef = useRef<string | null>(null);
  const [floor, setFloor] = useState(1); // active floor
  const [metaById, setMetaById] = useState<Record<string, RoomMeta>>({});
  const [search, setSearch] = useState("");
  const [searchHasFocus, setSearchHasFocus] = useState(false);
  const [focusedSuggestionIndex, setFocusedSuggestionIndex] = useState(-1);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selectionHistory, setSelectionHistory] = useState<
    Array<{ id: string; name: string; link?: string; description?: string }>
  >([]);
    const [viewTransform, setViewTransform] = useState<ViewTransform>(
    createDefaultTransform()
  );

  const isDecorativeId = useCallback(
    (id: string | null | undefined) => {
      if (!id) return false;
      return !!metaById[id]?.decorative;
    },
    [metaById]
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

    const collectCategories = (room: RoomMeta | undefined) => {
    if (!room) return [] as string[];
    const categories: string[] = [];
    if (typeof room.category === "string") {
      categories.push(room.category);
    } else if (Array.isArray(room.category)) {
      categories.push(...room.category);
    }
    if (Array.isArray(room.categories)) {
      categories.push(...room.categories);
    }
    return categories.map((value) => value.toLowerCase());
  };

  const rebuildRoomLabels = useCallback(() => {
    const svg = svgElementRef.current;
    if (!svg) return;

    if (labelLayerRef.current) {
      labelLayerRef.current.remove();
      labelLayerRef.current = null;
    }

    if (!Object.keys(metaById).length) return;

    const labelLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    labelLayer.setAttribute("class", "ucc-room-label-layer");
    labelLayer.setAttribute("aria-hidden", "true");
    labelLayer.style.pointerEvents = "none";
    svg.appendChild(labelLayer);

    const candidates = svg.querySelectorAll<SVGGraphicsElement>(
      "g[id], path[id], rect[id], polygon[id], polyline[id]"
    );

    candidates.forEach((element) => {
      const id = element.id;
      if (!id) return;
      if (/^floor\b/i.test(id) || /^layer\b/i.test(id) || id === "Layer_1") return;
      if (isDecorativeId(id)) return;

      const meta = metaById[id];
      if (!meta || meta.decorative) return;

      const categories = collectCategories(meta);
      if (categories.includes("bathroom")) return;

      let bbox: DOMRect;
      try {
        bbox = element.getBBox();
      } catch (err) {
        return;
      }

      if (!bbox || !Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) {
        return;
      }

      if (bbox.width <= 0 || bbox.height <= 0) return;

      const maxFontSize = Math.min(20, bbox.height * 0.6);
      const minFontSize = 8;
      if (maxFontSize < minFontSize) return;

      const label = (meta.name || id).trim();
      if (!label) return;

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.textContent = label;
      text.setAttribute("class", "ucc-room-label");
      text.setAttribute("data-room-id", id);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");

      labelLayer.appendChild(text);

      let fontSize = Math.min(18, maxFontSize);
      let fits = false;
      while (fontSize >= minFontSize) {
        text.setAttribute("font-size", fontSize.toFixed(2));
        const textLength = text.getComputedTextLength();
        if (Number.isFinite(textLength) && textLength <= bbox.width * 0.9) {
          fits = true;
          break;
        }
        fontSize -= 1;
      }

      if (!fits) {
        text.remove();
        return;
      }

      if (bbox.height < fontSize * 1.1) {
        text.remove();
        return;
      }

      const centerX = bbox.x + bbox.width / 2;
      const centerY = bbox.y + bbox.height / 2;
      text.setAttribute("x", centerX.toFixed(2));
      text.setAttribute("y", centerY.toFixed(2));
    });

    if (labelLayer.childElementCount === 0) {
      labelLayer.remove();
      return;
    }

    labelLayerRef.current = labelLayer;
  }, [isDecorativeId, metaById]);

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

  const applySelectionStyling = useCallback((id: string) => {
    const host = svgHostRef.current;
    if (!host) return false;
    const svg = host.querySelector("svg");
    if (!svg) return false;
    const target = svg.querySelector<SVGElement>(`#${CSS.escape(id)}`);
    if (!target) return false;

    svg
      .querySelectorAll(".ucc-selected")
      .forEach((node) => node.classList.remove("ucc-selected"));
    target.classList.add("ucc-selected");
    return true;
  }, []);

  const pushRoomToHistory = useCallback(
    (id: string) => {
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
        ].slice(0, 5);
      });
    },
    [metaById]
  );

  const finalizeSelection = useCallback(
    (id: string) => {
      const success = applySelectionStyling(id);
      if (!success) return false;
      pendingSelectionRef.current = null;
      pushRoomToHistory(id);
      return true;
    },
    [applySelectionStyling, pushRoomToHistory]
  );

  const goToRoom = useCallback(
    (
      id: string,
      options?: { updateSearch?: boolean; clearCategory?: boolean; highlight?: boolean }
    ) => {
      const meta = metaById[id];
      if (!meta || isDecorativeId(id)) return false;

      if (options?.clearCategory) {
        setActiveCategory(null);
      }

      if (options?.updateSearch) {
        const value = meta.id || id;
        setSearch(value);
        setFocusedSuggestionIndex(-1);
      }

      const targetFloor = meta.floor ?? floor;
      if (targetFloor !== floor) {
        pendingSelectionRef.current = id;
        setFloor(targetFloor);
        if (options?.highlight) {
          applyHighlightsRef.current();
        }
        return true;
      }

      const completed = finalizeSelection(id);
      if (!completed) {
        pendingSelectionRef.current = id;
      } else if (options?.highlight) {
        applyHighlightsRef.current();
      }

      return true;
    },
    [metaById, isDecorativeId, floor, finalizeSelection, setActiveCategory]
  );

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
        const isDecorativeElement = (el: Element | null) => {
          if (!el) return false;
          if (el.closest(".decorative")) return true;
          const id = (el as SVGElement).id;
          return isDecorativeId(id);
        };

        // Helper: avoid selecting the floor wrapper or svg root
        const isContainerId = (id: string) =>
          /^floor\b/i.test(id) || /^layer\b/i.test(id) || id === "Layer_1";

        // CLICK: attach to id-bearing features (but skip decorative)
        const clickable = svg.querySelectorAll<SVGElement>("g[id], path[id], rect[id], polygon[id]");
        const clickHandlers = new Map<SVGElement, (ev: Event) => void>();

        clickable.forEach((el) => {
          if (isDecorativeElement(el)) {
            el.classList.add("ucc-inert");
            return; // skip inert groups/shapes
          }
          el.classList.add("ucc-clickable");

          const handler = (ev: Event) => {
            ev.stopPropagation();
            const target = ev.target as Element | null;
            const hit = target?.closest<SVGElement>("[id]") ?? el;
            if (!hit || hit.tagName.toLowerCase() === "svg") return;
            if (isDecorativeElement(hit)) return;
            if (isContainerId(hit.id)) return; // ignore wrapper like "floor1", "Layer_1"

            const id = hit.id;
            goToRoom(id, { updateSearch: false, clearCategory: false, highlight: false });
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
          if (isDecorativeElement(hit)) return;
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

        rebuildRoomLabels();
        // Re-apply any active highlights now that the SVG is ready
        applyHighlightsRef.current();

        const pending = pendingSelectionRef.current;
        if (pending) {
          requestAnimationFrame(() => {
            if (finalizeSelection(pending)) {
              applyHighlightsRef.current();
            }
          });
        }
      })
      
      .catch((e) => console.error(`SVG load error (${url})`, e));

      return () => {
        if (labelLayerRef.current) {
          labelLayerRef.current.remove();
          labelLayerRef.current = null;
        }
        cleanupFns.forEach((fn) => fn());
        cleanupFns = [];
        svgElementRef.current = null;
      };
  }, [floor, finalizeSelection, goToRoom, isDecorativeId, rebuildRoomLabels]);

  useEffect(() => {
    rebuildRoomLabels();
  }, [rebuildRoomLabels]);

     
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

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as RoomMeta[];
    const scored: Array<{ room: RoomMeta; score: number }> = [];
    Object.values(metaById).forEach((room) => {
      if (!room.id || isDecorativeId(room.id)) return;
      const idLower = room.id.toLowerCase();
      const nameLower = (room.name || "").toLowerCase();
      let score = 0;
      if (idLower === q) score = 100;
      else if (idLower.startsWith(q)) score = 90;
      else if (nameLower.startsWith(q)) score = 80;
      else if (idLower.includes(q)) score = 60;
      else if (nameLower.includes(q)) score = 50;
      if (score > 0) scored.push({ room, score });
    });
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.room.id.localeCompare(b.room.id);
    });
    return scored.slice(0, 8).map((entry) => entry.room);
  }, [isDecorativeId, metaById, search]);

  const getExactMatch = useCallback(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return (
      Object.values(metaById).find(
        (room) => room.id?.toLowerCase() === q && !isDecorativeId(room.id)
      ) || null
    );
  }, [isDecorativeId, metaById, search]);

  useEffect(() => {
    setFocusedSuggestionIndex(-1);
  }, [search]);

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
        if (isDecorativeId(id)) return;
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
        if (isDecorativeId(id)) return;
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
  }, [activeCategory, isDecorativeId, metaById, search]);

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
            <div className="relative">
              <input
                type="text"
                placeholder="Room id or name…"
                value={search}
                onFocus={() => setSearchHasFocus(true)}
                onBlur={() => setTimeout(() => setSearchHasFocus(false), 120)}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSearchHasFocus(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    if (suggestions.length === 0) return;
                    setFocusedSuggestionIndex((prev) => {
                      const next = prev + 1;
                      return next >= suggestions.length ? 0 : next;
                    });
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    if (suggestions.length === 0) return;
                    setFocusedSuggestionIndex((prev) => {
                      const next = prev - 1;
                      return next < 0 ? suggestions.length - 1 : next;
                    });
                  } else if (event.key === "Enter") {
                    const index =
                      focusedSuggestionIndex >= 0
                        ? focusedSuggestionIndex
                        : suggestions.length > 0
                        ? 0
                        : -1;
                    if (index >= 0) {
                      event.preventDefault();
                      const room = suggestions[index];
                      goToRoom(room.id, {
                        updateSearch: true,
                        clearCategory: true,
                        highlight: true,
                      });
                      setSearchHasFocus(false);
                    } else {
                      const exact = getExactMatch();
                      if (exact) {
                        event.preventDefault();
                        goToRoom(exact.id, {
                          updateSearch: true,
                          clearCategory: true,
                          highlight: true,
                        });
                        setSearchHasFocus(false);
                      }
                    }
                  } else if (event.key === "Escape") {
                    setFocusedSuggestionIndex(-1);
                    setSearchHasFocus(false);
                  }
                }}
                className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              {search.trim() && (searchHasFocus || focusedSuggestionIndex >= 0) &&
                suggestions.length > 0 && (
                  <div
                    className="absolute z-20 mt-1 w-full rounded-xl border border-neutral-200 bg-white shadow-lg overflow-hidden"
                  >
                    {suggestions.map((room, index) => {
                      const isFocused = index === focusedSuggestionIndex;
                      return (
                        <button
                          key={room.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            goToRoom(room.id, {
                              updateSearch: true,
                              clearCategory: true,
                              highlight: true,
                            });
                            setSearchHasFocus(false);
                          }}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                            isFocused
                              ? "bg-violet-600 text-white"
                              : "hover:bg-violet-50 text-neutral-800"
                          }`}
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {room.name?.trim() ? room.name : room.id}
                            </span>
                            {room.floor ? (
                              <span
                                className={`truncate text-xs ${
                                  isFocused ? "text-violet-100" : "text-neutral-500"
                                }`}
                              >
                                Floor {room.floor}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
            </div>
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

        /* Room label overlay */
        #floor-svg .ucc-room-label-layer {
          pointer-events: none;
        }
        #floor-svg .ucc-room-label {
          font-family: "Inter", "system-ui", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-weight: 600;
          letter-spacing: 0.01em;
          fill: #f9fafb;
          stroke: rgba(17,24,39,0.75);
          stroke-width: 2.5;
          stroke-linejoin: round;
          stroke-linecap: round;
          paint-order: stroke fill;
        }
      `}</style>
    </div>
  );
}