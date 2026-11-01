import { useMemo, useState } from "react";
import { Icon } from "./Icon.jsx";

function badgeTone(value) {
  const v = String(value || "").toLowerCase();
  if (/high|strong|positive/.test(v)) return "is-good";
  if (/unknown|none|neutral/.test(v)) return "is-muted";
  if (/medium|soft/.test(v)) return "is-mid";
  if (/low|weak|negative/.test(v)) return "is-low";
  return "is-mid";
}

function SentimentBadge({ value }) {
  if (!value) return "—";
  return <span className={`brand-sentiment-badge ${badgeTone(value)}`}>{value}</span>;
}

function formatAnalyzedAt(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function exportCsv(payload) {
  const headers = [
    "Platform",
    "Visibility",
    "Sentiment",
    "Trust",
    "Authority",
    "Recommendation",
  ];
  const rows = (payload.platforms || []).map((row) =>
    [
      row.label,
      row.visibility,
      row.sentiment,
      row.trust,
      row.authority,
      row.recommendation,
    ]
      .map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`)
      .join(","),
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `brand-sentiment-${payload.brandName || "report"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ChatBrandSentiment({ data }) {
  const payload = data || {};
  const [detailPlatform, setDetailPlatform] = useState(null);

  const active = useMemo(
    () => (payload.platforms || []).find((row) => row.id === detailPlatform) || null,
    [payload.platforms, detailPlatform],
  );

  const analyzedLabel = formatAnalyzedAt(payload.analyzedAt);

  return (
    <div className="brand-sentiment-panel">
      <div className="brand-sentiment-head">
        <div>
          <h3 className="brand-sentiment-title">
            Sentiment Analysis Results for {payload.brandName || payload.domain || "your brand"}
          </h3>
          {analyzedLabel ? (
            <p className="brand-sentiment-meta">Analyzed on {analyzedLabel}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="brand-sentiment-export"
          onClick={() => exportCsv(payload)}
        >
          <Icon name="download" size={15} />
          Export CSV
        </button>
      </div>

      <div className="chat-table-wrap brand-sentiment-table-wrap">
        <table className="chat-table brand-sentiment-table">
          <thead>
            <tr>
              <th>Platform</th>
              <th>Visibility</th>
              <th>Sentiment</th>
              <th>Trust</th>
              <th>Authority</th>
              <th>Recommendation</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(payload.platforms || []).map((row) => (
              <tr key={row.id || row.label}>
                <td>{row.label}</td>
                <td>
                  <SentimentBadge value={row.visibility} />
                </td>
                <td>
                  <SentimentBadge value={row.sentiment} />
                </td>
                <td>
                  <SentimentBadge value={row.trust} />
                </td>
                <td>
                  <SentimentBadge value={row.authority} />
                </td>
                <td>
                  <SentimentBadge value={row.recommendation} />
                </td>
                <td>
                  <button
                    type="button"
                    className="brand-sentiment-details-link"
                    onClick={() => setDetailPlatform(row.id)}
                  >
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active ? (
        <div className="brand-sentiment-detail" role="dialog" aria-label={`${active.label} references`}>
          <div className="brand-sentiment-detail-head">
            <h4>{active.label}: sources and references</h4>
            <button type="button" className="brand-sentiment-detail-close" onClick={() => setDetailPlatform(null)}>
              Close
            </button>
          </div>
          {active.summary ? <p className="brand-sentiment-detail-summary">{active.summary}</p> : null}
          {!active.references?.length ? (
            <p className="brand-sentiment-detail-empty">
              No specific references were identified for this platform in this pass.
            </p>
          ) : (
            <ul className="brand-sentiment-ref-list">
              {active.references.map((ref, index) => (
                <li key={`${ref.url || ref.title}-${index}`}>
                  <div className="brand-sentiment-ref-title">
                    {ref.url ? (
                      <a href={ref.url} target="_blank" rel="noreferrer noopener">
                        {ref.title || ref.url}
                      </a>
                    ) : (
                      <span>{ref.title || "Reference"}</span>
                    )}
                    {ref.source_type ? (
                      <span className="brand-sentiment-ref-type">{ref.source_type.replace(/_/g, " ")}</span>
                    ) : null}
                  </div>
                  {ref.context ? <p className="brand-sentiment-ref-context">{ref.context}</p> : null}
                  {ref.excerpt ? <p className="brand-sentiment-ref-excerpt">{ref.excerpt}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

