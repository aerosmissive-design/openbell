import { createFileRoute } from "@tanstack/react-router";
import { CinemaApp } from "@/components/cinema-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <CinemaApp />;
}
