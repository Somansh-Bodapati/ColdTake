import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "ColdTake" },
    { name: "description", content: "Season-long sports prediction game." },
  ];
}

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-semibold">ColdTake</h1>
    </main>
  );
}
