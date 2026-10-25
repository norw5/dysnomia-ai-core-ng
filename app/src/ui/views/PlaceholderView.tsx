import { RAIL, type ViewId } from "@/ui/NavRail";

export function PlaceholderView({ id }: { id: ViewId }) {
  const item = RAIL.find((r) => r.id === id);
  return (
    <section className="view placeholder view-center" data-testid={`view-${id}`}>
      <h1>
        {item?.group} {item?.label}
      </h1>
      <p className="hint">
        {item?.note} — planned per IA-PLAN §10 build order; this session wires the harness shell
      </p>
    </section>
  );
}
