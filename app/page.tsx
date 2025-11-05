import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">UCC Map</h1>
        <p className="mt-4 text-lg leading-relaxed">
          Explore the interactive{" "}
          <Link href="/ucc-map-2d" className="text-blue-600 hover:text-blue-500 underline">
            2D campus map experience
          </Link>{" "}
          for the UCC.
        </p>
        <p className="mt-6 text-base text-slate-600">
          The map includes searchable rooms, categories, and handy shortcuts to make navigating the campus a breeze.
        </p>
      </div>
    </main>
  );
}
