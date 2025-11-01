// components/Filters.js
export default function Filters({
  filters,
  selected,
  onChange,
}) {
  const {
    clients = [],
    projects = [],
    platforms = [],
    owners = [],
    statuses = [],
  } = filters || {};

  return (
    <div className="filters-bar" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
      {/* Clients */}
      <select
        value={selected.client || "All Clients"}
        onChange={(e) => onChange({ ...selected, client: e.target.value })}
      >
        <option>All Clients</option>
        {clients.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>

      {/* Projects */}
      <select
        value={selected.project || "All Projects"}
        onChange={(e) => onChange({ ...selected, project: e.target.value })}
      >
        <option>All Projects</option>
        {projects.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>

      {/* Platforms */}
      <select
        value={selected.platform || "All Platforms"}
        onChange={(e) => onChange({ ...selected, platform: e.target.value })}
      >
        <option>All Platforms</option>
        {platforms.map((pl) => (
          <option key={pl.name} value={pl.name}>
            {pl.name}
          </option>
        ))}
      </select>

      {/* Owners */}
      <select
        value={selected.owner || "All Owners"}
        onChange={(e) => onChange({ ...selected, owner: e.target.value })}
      >
        <option>All Owners</option>
        {owners.map((o) => (
          <option key={o.name} value={o.name}>
            {o.name}
          </option>
        ))}
      </select>

      {/* Status - NO tocamos tu lógica, solo mostramos lo que viene */}
      <select
        value={selected.status || "All Status"}
        onChange={(e) => onChange({ ...selected, status: e.target.value })}
      >
        <option>All Status</option>
        {statuses.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
