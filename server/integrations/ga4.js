import { googleFetch } from "./google.js";

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";

export async function listGa4Properties(uid, project) {
  const data = await googleFetch(uid, project, `${ADMIN}/accountSummaries?pageSize=200`);
  const properties = [];
  for (const account of data.accountSummaries || []) {
    for (const prop of account.propertySummaries || []) {
      properties.push({
        propertyId: prop.property.replace("properties/", ""),
        displayName: prop.displayName,
        account: account.displayName,
      });
    }
  }
  return properties;
}

export async function ga4RunReport(uid, project, propertyId, options = {}) {
  const days = Number(options.days) || 28;
  const body = {
    dateRanges: [{ startDate: options.startDate || `${days}daysAgo`, endDate: options.endDate || "yesterday" }],
    dimensions: (options.dimensions?.length ? options.dimensions : ["sessionDefaultChannelGroup"]).map((name) => ({ name })),
    metrics: (options.metrics?.length ? options.metrics : ["sessions", "totalUsers", "conversions"]).map((name) => ({ name })),
    limit: Math.min(Number(options.limit) || 25, 250),
    orderBys: [{ metric: { metricName: options.orderBy || options.metrics?.[0] || "sessions" }, desc: true }],
    ...(options.pagePathContains
      ? {
          dimensionFilter: {
            filter: {
              fieldName: "pagePath",
              stringFilter: { matchType: "CONTAINS", value: options.pagePathContains },
            },
          },
        }
      : {}),
  };
  const data = await googleFetch(uid, project, `${DATA}/properties/${propertyId}:runReport`, {
    method: "POST",
    body,
  });
  const dimNames = (data.dimensionHeaders || []).map((h) => h.name);
  const metricNames = (data.metricHeaders || []).map((h) => h.name);
  return {
    range: body.dateRanges[0],
    rows: (data.rows || []).map((row) => {
      const out = {};
      row.dimensionValues?.forEach((v, i) => {
        out[dimNames[i]] = v.value;
      });
      row.metricValues?.forEach((v, i) => {
        out[metricNames[i]] = Number(v.value);
      });
      return out;
    }),
    rowCount: data.rowCount || 0,
  };
}
